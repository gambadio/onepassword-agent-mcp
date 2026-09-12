import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcpTools.js";
import { runtimeInfo } from "../src/version.js";
import { PolicyService } from "../src/policy.js";
import { loadOrCreateKey } from "../src/cryptoBox.js";
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

for (const autoApprove of [false, true]) {
test(`audit failure keeps verified save metadata and a retry reconciles the audit (auto approval ${autoApprove})`, async t => {
  const f = await connect(t);
  await f.store.update(state => { state.settings.autoApproveAgentItems = autoApprove; });
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
  assert.equal(retry.approvalStatus, autoApprove ? "approved" : "not_requested");
  assert.equal((await f.calls()).filter(call => call.args[1] === "create").length, 1);
});
}

const autoApprovalCases = [
  { category: "login", fields: { username: "synthetic-user", password: "SYNTHETIC-PASSWORD" }, kinds: ["password", "username"] },
  { category: "password", fields: { password: "SYNTHETIC-PASSWORD" }, kinds: ["password"] },
  { category: "api_credential", fields: { username: "synthetic-user", credential: "SYNTHETIC-API-KEY", hostname: "example.test" }, kinds: ["api_credential", "text", "username"] },
  { category: "secure_note", fields: {}, kinds: ["secure_note"] },
  { category: "credit_card", fields: { cardholderName: "Synthetic User", cardNumber: "4111111111111111", verificationNumber: "123", expiry: "2028/09", pin: "5678" }, kinds: ["credit_card_cvv", "credit_card_expiry", "credit_card_name", "credit_card_number", "credit_card_pin"] },
];

for (const entry of autoApprovalCases) {
  test(`auto approval makes every supported ${entry.category} field usable and deduplicates retries`, async t => {
    const f = await connect(t);
    await f.store.update(state => { state.settings.autoApproveAgentItems = true; });
    const input = { category: entry.category, ...entry.fields, url: "https://example.test/login" };
    const saved = await f.save(input);
    assert.equal(saved.verified, true);
    assert.equal(saved.approvalStatus, "approved");
    assert.equal(saved.approvedFields.length, entry.kinds.length);
    const policy = new PolicyService();
    const grants = await policy.findForSite("https://example.test/account");
    assert.deepEqual(grants.map(grant => grant.kind).sort(), entry.kinds);
    for (const grant of grants) {
      assert.equal(grant.itemId, saved.itemId);
      assert.equal(grant.vaultId, "vault-fixture");
      const resolved = await policy.resolveHandle(grant.handle, "https://example.test/account");
      assert.ok(resolved.secretRef.startsWith(`op://vault-fixture/${saved.itemId}/`));
      await assert.rejects(policy.resolveHandle(grant.handle, "https://elsewhere.test"), /Site is not allowed/);
    }
    const retried = await f.save(input);
    assert.equal(retried.itemId, saved.itemId);
    assert.equal(retried.approvalStatus, "approved");
    assert.equal((await f.store.load()).grants.length, entry.kinds.length);
    const listed = await f.client.callTool({ name: "list_approved_secrets", arguments: {} });
    assert.equal(JSON.stringify(listed).includes("SYNTHETIC-PASSWORD"), false);
    assert.equal(JSON.stringify(listed).includes("SYNTHETIC-API-KEY"), false);
  });
}

test("auto approval respects explicit opt-out and turning it off affects future saves only", async t => {
  const f = await connect(t);
  await f.store.update(state => { state.settings.autoApproveAgentItems = true; });
  const skipped = await f.save({ requestId: "skip", approveForAgents: false });
  assert.equal(skipped.approvalStatus, "not_requested");
  assert.equal((await f.store.load()).grants.length, 0);
  const saved = await f.save({ requestId: "approved", allowedSites: ["chosen.test"] });
  assert.equal(saved.approved, true);
  assert.deepEqual((await f.store.load()).grants[0].sites, ["chosen.test"]);
  await f.store.update(state => { state.settings.autoApproveAgentItems = false; });
  const later = await f.save({ requestId: "later" });
  assert.equal(later.approvalStatus, "not_requested");
  assert.equal((await f.store.load()).grants.length, 1);
});

for (const action of ["delete", "disable"] as const) {
  test(`auto approval retry preserves a user's ${action} of one field`, async t => {
    const f = await connect(t);
    await f.store.update(state => { state.settings.autoApproveAgentItems = true; });
    const input = { category: "login", username: "synthetic-user", password: "SYNTHETIC-PASSWORD" };
    const saved = await f.save(input);
    assert.equal(saved.approvalStatus, "approved");
    const grant = (await f.store.load()).grants.find(entry => entry.kind === "password")!;
    if (action === "delete") await new PolicyService().deleteGrant(grant.id);
    else await new PolicyService().updateGrant(grant.id, { enabled: false });
    const retried = await f.save(input);
    assert.equal(retried.itemId, saved.itemId);
    assert.equal(retried.approved, false);
    assert.equal(retried.approvalStatus, "requires_review");
    assert.deepEqual((await new PolicyService().listPublicGrants()).filter(entry => entry.enabled).map(entry => entry.kind), ["username"]);
  });
}

test("auto approval cannot grant access to an unverified item in another vault", async t => {
  const f = await connect(t);
  await f.store.update(state => { state.settings.autoApproveAgentItems = true; });
  await f.mode("wrong-vault");
  const saved = await f.save();
  assert.equal(saved.ok, false);
  assert.equal((await f.store.load()).grants.length, 0);
});

test("auto approval does not bypass disabled agent creation and status exposes the option", async t => {
  const f = await connect(t);
  await f.store.update(state => {
    state.settings.autoApproveAgentItems = true;
    state.settings.allowAgentItemCreate = false;
  });
  assert.equal((await f.save()).isError, true);
  assert.equal((await f.store.load()).operations!.length, 0);
  const status = await f.client.callTool({ name: "onepassword_status", arguments: {} });
  const data = JSON.parse((status.content as Array<{ text: string }>)[0].text);
  assert.equal(data.settings.autoApproveAgentItems, true);
});

test("a partial auto approval failure remains reviewable and retry does not add grants", async t => {
  const f = await connect(t);
  await f.store.update(state => { state.settings.autoApproveAgentItems = true; });
  const original = PolicyService.prototype.createFromCandidate;
  let count = 0;
  t.mock.method(PolicyService.prototype, "createFromCandidate", async function(this: PolicyService, ...args: Parameters<typeof original>) {
    if (++count === 2) throw new Error("SYNTHETIC-MCP-CONTENT");
    return await original.apply(this, args);
  });
  const input = { category: "login", username: "synthetic-user", password: "SYNTHETIC-PASSWORD" };
  const saved = await f.save(input);
  assert.equal(saved.verified, true);
  assert.equal(saved.approvalStatus, "requires_review");
  const before = (await f.store.load()).grants.map(grant => grant.id);
  const retry = await f.save(input);
  assert.equal(retry.itemId, saved.itemId);
  assert.equal(retry.approvalStatus, "requires_review");
  assert.deepEqual((await f.store.load()).grants.map(grant => grant.id), before);
});

test("enabling auto approval cannot change approvals on an older save retry", async t => {
  const f = await connect(t);
  const saved = await f.save();
  const key = await loadOrCreateKey();
  const item = await f.op.getItem(saved.itemId, saved.vaultId, true);
  const candidate = f.op.itemToCandidates(item, key)[0];
  const policy = new PolicyService();
  await policy.createFromCandidate(candidate.token, { sites: ["restricted.test"], enabled: false });
  const before = (await f.store.load()).grants;
  await f.store.update(state => {
    state.settings.autoApproveAgentItems = true;
    // Simulate an operation from a package version before this setting existed.
    delete state.operations![0].autoApproveRequested;
  });
  const retry = await f.save();
  assert.equal(retry.itemId, saved.itemId);
  assert.equal(retry.approvalStatus, "not_requested");
  assert.deepEqual((await f.store.load()).grants, before);
});

test("a save's explicit auto approval opt-out survives an ordinary retry", async t => {
  const f = await connect(t);
  await f.store.update(state => { state.settings.autoApproveAgentItems = true; });
  const saved = await f.save({ approveForAgents: false });
  const retry = await f.save();
  assert.equal(retry.itemId, saved.itemId);
  assert.equal(retry.approvalStatus, "not_requested");
  assert.equal((await f.store.load()).grants.length, 0);
});

test("explicit approval with auto approval off still approves only the selected field", async t => {
  const f = await connect(t);
  const saved = await f.save({ category: "credit_card", cardNumber: "4111111111111111", verificationNumber: "123", approveForAgents: true, approveField: "credit_card_cvv" });
  assert.equal(saved.approvalStatus, "approved");
  assert.deepEqual(saved.approvedFields, ["verification number"]);
  const grants = (await f.store.load()).grants;
  assert.deepEqual(grants.map(grant => grant.kind), ["credit_card_cvv"]);
  assert.deepEqual(grants[0].sites, []);
});

test("concurrent automatic saves grant each field only once", async t => {
  const f = await connect(t);
  await f.store.update(state => { state.settings.autoApproveAgentItems = true; });
  const input = { category: "login", username: "synthetic-user", password: "SYNTHETIC-PASSWORD" };
  const results = await Promise.all([f.save(input), f.save(input)]);
  assert.equal(results[0].itemId, results[1].itemId);
  assert.equal(results[0].approvalStatus, "approved");
  assert.equal(results[1].approvalStatus, "approved");
  assert.deepEqual((await f.store.load()).grants.map(grant => grant.kind).sort(), ["password", "username"]);
});

test("auto approval reconciliation excludes fields added after the agent's save", async t => {
  const f = await connect(t);
  await f.store.update(state => { state.settings.autoApproveAgentItems = true; });
  await f.mode("read-fails");
  const failed = await f.save();
  assert.equal(failed.verified, false);
  const itemPath = path.join(f.home, "fixture-items.json");
  const items = JSON.parse(await fs.readFile(itemPath, "utf8"));
  items[0].fields.push({ id: "human-key", type: "CONCEALED", label: "Later human key", value: "SYNTHETIC-HUMAN-KEY" });
  await fs.writeFile(itemPath, JSON.stringify(items));
  await f.mode("valid");
  const retried = await f.save();
  assert.equal(retried.itemId, items[0].id);
  assert.equal(retried.approvalStatus, "approved");
  assert.deepEqual(retried.approvedFields, ["notesPlain"]);
  assert.deepEqual((await f.store.load()).grants.map(grant => grant.kind), ["secure_note"]);
});
