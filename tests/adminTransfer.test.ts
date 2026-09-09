import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createAdminApp } from "../src/admin.js";
import { loadOrCreateKey } from "../src/cryptoBox.js";
import { StateStore } from "../src/state.js";
import { fixture } from "./fixtures.js";

test("admin copy preserves item identity through an audit failure and reconciles retry", async t => {
  const f = await fixture(t);
  const source = await f.op.createSecretItem({ title: "Synthetic transfer", vault: "source-vault", category: "password", password: "SYNTHETIC-ONLY" });
  const candidate = f.op.itemToCandidates(source, await loadOrCreateKey())[0];
  const app = await createAdminApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/op/transfer`;
  const transfer = async () => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: candidate.token, mode: "copy" }) });
    const data = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 201, JSON.stringify(data));
    assert.equal(JSON.stringify(data).includes("SYNTHETIC-ONLY"), false);
    return data;
  };
  const original = StateStore.prototype.update;
  const mocked = t.mock.method(StateStore.prototype, "update", async function(this: StateStore, mutator: Parameters<typeof original>[0]) {
    return await original.call(this, async state => {
      await mutator(state);
      if (state.audit.some(event => event.type === "item.copied")) throw new Error("Synthetic audit failure");
    });
  });
  const copied = await transfer();
  assert.equal(copied.verified, true);
  assert.equal(copied.auditRecorded, false);
  assert.ok(copied.itemId);
  mocked.mock.restore();
  const retry = await transfer();
  assert.equal(retry.itemId, copied.itemId);
  assert.equal(retry.auditRecorded, true);
  assert.equal((await f.store.load()).audit.filter(event => event.type === "item.copied").length, 1);
});
