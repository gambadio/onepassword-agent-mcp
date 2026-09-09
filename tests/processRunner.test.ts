import assert from "node:assert/strict";
import test from "node:test";
import { runProcess } from "../src/processRunner.js";

test("early stdin close rejects without an unhandled EPIPE", async () => {
  await assert.rejects(runProcess(process.execPath, ["-e", "process.exit(1)"], { input: "x".repeat(1024 * 1024) }));
  const next = await runProcess(process.execPath, ["-e", "process.stdout.write('alive')"]);
  assert.equal(next.stdout, "alive");
});

test("timeout and cancellation kill a pipeline and its descendants", { skip: process.platform === "win32" }, async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const timer = cancel ? setTimeout(() => controller.abort(), 150) : undefined;
    await assert.rejects(runProcess(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},100)"], {
      input: "synthetic", osPipe: true, timeoutMs: 150, signal: controller.signal,
    }), /timed out|cancelled/);
    clearTimeout(timer);
  }
});

test("bounds output and never echoes failed process output", async () => {
  await assert.rejects(runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000))"], { maxOutputBytes: 100 }), /allowed size/);
  await assert.rejects(runProcess(process.execPath, ["-e", "process.stderr.write('PRIVATE-SYNTHETIC');process.exit(1)"]), error => {
    assert.equal(String(error).includes("PRIVATE-SYNTHETIC"), false);
    return true;
  });
});

test("missing executable rejects without leaking input", async () => {
  await assert.rejects(runProcess("/does/not/exist/opmcp", [], { input: "synthetic" }), /Executable not found/);
});

test("timeout removes a stubborn grandchild, not just its shell", { skip: process.platform === "win32" }, async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-process-tree-"));
  const pidFile = path.join(dir, "pid");
  try {
    const script = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
      const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});
      fs.writeFileSync(process.argv[1],String(descendant.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
    await assert.rejects(runProcess(process.execPath, ["-e", script, pidFile], { input: "fixture", osPipe: true, timeoutMs: 300 }), /timed out/);
    const pid = Number(await fs.readFile(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
