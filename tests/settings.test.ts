import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createAdminApp } from "../src/admin.js";
import { fixture } from "./fixtures.js";

const execFileAsync = promisify(execFile);
const cli = (...args: string[]) => execFileAsync(process.execPath, [
  "--import", "tsx", fileURLToPath(new URL("../src/cli.ts", import.meta.url)), "settings", ...args,
]);

test("admin and CLI share the persisted auto approval setting without changing other policy", async t => {
  const f = await fixture(t);
  const app = await createAdminApp();
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/settings`;
  const initial = (await f.store.load()).settings;
  assert.equal(initial.autoApproveAgentItems, false);
  const enabled = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoApproveAgentItems: true }) });
  assert.equal(enabled.status, 200);
  assert.equal((await enabled.json()).autoApproveAgentItems, true);
  assert.equal(JSON.parse((await cli("--json")).stdout).autoApproveAgentItems, true);
  await cli("auto-approve", "off");
  assert.equal((await (await fetch(url)).json()).autoApproveAgentItems, false);
  await cli("auto-approve", "on");
  assert.deepEqual((await f.store.load()).settings, { ...initial, autoApproveAgentItems: true });
  assert.equal((await (await fetch(url)).json()).autoApproveAgentItems, true);
  assert.equal((await f.store.load()).audit.filter(event => event.type === "settings.updated").length, 3);
});

test("invalid CLI settings and dry runs cannot enable automatic approval", async t => {
  const f = await fixture(t);
  const before = await f.store.load();
  for (const args of [["auto-approve", "yes-please"], ["auto-approve", "on", "unexpected"], ["unknown", "on"]]) {
    await assert.rejects(cli(...args));
    assert.deepEqual(await f.store.load(), before);
  }
  const preview = await cli("auto-approve", "on", "--dry-run");
  assert.match(preview.stdout, /dry run/i);
  assert.deepEqual(await f.store.load(), before);
});
