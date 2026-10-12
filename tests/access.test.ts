import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import test from "node:test";
import { AccessStore } from "../src/access.js";
import { OpCli } from "../src/opCli.js";
import { createAdminApp } from "../src/admin.js";
import { fixture } from "./fixtures.js";

const token = "ops_SYNTHETIC_ONLY_1234567890";

test("service account is encrypted, redacted and revocable across store instances", async t => {
  const f = await fixture(t);
  const access = new AccessStore({});
  assert.deepEqual(await access.status(), { mode: "desktop", configured: false, enabled: false, source: "none" });
  const saved = await access.save(token);
  assert.equal(saved.mode, "service_account");
  assert.equal(JSON.stringify(saved).includes(token), false);
  const disk = await fs.readFile(path.join(f.home, "access.json"), "utf8");
  assert.equal(disk.includes(token), false);
  assert.equal((await fs.stat(path.join(f.home, "access.json"))).mode & 0o777, 0o600);
  assert.equal(await new AccessStore({}).token(), token);
  await access.setEnabled(false);
  assert.equal(await access.token(), undefined);
  assert.equal((await access.status()).configured, true);
  await access.setEnabled(true);
  assert.equal(await access.token(), token);
  await access.remove();
  assert.equal((await access.status()).configured, false);
  await assert.rejects(access.setEnabled(true), /save a service.account token/i);
});

test("environment credentials take precedence and cannot be disabled by local toggles", async t => {
  await fixture(t);
  const envToken = "ops_ENVIRONMENT_SYNTHETIC_12345";
  const access = new AccessStore({ OP_SERVICE_ACCOUNT_TOKEN: envToken });
  await access.save(token);
  await access.setEnabled(false);
  assert.equal(await access.token(), envToken);
  assert.deepEqual(await access.status(), { mode: "environment", configured: true, enabled: true, source: "environment" });
});

test("invalid tokens and corrupt encrypted configuration fail without disclosure", async t => {
  const f = await fixture(t);
  const access = new AccessStore({});
  for (const bad of ["", "a password", "ops_bad token", token + "\nextra", token + "\0", token + "\u001b"]) {
    await assert.rejects(access.save(bad), error => !String(error).includes(bad || "UNMATCHABLE"));
  }
  const invalidEnvironment = new AccessStore({ OP_SERVICE_ACCOUNT_TOKEN: token + "\0" });
  await assert.rejects(invalidEnvironment.token(), error => !String(error).includes(token));
  await access.save(token);
  await fs.writeFile(path.join(f.home, "access.json"), JSON.stringify({ enabled: true, encryptedToken: token }));
  await assert.rejects(access.token(), /unable to read saved service.account/i);
});

test("CLI passes service credential only in environment and removes desktop account selection", async t => {
  const f = await fixture(t);
  await new AccessStore().save(token);
  const probe = path.join(f.home, "auth-probe.cjs");
  await fs.writeFile(probe, `#!${process.execPath}\nconst ok = process.env.OP_SERVICE_ACCOUNT_TOKEN === ${JSON.stringify(token)} && !process.env.OP_ACCOUNT && !process.argv.includes('--account'); process.stdout.write(ok ? 'valid' : 'invalid');`, { mode: 0o755 });
  const settings = { ...(await f.store.load()).settings, opPath: probe, account: "desktop-account" };
  assert.equal((await new OpCli(settings).run(["probe"])).stdout, "valid");
});

test("access API never echoes tokens, persists clipboard opt-in and rejects cross-origin writes", async t => {
  const f = await fixture(t);
  const server = (await createAdminApp()).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const put = (url: string, body: unknown, origin?: string) => fetch(base + url, { method: "PUT", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  assert.equal((await put("/api/access", { token }, "https://untrusted.example")).status, 403);
  assert.equal((await new AccessStore({}).status()).configured, false);
  const saved = await put("/api/access", { token }, base);
  assert.equal(saved.status, 200);
  assert.equal((await saved.text()).includes(token), false);
  const malformed = await fetch(base + "/api/access", { method: "PUT", headers: { "Content-Type": "application/json" }, body: `{"token":"${token}` });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.text()).includes(token), false);
  const crossSite = await fetch(base + "/api/access", { method: "DELETE", headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(crossSite.status, 403);
  // Fetch normalizes Host; raw HTTP models DNS rebinding's actual request.
  const rebindingStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(base + "/api/access", { headers: { Host: "attacker.example" } }, res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on("error", reject); req.end();
  });
  assert.equal(rebindingStatus, 403);
  const disabled = await fetch(base + "/api/access", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
  assert.equal((await disabled.json()).enabled, false);
  assert.equal(await new AccessStore({}).token(), undefined);
  const status = await (await fetch(base + "/api/status")).text();
  assert.equal(status.includes(token), false);
  const result = await fetch(base + "/api/access/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.deepEqual(await result.json(), { ok: true, vaultVisible: true, canWrite: "not_tested" });
  assert.equal((await put("/api/settings", { allowClipboardSave: true }, base)).status, 200);
  assert.equal((await f.store.load()).settings.allowClipboardSave, true);
  const removed = await fetch(base + "/api/access", { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal((await new AccessStore({}).status()).configured, false);
});
