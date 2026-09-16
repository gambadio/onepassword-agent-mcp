import assert from "node:assert/strict";
import { once } from "node:events";
import { constants, type PathLike, type Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createAdminApp } from "../src/admin.js";
import { OpCli } from "../src/opCli.js";
import { resolveOpExecutable } from "../src/opExecutable.js";
import { fixture } from "./fixtures.js";

const guiPath = "/usr/bin:/bin:/usr/sbin:/sbin";

function availableExecutables(t: TestContext, files: string[], directories: string[] = []) {
  const access = t.mock.method(fs, "access", async (candidate: PathLike, mode?: number) => {
    assert.equal(mode, constants.X_OK);
    if (!files.includes(String(candidate)) && !directories.includes(String(candidate))) {
      throw Object.assign(new Error("Unavailable fixture"), { code: "ENOENT" });
    }
  });
  t.mock.method(fs, "stat", async (candidate: PathLike) => ({
    isFile: () => files.includes(String(candidate)),
  }) as Stats);
  return access;
}

for (const installedPath of ["/opt/homebrew/bin/op", "/usr/local/bin/op"]) {
  test(`Mac GUI launch discovers ${installedPath} without shell setup`, async t => {
    availableExecutables(t, [installedPath]);
    assert.equal(await resolveOpExecutable("op", { PATH: guiPath }, "darwin"), installedPath);
  });
}

test("the user's PATH installation takes precedence over Homebrew fallbacks", async t => {
  const custom = "/Applications/Custom CLI/bin/op";
  availableExecutables(t, [custom, "/opt/homebrew/bin/op", "/usr/local/bin/op"]);
  assert.equal(await resolveOpExecutable("op", { PATH: `/Applications/Custom CLI/bin:${guiPath}` }, "darwin"), custom);
});

test("unset PATH and an empty default setting still discover the Mac CLI", async t => {
  availableExecutables(t, ["/opt/homebrew/bin/op"]);
  assert.equal(await resolveOpExecutable("", {}, "darwin"), "/opt/homebrew/bin/op");
});

test("unusable candidates and directories do not hide a working installation", async t => {
  availableExecutables(t, ["/usr/local/bin/op"], ["/directory/op"]);
  assert.equal(await resolveOpExecutable("op", { PATH: `/unavailable:/directory:${guiPath}` }, "darwin"), "/usr/local/bin/op");
});

test("automatic discovery does not run op from an implicit working directory", async t => {
  availableExecutables(t, ["op", "relative/op", "/opt/homebrew/bin/op"]);
  assert.equal(await resolveOpExecutable("op", { PATH: `:relative:.:${guiPath}:` }, "darwin"), "/opt/homebrew/bin/op");
});

test("custom paths and wrappers are preserved even if another CLI is available", async t => {
  const access = availableExecutables(t, ["/opt/homebrew/bin/op"]);
  for (const configured of ["/missing/custom/op", "/custom path/op", "op-wrapper", "./op"]) {
    assert.equal(await resolveOpExecutable(configured, { PATH: guiPath }, "darwin"), configured);
  }
  assert.equal(access.mock.callCount(), 0);
});

test("a missing Mac CLI explains how to recover instead of returning exit code 127", async t => {
  availableExecutables(t, []);
  await assert.rejects(resolveOpExecutable("op", { PATH: guiPath }, "darwin"), error => {
    assert.match(String(error), /Install the 1Password CLI/);
    assert.match(String(error), /full path in Advanced local settings/);
    return true;
  });
});

test("other platforms keep their native executable lookup", async t => {
  const access = availableExecutables(t, []);
  for (const platform of ["linux", "win32"] as const) {
    assert.equal(await resolveOpExecutable("op", {}, platform), "op");
  }
  assert.equal(access.mock.callCount(), 0);
});

test("admin status resolves and executes a CLI symlink without changing saved settings", { skip: process.platform !== "darwin" }, async t => {
  const f = await fixture(t);
  const original = (await f.store.load()).settings.opPath;
  const bin = path.join(f.home, "custom bin");
  await fs.mkdir(bin);
  await fs.symlink(original, path.join(bin, "op"));
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${guiPath}`;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });
  await f.store.update(state => { state.settings.opPath = "op"; });
  const server = (await createAdminApp()).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/status`);
  const status = await response.json();
  assert.equal(response.status, 200);
  assert.equal(status.cli.installed, true);
  assert.equal(status.cli.authenticated, true);
  assert.equal(status.cli.path, path.join(bin, "op"));
  assert.equal(status.cli.mcpVault.exists, true);
  assert.equal((await f.store.load()).settings.opPath, "op");
});

test("a broken explicit path fails instead of switching to an available PATH CLI", { skip: process.platform !== "darwin" }, async t => {
  const f = await fixture(t);
  const settings = (await f.store.load()).settings;
  await fs.symlink(settings.opPath, path.join(f.home, "op"));
  const previousPath = process.env.PATH;
  process.env.PATH = `${f.home}:${guiPath}`;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });
  const op = new OpCli({ ...settings, opPath: path.join(f.home, "missing-op") });
  await assert.rejects(op.version(), /Executable not found/);
  await assert.rejects(fs.stat(path.join(f.home, "calls.jsonl")), { code: "ENOENT" });
});
