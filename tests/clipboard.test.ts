import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ClipboardCapture, CAPTURE_TTL_MS } from "../src/clipboardCapture.js";
import { LocalClipboard } from "../src/paste.js";
import { fixture } from "./fixtures.js";

test("clipboard capture encrypts exact text and binds retries to the snapshot", async t => {
  const f = await fixture(t);
  let text = "  Synthetic 🔐\r\nsecret\n";
  const original = text;
  let reads = 0;
  const clipboard = { readText: async () => { reads++; return text; }, clearIfUnchanged: async (expected: string) => {
    if (text !== expected) return "changed" as const;
    text = ""; return "cleared" as const;
  } };
  const capture = new ClipboardCapture(clipboard);
  const first = await capture.use("request-one", { category: "password" }, async secret => secret);
  assert.equal(first.value, original);
  assert.equal(first.clipboardStatus, "cleared");
  text = "different synthetic clipboard";
  const retry = await capture.use("request-one", { category: "password" }, async secret => secret);
  assert.equal(retry.value, original);
  assert.equal(text, "different synthetic clipboard");
  assert.equal(reads, 1);
  const dir = path.join(f.home, "clipboard-captures");
  const files = await fs.readdir(dir);
  assert.equal(files.length, 1);
  const disk = await fs.readFile(path.join(dir, files[0]), "utf8");
  assert.equal(disk.includes(original), false);
  assert.equal(disk.includes("Synthetic"), false);
  assert.equal((await fs.stat(path.join(dir, files[0]))).mode & 0o777, 0o600);
  await assert.rejects(capture.use("request-one", { category: "secure_note" }, async () => true), /metadata/);
  assert.equal(reads, 1);
});

test("expired captures erase encrypted payload and refuse a fresh clipboard read", async t => {
  const f = await fixture(t);
  let now = Date.now();
  let reads = 0;
  const capture = new ClipboardCapture({ readText: async () => { reads++; return "synthetic"; }, clearIfUnchanged: async () => "cleared" }, () => now);
  await capture.use("expiring", {}, async () => true);
  now += CAPTURE_TTL_MS + 1;
  await assert.rejects(capture.use("expiring", {}, async () => true), /expired/);
  assert.equal(reads, 1);
  const dir = path.join(f.home, "clipboard-captures");
  const entry = JSON.parse(await fs.readFile(path.join(dir, (await fs.readdir(dir))[0]), "utf8"));
  assert.equal(entry.sealed, undefined);
  await assert.rejects(capture.use("expiring", {}, async () => true), /expired/);
});

for (const text of ["", "synthetic\u0000binary", "\ud800", "x".repeat(1024 * 1024 + 1)]) {
  test(`invalid clipboard input is rejected without persistent capture (${text.length} chars)`, async t => {
    await fixture(t);
    let clears = 0;
    const capture = new ClipboardCapture({ readText: async () => text, clearIfUnchanged: async () => { clears++; return "cleared"; } });
    await assert.rejects(capture.use("invalid", {}, async () => assert.fail("must not save")), /clipboard/i);
    assert.equal(clears, 0);
  });
}

test("clipboard errors cannot echo secrets, and clear failures keep recoverable captures", async t => {
  await fixture(t);
  const capture = new ClipboardCapture({ readText: async () => { throw new Error("SYNTHETIC-SECRET"); }, clearIfUnchanged: async () => "cleared" });
  await assert.rejects(capture.use("failed-read", {}, async () => true), error => !String(error).includes("SYNTHETIC-SECRET"));
  const clearFailure = new ClipboardCapture({ readText: async () => "SYNTHETIC-SECRET", clearIfUnchanged: async () => { throw new Error("SYNTHETIC-SECRET"); } });
  const saved = await clearFailure.use("failed-clear", {}, async () => "metadata");
  assert.equal(saved.clipboardStatus, "clear_failed");
  assert.equal(JSON.stringify(saved).includes("SYNTHETIC-SECRET"), false);
});

for (const platform of ["darwin", "win32", "linux"] as const) {
  test(`local clipboard commands preserve exact text without passing it in arguments (${platform})`, async () => {
    const calls: Array<{ command: string; args: string[]; input?: string }> = [];
    const exact = "  Synthetic 🔑\r\ntrailing\n";
    const clipboard = new LocalClipboard(async (command, args, options) => {
      calls.push({ command, args, input: options?.input });
      return { stdout: exact, stderr: "" };
    }, platform);
    assert.equal(await clipboard.readText(), exact);
    assert.equal(await clipboard.clearIfUnchanged(exact), "cleared");
    assert.equal(calls.length, 3);
    assert.equal(JSON.stringify(calls.map(call => call.args)).includes("Synthetic"), false);
    assert.equal(calls[2].input, "");
  });
}

test("conditional clipboard clearing preserves changed content", async () => {
  let calls = 0;
  const clipboard = new LocalClipboard(async () => { calls++; return { stdout: "new clipboard", stderr: "" }; }, "darwin");
  assert.equal(await clipboard.clearIfUnchanged("original clipboard"), "changed");
  assert.equal(calls, 1);
});

test("corrupt encrypted capture cannot fall back to reading a different clipboard", async t => {
  const f = await fixture(t);
  let reads = 0;
  const capture = new ClipboardCapture({ readText: async () => { reads++; return "SYNTHETIC-ORIGINAL"; }, clearIfUnchanged: async () => "changed" });
  await capture.use("corrupt", {}, async () => true);
  const dir = path.join(f.home, "clipboard-captures");
  const file = path.join(dir, (await fs.readdir(dir))[0]);
  const entry = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(file, JSON.stringify({ ...entry, sealed: "opmcp:v1:tampered" }));
  await assert.rejects(capture.use("corrupt", {}, async () => true), /invalid/);
  assert.equal(reads, 1);
});

test("failed vault action retains the encrypted snapshot for a retry", async t => {
  await fixture(t);
  let reads = 0;
  const capture = new ClipboardCapture({ readText: async () => { reads++; return "synthetic snapshot"; }, clearIfUnchanged: async () => "cleared" });
  await assert.rejects(capture.use("failed-vault", {}, async () => { throw new Error("Synthetic vault failure"); }), /vault failure/);
  const retry = await capture.use("failed-vault", {}, async secret => { assert.equal(secret, "synthetic snapshot"); return true; });
  assert.equal(retry.value, true);
  assert.equal(retry.reusedCapture, true);
  assert.equal(reads, 1);
});
