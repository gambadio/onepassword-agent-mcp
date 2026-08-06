import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  claudeDesktopConfigPath,
  removeJsonMcpServer,
  serverName,
  setJsonMcpServer,
  vscodeConfigPath,
} from "../src/clientSetup.js";

test("client config merge preserves unrelated settings and creates a protected backup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onepassword-agent-client-"));
  const configPath = path.join(directory, "client.json");
  const original = {
    theme: "system",
    mcpServers: {
      existing: { command: "existing-server", args: [] },
      [serverName]: { command: "old-server", args: ["mcp"], env: { EXISTING_OPTION: "keep" } },
    },
  };
  await writeFile(configPath, `${JSON.stringify(original, null, 2)}\n`, { mode: 0o640 });
  await chmod(configPath, 0o640);

  const changed = setJsonMcpServer(
    configPath,
    "mcpServers",
    { command: "/opt/bin/onepassword-agent-mcp", args: ["mcp"] },
    false,
  );

  assert.equal(changed, true);
  const merged = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(merged.theme, "system");
  assert.equal(merged.mcpServers.existing.command, "existing-server");
  assert.deepEqual(merged.mcpServers[serverName], {
    command: "/opt/bin/onepassword-agent-mcp",
    args: ["mcp"],
    env: { EXISTING_OPTION: "keep" },
  });
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);

  const backups = (await readdir(directory)).filter((entry) => entry.startsWith("client.json.bak."));
  assert.equal(backups.length, 1);
  assert.equal((await stat(path.join(directory, backups[0]))).mode & 0o777, 0o640);
});

test("client config merge is idempotent and uninstall preserves other servers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onepassword-agent-client-"));
  const configPath = path.join(directory, "mcp.json");
  const launch = { command: "/opt/bin/onepassword-agent-mcp", args: ["mcp"] };

  assert.equal(setJsonMcpServer(configPath, "servers", launch, true), true);
  assert.equal(setJsonMcpServer(configPath, "servers", launch, true), false);

  const withPeer = JSON.parse(await readFile(configPath, "utf8"));
  withPeer.servers.peer = { type: "stdio", command: "peer", args: [] };
  await writeFile(configPath, `${JSON.stringify(withPeer, null, 2)}\n`);

  assert.equal(removeJsonMcpServer(configPath, "servers"), true);
  const removed = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(removed.servers[serverName], undefined);
  assert.equal(removed.servers.peer.command, "peer");
  assert.equal(removeJsonMcpServer(configPath, "servers"), false);
});

test("client config merge refuses malformed JSON without replacing it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onepassword-agent-client-"));
  const configPath = path.join(directory, "client.json");
  await writeFile(configPath, "{ malformed\n");

  assert.throws(() => {
    setJsonMcpServer(configPath, "mcpServers", { command: "server", args: ["mcp"] }, false);
  });
  assert.equal(await readFile(configPath, "utf8"), "{ malformed\n");
});

test("client config merge refuses an invalid server collection without discarding it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onepassword-agent-client-"));
  const configPath = path.join(directory, "client.json");
  await writeFile(configPath, '{"mcpServers":["keep-me"]}\n');

  assert.throws(() => {
    setJsonMcpServer(configPath, "mcpServers", { command: "server", args: ["mcp"] }, false);
  }, /Expected mcpServers to be a JSON object/);
  assert.equal(await readFile(configPath, "utf8"), '{"mcpServers":["keep-me"]}\n');
});

test("client config paths follow each platform's user config location", () => {
  assert.equal(
    claudeDesktopConfigPath("darwin", "/Users/example", {}),
    "/Users/example/Library/Application Support/Claude/claude_desktop_config.json",
  );
  assert.equal(
    vscodeConfigPath("linux", "/home/example", { XDG_CONFIG_HOME: "/tmp/config" }),
    "/tmp/config/Code/User/mcp.json",
  );
  assert.equal(
    vscodeConfigPath("win32", "C:\\Users\\example", { APPDATA: "C:\\Users\\example\\AppData\\Roaming" }),
    "C:\\Users\\example\\AppData\\Roaming/Code/User/mcp.json",
  );
});
