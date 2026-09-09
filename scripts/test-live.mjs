// Real CLI validation. Default: dry runs only. --create additionally creates,
// reads, copies, retries and removes uniquely tagged synthetic fixtures.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { OpCli, createItemTemplate, verifyItemTemplate } from "../dist/src/opCli.js";
import { StateStore } from "../dist/src/state.js";
import { runtimeInfo } from "../dist/src/version.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const settings = (await new StateStore().load()).settings;
const op = new OpCli(settings);
const runId = crypto.randomUUID();
const fixtures = [
  { category: "login", username: "synthetic", password: "SYNTHETIC ONLY login !ä\nquoted \"value\"" },
  { category: "password", password: "SYNTHETIC ONLY password $HOME `id`" },
  { category: "api_credential", credential: "SYNTHETIC ONLY API", username: "fixture", hostname: "example.invalid" },
  { category: "secure_note", notes: "SYNTHETIC ONLY note\nSecond line ä." },
  { category: "credit_card", cardholderName: "Synthetic Fixture", cardNumber: "4111111111111111", verificationNumber: "123", expiry: "2028/09", pin: "1234" },
].map(data => ({ vault: settings.mcpVaultName, title: `OPMCP test ${runId} ${data.category}`, url: "https://example.invalid", ...data }));
const log = value => console.log(JSON.stringify({ node: process.version, package: runtimeInfo.version, ...value }));
for (const input of fixtures) {
  const template = createItemTemplate(input);
  const { stdout } = await op.run(["item", "create", "--vault", input.vault, "--dry-run", "--reveal", "-"], { input: JSON.stringify(template), timeoutMs: 60_000 });
  const preview = JSON.parse(stdout);
  assert.equal(preview.title, template.title);
  for (const field of template.fields.filter(field => field.value)) {
    assert.ok(preview.fields.some(actual => actual.id === field.id && actual.value === field.value), "Dry run did not preserve field content");
  }
  log({ dryRun: input.category, verified: true });
}
if (!process.argv.includes("--create")) process.exit(0);
assert.ok(settings.allowAgentItemCreate, "Enable and save agent creation permission before live fixture tests.");
const previousHome = process.env.ONEPASSWORD_MCP_HOME;
const home = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-live-"));
const cleanup = new Map();
let client;
let complete = false;
try {
  process.env.ONEPASSWORD_MCP_HOME = home;
  await new StateStore().update(state => { state.settings = settings; });
  client = new Client({ name: "opmcp-live-verification", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, "dist/src/mcp.js")], env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)), stderr: "pipe" });
  transport.stderr?.resume();
  await client.connect(transport);
  assert.equal(client.getServerVersion().version, runtimeInfo.version);
  log({ handshake: client.getServerVersion() });
  for (const input of fixtures) {
    const { vault, ...args } = input;
    const response = await client.callTool({ name: "save_secret_item", arguments: args }, undefined, { timeout: 180_000 });
    const result = JSON.parse(response.content.find(part => part.type === "text").text);
    if (result.itemId) cleanup.set(result.itemId, { input, vault: result.vaultId });
    assert.ok(result.ok && result.created && result.verified, `MCP save incomplete: ${JSON.stringify(result)}`);
    const saved = await op.getItem(result.itemId, result.vaultId, true);
    verifyItemTemplate(saved, createItemTemplate(input), result.vaultId, result.itemId);
    const retryResponse = await client.callTool({ name: "save_secret_item", arguments: args }, undefined, { timeout: 180_000 });
    const retry = JSON.parse(retryResponse.content.find(part => part.type === "text").text);
    assert.equal(retry.itemId, result.itemId);
    assert.equal(retry.verified, true);
    log({ liveSave: input.category, verified: true, retryDeduplicated: true });
    if (input.category === "login") {
      let copied;
      try { copied = await op.copyItemToVault({ itemId: result.itemId, currentVault: result.vaultId, destinationVault: result.vaultId, requestId: runId }); }
      catch (error) { if (error.outcome?.itemId) cleanup.set(error.outcome.itemId, { input, vault: result.vaultId }); throw error; }
      cleanup.set(copied.id, { input, vault: result.vaultId });
      assert.notEqual(copied.id, result.itemId);
      verifyItemTemplate(copied, createItemTemplate(input), result.vaultId, copied.id);
      log({ liveCopy: "login", verified: true, concealedFieldsPreserved: true });
    }
  }
  complete = true;
} finally {
  if (client) await client.close();
  let removed = 0;
  for (const [itemId, { input, vault }] of cleanup) {
    try {
      const saved = await op.getItem(itemId, vault, true);
      verifyItemTemplate(saved, createItemTemplate(input), vault, itemId);
      assert.ok(saved.title.includes(runId) && saved.tags?.some(tag => tag.startsWith("opmcp-")), "Fixture identity changed; refusing cleanup");
      await op.deleteItem({ itemId, vault });
      removed += 1;
    } catch { complete = false; log({ cleanupFailed: true, itemId, vaultId: vault, stateDirectory: home }); }
  }
  log({ cleanup: removed, expected: cleanup.size, complete });
  if (previousHome === undefined) delete process.env.ONEPASSWORD_MCP_HOME;
  else process.env.ONEPASSWORD_MCP_HOME = previousHome;
  if (complete) await fs.rm(home, { recursive: true, force: true });
  else { log({ recoveryState: home }); process.exitCode = 1; }
}
