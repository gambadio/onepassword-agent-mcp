import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAdminApp } from "../src/admin.js";
import {
  adminRuntimePath,
  adminShutdownHeader,
  adminShutdownTokenMatches,
  clearAdminRuntime,
  createAdminRuntimeRecord,
  isLikelyAdminCommand,
  readAdminRuntime,
  writeAdminRuntime,
} from "../src/adminRuntime.js";

test("admin runtime record is private and removed only by its owner", async (t) => {
  const previousHome = process.env.ONEPASSWORD_MCP_HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "onepassword-admin-runtime-"));
  process.env.ONEPASSWORD_MCP_HOME = home;
  t.after(async () => {
    if (previousHome === undefined) delete process.env.ONEPASSWORD_MCP_HOME;
    else process.env.ONEPASSWORD_MCP_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  });

  const record = createAdminRuntimeRecord({ adminHost: "127.0.0.1", adminPort: 7319 });
  await writeAdminRuntime(record);
  assert.deepEqual(await readAdminRuntime(), record);
  assert.equal((await fs.stat(adminRuntimePath())).mode & 0o777, 0o600);

  await clearAdminRuntime("another-instance");
  assert.deepEqual(await readAdminRuntime(), record);
  await clearAdminRuntime(record.instanceId);
  assert.equal(await readAdminRuntime(), undefined);
});

test("admin shutdown tokens use exact constant-time matching", () => {
  const token = "a".repeat(43);
  assert.equal(adminShutdownTokenMatches(token, token), true);
  assert.equal(adminShutdownTokenMatches(token, `${token}x`), false);
  assert.equal(adminShutdownTokenMatches(token, undefined), false);
});

test("legacy process fallback accepts only this package's admin command", () => {
  const cli = "/Users/example/lib/node_modules/onepassword-agent-mcp/dist/src/cli.js";
  assert.equal(isLikelyAdminCommand(`node ${cli} admin`, cli), true);
  assert.equal(isLikelyAdminCommand("node /tmp/other-server.js admin", cli), false);
  assert.equal(isLikelyAdminCommand(`node ${cli} mcp`, cli), false);
  assert.equal(
    isLikelyAdminCommand("node /Users/example/lib/node_modules/onepassword-agent-mcp/dist/src/admin.js", cli),
    true,
  );
});

test("admin health is lightweight and shutdown requires the private token", async (t) => {
  const token = "private-local-token";
  let shutdownRequested = false;
  const app = await createAdminApp({
    shutdownToken: token,
    onShutdownRequested: () => {
      shutdownRequested = true;
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const rejected = await fetch(`${baseUrl}/api/runtime/stop`, { method: "POST" });
  assert.equal(rejected.status, 401);
  assert.equal(shutdownRequested, false);

  const accepted = await fetch(`${baseUrl}/api/runtime/stop`, {
    method: "POST",
    headers: { [adminShutdownHeader]: token },
  });
  assert.equal(accepted.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownRequested, true);
});
