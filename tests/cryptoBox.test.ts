import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadOrCreateKey, openJson, sealJson } from "../src/cryptoBox.js";

test("sealJson/openJson round-trips payloads", () => {
  const key = crypto.randomBytes(32);
  const token = sealJson({ secretRef: "op://ExampleVault/ExampleLogin/password" }, key);
  assert.match(token, /^opmcp:v1:/);
  assert.deepEqual(openJson(token, key), { secretRef: "op://ExampleVault/ExampleLogin/password" });
});

test("openJson rejects tokens with the wrong key", () => {
  const token = sealJson({ value: "secret" }, crypto.randomBytes(32));
  assert.throws(() => openJson(token, crypto.randomBytes(32)));
});

test("loadOrCreateKey is safe for concurrent first use", async () => {
  const previousHome = process.env.ONEPASSWORD_MCP_HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-key-test-"));
  process.env.ONEPASSWORD_MCP_HOME = home;
  try {
    const keys = await Promise.all(Array.from({ length: 8 }, () => loadOrCreateKey()));
    const first = keys[0].toString("hex");
    assert.equal(keys.every((key) => key.toString("hex") === first), true);
  } finally {
    if (previousHome === undefined) delete process.env.ONEPASSWORD_MCP_HOME;
    else process.env.ONEPASSWORD_MCP_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  }
});
