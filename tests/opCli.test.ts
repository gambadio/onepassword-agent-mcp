import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ItemWriteError } from "../src/opCli.js";
import type { CreateSecretItemInput } from "../src/types.js";
import { fixture } from "./fixtures.js";

const placeholder = 'SYNTHETIC ONLY: "quotes"\nUnicode ä $HOME `id` $(id)';
const inputs: Array<Partial<CreateSecretItemInput> & { category: CreateSecretItemInput["category"] }> = [
  { category: "login", username: "synthetic-user", password: placeholder },
  { category: "password", password: placeholder },
  { category: "api_credential", credential: placeholder, hostname: "example.invalid", username: "synthetic" },
  { category: "secure_note", notes: placeholder },
  { category: "credit_card", cardholderName: "Test Only", cardNumber: "4111111111111111", verificationNumber: "123", expiry: "2028/09", pin: "1234" },
];
for (const input of inputs) {
  test(`create ${input.category} consumes an OS pipe and verifies exact readback`, async (t) => {
    const f = await fixture(t);
    const created = await f.op.createSecretItem({ vault: "vault-fixture", title: "Synthetic item", notes: placeholder, url: "https://example.invalid", ...input });
    assert.equal(created.verified, true);
    assert.equal(created.id, "fixture-1");
    if (input.category === "credit_card") assert.ok(created.sections?.some(section => section.id === "details"));
    const calls = await f.calls();
    const create = calls.find(call => call.args[1] === "create");
    assert.deepEqual(create.args, ["item", "create", "--vault", "vault-fixture", "-"]);
    assert.ok(process.platform === "win32" || create.fifo);
    assert.equal(JSON.stringify(calls).includes(placeholder), false);
    assert.ok(calls.some(call => call.args[1] === "get" && call.args.includes("--reveal")));
  });
}

for (const mode of ["empty", "malformed", "blank", "missing-field", "wrong-value", "wrong-vault", "wrong-id", "read-fails"]) {
  test(`creation rejects ${mode} output with a durable recovery identity`, async (t) => {
    const f = await fixture(t);
    await f.mode(mode);
    await assert.rejects(f.op.createSecretItem({ vault: "vault-fixture", title: "Fixture", category: "password", password: placeholder }), (error: unknown) => {
      assert.ok(error instanceof ItemWriteError);
      assert.equal(error.outcome.verified, false);
      assert.equal(error.message.includes(placeholder), false);
      assert.ok(error.outcome.operationId);
      return true;
    });
    const state = await f.store.load();
    assert.equal(state.operations?.length, 1);
    assert.equal(state.operations?.[0].verified, false);
    assert.equal(JSON.stringify(state).includes(placeholder), false);
  });
}

test("retry reconciles lost create output by its unique tag without creating again", async (t) => {
  const f = await fixture(t);
  const input = { vault: "vault-fixture", title: "Retry", category: "secure_note" as const, notes: placeholder, requestId: "retry-1" };
  await f.mode("lost-output");
  await assert.rejects(f.op.createSecretItem(input));
  await f.mode("valid");
  const result = await f.op.createSecretItem(input);
  assert.equal(result.verified, true);
  assert.equal((await f.calls()).filter(call => call.args[1] === "create").length, 1);
  await assert.rejects(f.op.createSecretItem({ ...input, notes: "different" }), /different item contents/);
});

test("concurrent identical saves serialize and deduplicate; new requestId allows intentional duplicate", async (t) => {
  const f = await fixture(t);
  const input = { vault: "vault-fixture", title: "Retry", category: "secure_note" as const, notes: placeholder };
  const results = await Promise.all([f.op.createSecretItem(input), f.op.createSecretItem(input)]);
  assert.equal(results[0].id, results[1].id);
  assert.equal((await f.calls()).filter(call => call.args[1] === "create").length, 1);
  const second = await f.op.createSecretItem({ ...input, requestId: "intentional-duplicate" });
  assert.notEqual(second.id, results[0].id);
});

test("copy preserves concealed fields and reports the verified destination item", async (t) => {
  const f = await fixture(t);
  const source = await f.op.createSecretItem({ vault: "source-vault", title: "Copy fixture", category: "password", password: placeholder });
  const copied = await f.op.copyItemToVault({ itemId: source.id, currentVault: "source-vault", destinationVault: "vault-fixture" });
  assert.notEqual(copied.id, source.id);
  assert.equal(copied.vault?.id, "vault-fixture");
  assert.equal(copied.fields?.find(field => field.id === "password")?.value, placeholder);
  const again = await f.op.copyItemToVault({ itemId: source.id, currentVault: "source-vault", destinationVault: "vault-fixture" });
  assert.equal(again.id, copied.id);
});

test("copy rejects unverified content without a category fallback", async (t) => {
  const f = await fixture(t);
  const source = await f.op.createSecretItem({ vault: "source-vault", title: "Copy fixture", category: "password", password: placeholder });
  await f.mode("missing-field");
  await assert.rejects(f.op.copyItemToVault({ itemId: source.id, currentVault: "source-vault", destinationVault: "vault-fixture", category: "PASSWORD" }), /field content/);
  assert.equal((await f.calls()).filter(call => call.args.includes("--category")).length, 0);
});

test("custom field types and purposes are classified regardless of casing or field ID", async (t) => {
  const f = await fixture(t);
  const candidates = f.op.itemToCandidates({ id: "item", title: "Fixture", category: "IDENTITY", vault: { id: "vault-fixture" }, fields: [
    { id: "a", type: "CONCEALED" }, { id: "b", purpose: "PASSWORD" },
    { id: "c", purpose: "USERNAME", value: "synthetic-user" }, { id: "d", type: "OTP" }, { id: "e", type: "SSHKEY" },
  ] }, Buffer.alloc(32, 7));
  assert.deepEqual(candidates.map(candidate => candidate.kind), ["custom", "password", "username", "otp", "ssh_private_key"]);
  assert.equal(candidates[0].username, "synthetic-user");
  assert.equal(candidates[2].username, undefined);
});

test("candidate item limit keeps all fields and stops on a connection failure", async (t) => {
  const f = await fixture(t);
  const item = { id: "good", title: "Synthetic", category: "LOGIN", vault: { id: "vault-fixture" }, fields: [{ id: "username", value: "fixture" }, { id: "password", type: "CONCEALED" }] };
  t.mock.method(f.op, "run", async () => ({ stdout: JSON.stringify([item, { ...item, id: "bad" }]), stderr: "" }));
  t.mock.method(f.op, "getItem", async (id: string) => { if (id === "bad") throw new Error("Unavailable"); return item; });
  const limited = await f.op.listCandidates({ key: Buffer.alloc(32, 8), limit: 1 });
  assert.equal(limited.shown, 2);
  assert.equal(limited.limited, true);
  await assert.rejects(f.op.listCandidates({ key: Buffer.alloc(32, 8) }), /Unavailable/);
});

test("move and delete use explicit vault scopes", async (t) => {
  const f = await fixture(t);
  await f.op.moveItemToVault({ itemId: "item", currentVault: "source", destinationVault: "dest" });
  await f.op.deleteItem({ itemId: "item", vault: "dest" });
  assert.deepEqual((await f.calls()).map(call => call.args), [
    ["item", "move", "item", "--current-vault", "source", "--destination-vault", "dest"],
    ["item", "delete", "item", "--vault", "dest"],
  ]);
});

test("credit card expiry is canonicalized before sending and invalid months fail before creation", async t => {
  const f = await fixture(t);
  const item = await f.op.createSecretItem({ vault: "vault-fixture", title: "Expiry fixture", category: "credit_card", expiry: "2028/09" });
  assert.equal(item.fields?.find(field => field.id === "expiry")?.value, "202809");
  await assert.rejects(f.op.createSecretItem({ vault: "vault-fixture", title: "Invalid expiry", category: "credit_card", expiry: "2028/99" }), /valid month/);
  assert.equal((await f.calls()).filter(call => call.args[1] === "create").length, 1);
});
