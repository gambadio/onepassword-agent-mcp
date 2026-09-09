import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcpTools.js";
import { runtimeInfo } from "../src/version.js";
import { PolicyService } from "../src/policy.js";
import { fixture } from "./fixtures.js";

async function connect(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t);
  const server = createMcpServer();
  const client = new Client({ name: "regression", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  const save = async (extra: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name: "save_secret_item", arguments: {
      title: "Synthetic MCP fixture", category: "secure_note", notes: "SYNTHETIC-MCP-CONTENT", ...extra,
    } });
    const text = (response.content as Array<{ text: string }>).map(content => content.text).join("");
    assert.equal(text.includes("SYNTHETIC-MCP-CONTENT"), false);
    let result;
    try { result = JSON.parse(text); } catch { result = { error: text }; }
    return { ...result, isError: Boolean(response.isError) };
  };
  return { ...f, save, client };
}

for (const mode of ["empty", "malformed", "blank", "missing-field", "wrong-id", "wrong-vault", "read-fails"]) {
  test(`MCP does not report success or audit a save with ${mode}`, async t => {
    const f = await connect(t);
    await f.mode(mode);
    const result = await f.save();
    assert.equal(result.ok, false);
    assert.equal(result.isError, true);
    assert.equal(result.verified, false);
    assert.ok(result.operationId);
    assert.equal((await f.store.load()).audit.filter(event => event.type === "item.saved").length, 0);
  });
}

test("MCP preflights approval selectors before creating an item", async t => {
  const f = await connect(t);
  const result = await f.save({ approveForAgents: true, approveField: "missing-field" });
  assert.equal(result.isError, true);
  assert.equal((await f.calls()).filter(call => call.args[1] === "create").length, 0);
});

test("MCP returns verified identities, version, and deduplicates save and audit on retry", async t => {
  const f = await connect(t);
  assert.equal(f.client.getServerVersion()?.version, runtimeInfo.version);
  const first = await f.save();
  const retry = await f.save();
  assert.equal(first.ok, true);
  assert.equal(first.verified, true);
  assert.equal(first.itemId, retry.itemId);
  assert.equal(first.vaultId, "vault-fixture");
  assert.equal(first.approvalStatus, "not_requested");
  assert.equal((await f.store.load()).audit.filter(event => event.type === "item.saved").length, 1);
});

test("approval failure is separate from verified creation and retry cannot duplicate the item", async t => {
  const f = await connect(t);
  t.mock.method(PolicyService.prototype, "createFromCandidate", async () => { throw new Error("SYNTHETIC-MCP-CONTENT"); });
  const result = await f.save({ approveForAgents: true });
  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.equal(result.approved, false);
  assert.equal(result.approvalStatus, "requires_review");
  const retry = await f.save({ approveForAgents: true });
  assert.equal(retry.itemId, result.itemId);
  assert.equal(retry.approvalStatus, "requires_review");
  assert.equal((await f.calls()).filter(call => call.args[1] === "create").length, 1);
});

test("save retry does not reinstate a revoked approval", async t => {
  const f = await connect(t);
  const result = await f.save({ approveForAgents: true });
  assert.equal(result.approved, true);
  const grant = (await f.store.load()).grants[0];
  await new PolicyService().deleteGrant(grant.id);
  const retry = await f.save({ approveForAgents: true });
  assert.equal(retry.itemId, result.itemId);
  assert.equal(retry.approved, false);
  assert.equal(retry.approvalStatus, "requires_review");
  assert.equal((await f.store.load()).grants.length, 0);
});

test("audit failure keeps verified save metadata and a retry reconciles the audit", async t => {
  const f = await connect(t);
  const { StateStore } = await import("../src/state.js");
  const original = StateStore.prototype.update;
  const mocked = t.mock.method(StateStore.prototype, "update", async function(this: InstanceType<typeof StateStore>, mutator: Parameters<typeof original>[0]) {
    return await original.call(this, async state => {
      await mutator(state);
      if (state.audit.some(event => event.type === "item.saved")) throw new Error("Synthetic audit storage failure");
    });
  });
  const saved = await f.save();
  assert.equal(saved.ok, true);
  assert.equal(saved.verified, true);
  assert.equal(saved.auditRecorded, false);
  assert.ok(saved.warnings.length);
  mocked.mock.restore();
  const retry = await f.save();
  assert.equal(retry.itemId, saved.itemId);
  assert.equal(retry.auditRecorded, true);
  assert.equal((await f.calls()).filter(call => call.args[1] === "create").length, 1);
});
