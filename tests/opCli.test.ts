import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OpCli } from "../src/opCli.js";
import type { Settings } from "../src/types.js";

test("copyItemToVault supplies the item category when creating from piped JSON", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-opcli-test-"));
  const fakeOp = path.join(dir, "op-fake.js");
  const logFile = path.join(dir, "calls.jsonl");
  const previousLog = process.env.OPMCP_TEST_LOG;
  await fs.writeFile(fakeOp, fakeOpScript(), { mode: 0o755 });
  process.env.OPMCP_TEST_LOG = logFile;

  try {
    const op = new OpCli({
      ...testSettings,
      opPath: fakeOp,
    });
    await op.copyItemToVault({
      itemId: "item_123",
      currentVault: "Private",
      destinationVault: "MCPVAULT",
      category: "LOGIN",
    });

    const calls = (await fs.readFile(logFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[] });
    const createCall = calls.find((call) => call.args[0] === "item" && call.args[1] === "create");
    assert.ok(createCall);
    assert.deepEqual(createCall.args, [
      "item",
      "create",
      "--category",
      "login",
      "--vault",
      "MCPVAULT",
      "-",
    ]);
  } finally {
    if (previousLog === undefined) delete process.env.OPMCP_TEST_LOG;
    else process.env.OPMCP_TEST_LOG = previousLog;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const testSettings: Settings = {
  opPath: "op",
  account: "",
  adminHost: "127.0.0.1",
  adminPort: 7319,
  clipboardClearSeconds: 20,
  autoPasteByDefault: true,
  allowPasteWithoutSite: false,
  defaultVault: "",
  mcpVaultName: "MCPVAULT",
};

function fakeOpScript(): string {
  return `#!/usr/bin/env node
const fs = require("fs");
const actualLogFile = process.argv.includes("item") ? process.env.OPMCP_TEST_LOG || "" : "";
const args = process.argv.slice(2);
if (actualLogFile) fs.appendFileSync(actualLogFile, JSON.stringify({ args }) + "\\n");
if (args[0] === "item" && args[1] === "get") {
  process.stdout.write(JSON.stringify({ title: "Example", category: "LOGIN", fields: [] }));
  process.exit(0);
} else if (args[0] === "item" && args[1] === "create") {
  if (!args.includes("--category")) {
    process.stderr.write("provide the item category with '--category' flag");
    process.exit(1);
  }
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else {
  process.stderr.write("unexpected call");
  process.exit(1);
}
`;
}
