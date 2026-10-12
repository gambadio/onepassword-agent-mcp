import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { prepareBundle, finishProductionInstall, normalizeArchive } = await import(
  pathToFileURL(path.resolve("scripts/build-mcpb.mjs")).href
);

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcpb-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, "project");
  const staging = path.join(directory, "bundle");
  const pkg = { name: "fixture", version: "1.0.0", type: "module", dependencies: { runtime: "1.0.0" }, devDependencies: { developer: "1.0.0" }, scripts: { install: "exit 1" } };
  const lock = { version: "1.0.0", packages: { "": { version: "1.0.0" }, "node_modules/runtime": { version: "1.0.0" }, "node_modules/developer": { version: "1.0.0", dev: true } } };
  const manifest = { name: "fixture", version: "1.0.0", server: { type: "node", entry_point: "dist/src/mcp.js", mcp_config: { command: "node", args: ["${__dirname}/dist/src/mcp.js"] } } };
  const files: Record<string, string> = {
    "package.json": JSON.stringify(pkg), "package-lock.json": JSON.stringify(lock), "manifest.json": JSON.stringify(manifest),
    "README.md": "readme", "LICENSE": "MIT", "dist/src/mcp.js": "console.error('stdio');", "dist/src/mcp.js.map": "map",
    "native/MenuBarApp.swift": "source", "native/AppIcon.icns": "icon", "public/app.js": "app", "public/assets/logo.svg": "svg",
    ".env": "secret", ".npmrc": "token", ".onepassword-mcp/key.bin": "key", "public/.env": "secret", "public/policy.json": "secret",
    "node_modules/developer/index.js": "dev", "tests/secret.fixture": "secret",
  };
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(project, name)), { recursive: true });
    await fs.writeFile(path.join(project, name), content);
  }
  return { project, staging, pkg, lock };
}

test("MCPB stages only runtime inputs without local state or existing dependencies", async t => {
  const { project, staging } = await fixture(t);
  await prepareBundle(project, staging);
  assert.equal(await fs.readFile(path.join(staging, "dist/src/mcp.js"), "utf8"), "console.error('stdio');");
  assert.equal(await fs.readFile(path.join(staging, "public/assets/logo.svg"), "utf8"), "svg");
  for (const name of [".env", ".npmrc", ".onepassword-mcp", "node_modules", "tests", "public/.env", "public/policy.json", "dist/src/mcp.js.map"]) {
    await assert.rejects(fs.access(path.join(staging, name)), { code: "ENOENT" });
  }
});

test("MCPB rejects inconsistent versions before staging", async t => {
  const { project, staging } = await fixture(t);
  const manifest = JSON.parse(await fs.readFile(path.join(project, "manifest.json"), "utf8"));
  manifest.version = "2.0.0";
  await fs.writeFile(path.join(project, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(prepareBundle(project, staging), /matching names and versions/);
  await assert.rejects(fs.access(staging), { code: "ENOENT" });
});

test("MCPB refuses runtime symlinks that could include data outside the project", async t => {
  const { project, staging } = await fixture(t);
  await fs.symlink(path.join(project, ".env"), path.join(project, "public/leak.js"));
  await assert.rejects(prepareBundle(project, staging), /must not be a symlink/);
});

test("MCPB checks production-only install and strips build metadata", async t => {
  const { project, staging, pkg, lock } = await fixture(t);
  await prepareBundle(project, staging);
  await fs.mkdir(path.join(staging, "node_modules/developer"), { recursive: true });
  await assert.rejects(finishProductionInstall(staging, pkg, lock), /Development dependency/);
  await fs.rm(path.join(staging, "node_modules/developer"), { recursive: true });
  await fs.mkdir(path.join(staging, "node_modules/runtime"));
  await finishProductionInstall(staging, pkg, lock);
  const runtime = JSON.parse(await fs.readFile(path.join(staging, "package.json"), "utf8"));
  assert.deepEqual(runtime.dependencies, pkg.dependencies);
  assert.equal(runtime.devDependencies, undefined);
  assert.equal(runtime.scripts, undefined);
  await assert.rejects(fs.access(path.join(staging, "package-lock.json")), { code: "ENOENT" });
});

test("MCPB normalization gives identical bytes despite build time and host metadata", () => {
  // A minimal ZIP with one empty file: timestamp/host changes must not change the artifact.
  const name = Buffer.from("manifest.json");
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  const first = Buffer.concat([local, central, end]);
  const second = Buffer.from(first);
  second.writeUInt32LE(123456, 10);
  second.writeUInt32LE(654321, local.length + 12);
  second.writeUInt16LE(123, local.length + 4);
  second.writeUInt32LE(456, local.length + 38);
  assert.deepEqual(normalizeArchive(first), normalizeArchive(second));
  assert.throws(() => normalizeArchive(Buffer.alloc(30)), /Invalid or unsupported/);
});
