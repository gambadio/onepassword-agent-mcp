import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fixture } from "./fixtures.js";

test("MCP server starts through a symlinked entry point", { skip: process.platform === "win32" }, async t => {
  const f = await fixture(t);
  const alias = path.join(f.home, "linked-server.ts");
  await fs.symlink(fileURLToPath(new URL("../src/mcp.ts", import.meta.url)), alias);
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", alias],
    env: { ...process.env, ONEPASSWORD_MCP_HOME: f.home } as Record<string, string>, stderr: "pipe" });
  transport.stderr?.on("data", () => {});
  const client = new Client({ name: "entry-test", version: "1" });
  t.after(() => client.close());
  await client.connect(transport);
  const list = await client.listTools();
  assert.ok(list.tools.some(tool => tool.name === "save_secret_from_clipboard"));
});
