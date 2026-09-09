import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { StateStore } from "../src/state.js";
import { OpCli } from "../src/opCli.js";

export async function fixture(t: TestContext) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-regression-"));
  const previous = process.env.ONEPASSWORD_MCP_HOME;
  process.env.ONEPASSWORD_MCP_HOME = home;
  t.after(async () => {
    if (previous === undefined) delete process.env.ONEPASSWORD_MCP_HOME;
    else process.env.ONEPASSWORD_MCP_HOME = previous;
    await fs.rm(home, { recursive: true, force: true });
  });
  const executable = path.join(home, "op fake '$;tool.cjs");
  await fs.writeFile(executable, `#!${process.execPath}\n` + fakeCli, { mode: 0o755 });
  const store = new StateStore();
  const file = await store.update((state) => {
    state.settings.opPath = executable;
    state.settings.allowAgentItemCreate = true;
  });
  return {
    home, store, op: new OpCli(file.settings),
    mode: (value: string) => fs.writeFile(path.join(home, "mode"), value),
    calls: async () => (await fs.readFile(path.join(home, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line)),
  };
}

const fakeCli = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.ONEPASSWORD_MCP_HOME;
const args = process.argv.slice(2);
const itemPath = path.join(root, "fixture-items.json");
const items = fs.existsSync(itemPath) ? JSON.parse(fs.readFileSync(itemPath)) : [];
const mode = fs.existsSync(path.join(root,"mode")) ? fs.readFileSync(path.join(root,"mode"),"utf8") : "valid";
fs.appendFileSync(path.join(root,"calls.jsonl"),JSON.stringify({args, fifo:fs.fstatSync(0).isFIFO()})+"\n");
const getFlag = flag => args[args.indexOf(flag)+1];
const out = value => process.stdout.write(JSON.stringify(value));
if(args[0]==="--version") out("test-cli");
else if(args[0]==="vault") out([{id:"vault-fixture",name:"MCPVAULT"}]);
else if(args[1]==="create") {
  if(process.platform!=="win32" && !fs.fstatSync(0).isFIFO()) process.exit(42);
  let body="";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => body+=chunk);
  process.stdin.on("end", () => {
    const template = JSON.parse(body);
    if(!template.title || !Array.isArray(template.fields)) process.exit(43);
    const item = {...template,id:"fixture-"+(items.length+1),vault:{id:getFlag("--vault"),name:getFlag("--vault")==="source-vault" ? "Source" : "MCPVAULT"}};
    if(mode==="blank") { item.title="Untitled SecureNote"; item.fields=[]; }
    if(mode==="missing-field") item.fields=[];
    if(mode==="wrong-value") item.fields=item.fields.map(f=>({...f,value:"WRONG"}));
    if(mode==="wrong-vault") item.vault={id:"elsewhere",name:"Elsewhere"};
    items.push(item); fs.writeFileSync(itemPath,JSON.stringify(items));
    if(mode==="empty" || mode==="lost-output") return;
    if(mode==="malformed") return process.stdout.write("malformed");
    out(item);
  });
} else if(args[1]==="list") out(items.filter(item => !args.includes("--tags") || item.tags?.includes(getFlag("--tags"))));
else if(args[1]==="get") {
  if(mode==="read-fails") { process.stderr.write("synthetic secret must not leak");process.exit(1); }
  const item=items.find(item=>item.id===args[2]);
  if(!item) process.exit(1);
  out(mode==="wrong-id" ? {...item,id:"wrong-id"} : item);
} else if(args[1]==="delete") {
  fs.writeFileSync(itemPath,JSON.stringify(items.filter(item=>item.id!==args[2])));
} else if(args[1]!=="move") process.exit(1);
`;
