import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const serverName = "onepassword-agent-mcp";

export type ClientTarget =
  | "claude-code"
  | "claude-desktop"
  | "codex"
  | "copilot"
  | "xcode"
  | "raycast"
  | "generic";

export interface LaunchSpec {
  command: string;
  args: string[];
}

export interface ClientResult {
  label: string;
  status: "configured" | "removed" | "unchanged" | "not-detected" | "needs-user-action" | "failed";
  detail?: string;
}

interface JsonObject {
  [key: string]: unknown;
}

const allClientTargets: ClientTarget[] = [
  "claude-code",
  "claude-desktop",
  "codex",
  "copilot",
  "xcode",
  "raycast",
];

export function setupTargets(): ClientTarget[] {
  return [...allClientTargets];
}

export function clientLabel(target: ClientTarget): string {
  switch (target) {
    case "claude-code": return "Claude Code";
    case "claude-desktop": return "Claude Desktop";
    case "codex": return "Codex";
    case "copilot": return "GitHub Copilot / VS Code";
    case "xcode": return "Xcode coding agents";
    case "raycast": return "Raycast AI";
    case "generic": return "Generic MCP client";
  }
}

export function resolveMcpLaunch(): LaunchSpec {
  const override = process.env.ONEPASSWORD_AGENT_MCP_COMMAND?.trim();
  if (override) return { command: override, args: ["mcp"] };

  const installed = findExecutable("onepassword-agent-mcp");
  if (installed) return { command: installed, args: ["mcp"] };

  const script = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (script && existsSync(script)) {
    return { command: process.execPath, args: [script, "mcp"] };
  }

  return { command: "onepassword-agent-mcp", args: ["mcp"] };
}

export function isClientDetected(target: ClientTarget): boolean {
  switch (target) {
    case "claude-code":
      return Boolean(resolveClaudeCli());
    case "claude-desktop":
      return existsSync(claudeDesktopConfigPath()) || appExists("Claude.app");
    case "codex":
      return Boolean(resolveCodexCli());
    case "copilot":
      return Boolean(resolveVsCodeCli());
    case "xcode":
      return process.platform === "darwin" && (
        appExists("Xcode.app") || existsSync(xcodeRoot())
      );
    case "raycast":
      return process.platform === "darwin" && appExists("Raycast.app");
    case "generic":
      return true;
  }
}

export function setupClient(target: ClientTarget, scope: string): ClientResult {
  const launch = resolveMcpLaunch();
  const label = clientLabel(target);
  if (!isClientDetected(target)) return { label, status: "not-detected" };

  try {
    switch (target) {
      case "claude-code": {
        const command = resolveClaudeCli();
        if (!command) return { label, status: "not-detected" };
        const get = run(command, ["mcp", "get", serverName]);
        const expected = [launch.command, ...launch.args].join(" ");
        if (get.ok && get.output.includes(launch.command) && launch.args.every((arg) => get.output.includes(arg))) {
          return { label, status: "unchanged", detail: expected };
        }
        if (get.ok) run(command, ["mcp", "remove", "--scope", scope, serverName]);
        const result = run(command, ["mcp", "add", "--scope", scope, serverName, "--", launch.command, ...launch.args]);
        return result.ok
          ? { label, status: "configured", detail: expected }
          : { label, status: "failed", detail: result.output };
      }
      case "claude-desktop": {
        const changed = setJsonMcpServer(claudeDesktopConfigPath(), "mcpServers", launch, false);
        return {
          label,
          status: changed ? "configured" : "unchanged",
          detail: claudeDesktopConfigPath(),
        };
      }
      case "codex": {
        const command = resolveCodexCli();
        if (!command) return { label, status: "not-detected" };
        const result = run(command, ["mcp", "add", serverName, "--", launch.command, ...launch.args]);
        return result.ok
          ? { label, status: "configured", detail: [launch.command, ...launch.args].join(" ") }
          : { label, status: "failed", detail: result.output };
      }
      case "copilot": {
        const command = resolveVsCodeCli();
        if (!command) return { label, status: "not-detected" };
        const definition = JSON.stringify({ name: serverName, command: launch.command, args: launch.args });
        const result = run(command, ["--add-mcp", definition]);
        return result.ok
          ? { label, status: "configured", detail: vscodeConfigPath() }
          : { label, status: "failed", detail: result.output };
      }
      case "xcode":
        return setupXcode(launch);
      case "raycast":
        return openRaycast("mcp-import-servers", "Import the prepared 1Password Agent MCP entry and confirm it in Raycast.");
      case "generic":
        return { label, status: "needs-user-action", detail: JSON.stringify(genericMcpServersConfig(launch), null, 2) };
    }
  } catch (error) {
    return { label, status: "failed", detail: errorMessage(error) };
  }
}

export function uninstallClient(target: ClientTarget, scope: string): ClientResult {
  const label = clientLabel(target);
  try {
    switch (target) {
      case "claude-code": {
        const command = resolveClaudeCli();
        if (!command) return { label, status: "not-detected" };
        const result = run(command, ["mcp", "remove", "--scope", scope, serverName]);
        return result.ok
          ? { label, status: "removed" }
          : { label, status: "unchanged", detail: "No user-scoped entry was removed." };
      }
      case "claude-desktop": {
        const changed = removeJsonMcpServer(claudeDesktopConfigPath(), "mcpServers");
        return { label, status: changed ? "removed" : "unchanged", detail: claudeDesktopConfigPath() };
      }
      case "codex": {
        const command = resolveCodexCli();
        if (!command) return { label, status: "not-detected" };
        const result = run(command, ["mcp", "remove", serverName]);
        return result.ok
          ? { label, status: "removed" }
          : { label, status: "unchanged", detail: "No Codex entry was removed." };
      }
      case "copilot": {
        const changed = removeJsonMcpServer(vscodeConfigPath(), "servers");
        return { label, status: changed ? "removed" : "unchanged", detail: vscodeConfigPath() };
      }
      case "xcode":
        return uninstallXcode();
      case "raycast":
        return openRaycast("mcp-manage-servers", `Remove ${serverName} in Raycast's Manage Servers screen.`);
      case "generic":
        return { label, status: "needs-user-action", detail: `Remove the ${serverName} block from the client config.` };
    }
  } catch (error) {
    return { label, status: "failed", detail: errorMessage(error) };
  }
}

export function setupPlan(target: ClientTarget, scope: string): string[] {
  const launch = resolveMcpLaunch();
  switch (target) {
    case "claude-code":
      return [`${resolveClaudeCli() || "claude"} mcp add --scope ${scope} ${serverName} -- ${formatLaunch(launch)}`];
    case "claude-desktop":
      return [`Merge ${serverName} into ${claudeDesktopConfigPath()}`, `Launch: ${formatLaunch(launch)}`];
    case "codex":
      return [`${resolveCodexCli() || "codex"} mcp add ${serverName} -- ${formatLaunch(launch)}`];
    case "copilot":
      return [`Add ${serverName} to the VS Code user MCP configuration`, `Launch: ${formatLaunch(launch)}`];
    case "xcode":
      return [
        `Configure Xcode's isolated Codex settings in ${xcodeCodexHome()}`,
        `Configure Xcode's isolated Claude settings in ${xcodeClaudeHome()}`,
      ];
    case "raycast":
      return ["Open Raycast's official Import Servers screen; Raycast requires the user to confirm the import."];
    case "generic":
      return [JSON.stringify(genericMcpServersConfig(launch), null, 2)];
  }
}

export function genericMcpServersConfig(launch = resolveMcpLaunch()): JsonObject {
  return {
    mcpServers: {
      [serverName]: {
        command: launch.command,
        args: launch.args,
      },
    },
  };
}

export function vscodeWorkspaceConfig(launch = resolveMcpLaunch()): JsonObject {
  return {
    servers: {
      [serverName]: {
        type: "stdio",
        command: launch.command,
        args: launch.args,
      },
    },
  };
}

export function setJsonMcpServer(
  configPath: string,
  rootKey: "mcpServers" | "servers",
  launch: LaunchSpec,
  includeType: boolean,
): boolean {
  const config = readJsonObject(configPath);
  const currentRoot = readServerRoot(config, rootKey, configPath);
  const currentEntry = readServerEntry(currentRoot[serverName], rootKey, configPath);
  const entry: JsonObject = {
    ...currentEntry,
    ...(includeType ? { type: "stdio" } : {}),
    command: launch.command,
    args: launch.args,
  };
  if (JSON.stringify(currentEntry) === JSON.stringify(entry)) return false;
  config[rootKey] = { ...currentRoot, [serverName]: entry };
  writeJsonConfig(configPath, config);
  return true;
}

export function removeJsonMcpServer(configPath: string, rootKey: "mcpServers" | "servers"): boolean {
  if (!existsSync(configPath)) return false;
  const config = readJsonObject(configPath);
  const currentRoot = readServerRoot(config, rootKey, configPath);
  if (!(serverName in currentRoot)) return false;
  const nextRoot = { ...currentRoot };
  delete nextRoot[serverName];
  config[rootKey] = nextRoot;
  writeJsonConfig(configPath, config);
  return true;
}

export function claudeDesktopConfigPath(
  platform = process.platform,
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "claude_desktop_config.json");
}

export function vscodeConfigPath(
  platform = process.platform,
  home = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Code", "User", "mcp.json");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Code", "User", "mcp.json");
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "Code", "User", "mcp.json");
}

function setupXcode(launch: LaunchSpec): ClientResult {
  const details: string[] = [];
  let configured = false;

  mkdirSync(xcodeCodexHome(), { recursive: true });
  const codex = resolveXcodeAgentCli("codex") || resolveCodexCli();
  if (codex) {
    const result = run(codex, ["mcp", "add", serverName, "--", launch.command, ...launch.args], {
      ...process.env,
      CODEX_HOME: xcodeCodexHome(),
    });
    if (!result.ok) throw new Error(`Xcode Codex setup failed: ${result.output}`);
    configured = true;
    details.push("Codex agent configured");
  } else {
    details.push("Codex agent is not installed in Xcode");
  }

  mkdirSync(xcodeClaudeHome(), { recursive: true });
  const claudeConfig = path.join(xcodeClaudeHome(), ".claude.json");
  if (resolveXcodeAgentCli("claude") || existsSync(claudeConfig)) {
    const changed = setJsonMcpServer(claudeConfig, "mcpServers", launch, false);
    configured = configured || changed;
    details.push(`Claude agent ${changed ? "configured" : "already configured"}`);
  } else {
    details.push("Claude agent is not installed in Xcode");
  }

  return {
    label: clientLabel("xcode"),
    status: configured ? "configured" : "unchanged",
    detail: details.join("; "),
  };
}

function uninstallXcode(): ClientResult {
  const details: string[] = [];
  let removed = false;
  const codex = resolveXcodeAgentCli("codex") || resolveCodexCli();
  if (codex && existsSync(xcodeCodexHome())) {
    const result = run(codex, ["mcp", "remove", serverName], {
      ...process.env,
      CODEX_HOME: xcodeCodexHome(),
    });
    if (result.ok) {
      removed = true;
      details.push("Codex agent entry removed");
    }
  }

  const claudeConfig = path.join(xcodeClaudeHome(), ".claude.json");
  if (removeJsonMcpServer(claudeConfig, "mcpServers")) {
    removed = true;
    details.push("Claude agent entry removed");
  }

  return {
    label: clientLabel("xcode"),
    status: removed ? "removed" : "unchanged",
    detail: details.join("; ") || "No Xcode agent entry was found.",
  };
}

function openRaycast(command: string, detail: string): ClientResult {
  const label = clientLabel("raycast");
  const url = `raycast://extensions/raycast/raycast/${command}`;
  const result = run("/usr/bin/open", [url]);
  return result.ok
    ? { label, status: "needs-user-action", detail }
    : { label, status: "failed", detail: result.output };
}

function readJsonObject(configPath: string): JsonObject {
  if (!existsSync(configPath)) return {};
  const raw = readFileSync(configPath, "utf8").trim();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object in ${configPath}`);
  }
  return parsed as JsonObject;
}

function writeJsonConfig(configPath: string, config: JsonObject): void {
  mkdirSync(path.dirname(configPath), { recursive: true });
  if (existsSync(configPath)) {
    const backup = `${configPath}.bak.${timestamp()}`;
    copyFileSync(configPath, backup);
    chmodSync(backup, statSync(configPath).mode & 0o777);
  }

  const temporary = `${configPath}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, configPath);
  chmodSync(configPath, 0o600);
}

function readServerRoot(config: JsonObject, rootKey: "mcpServers" | "servers", configPath: string): JsonObject {
  const value = config[rootKey];
  if (value === undefined) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  throw new Error(`Expected ${rootKey} to be a JSON object in ${configPath}`);
}

function readServerEntry(value: unknown, rootKey: "mcpServers" | "servers", configPath: string): JsonObject {
  if (value === undefined) return {};
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  throw new Error(`Expected ${rootKey}.${serverName} to be a JSON object in ${configPath}`);
}

function resolveClaudeCli(): string | null {
  return findExecutable("claude") || firstExisting([
    path.join(os.homedir(), ".local", "bin", "claude"),
  ]);
}

function resolveCodexCli(): string | null {
  return findExecutable("codex") || firstExisting([
    path.join(os.homedir(), ".local", "bin", "codex"),
  ]);
}

function resolveVsCodeCli(): string | null {
  return findExecutable("code") || firstExisting(process.platform === "darwin" ? [
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    path.join(os.homedir(), "Applications", "Visual Studio Code.app", "Contents", "Resources", "app", "bin", "code"),
  ] : []);
}

function resolveXcodeAgentCli(agent: "codex" | "claude"): string | null {
  const root = path.join(xcodeRoot(), "Agents", agent);
  if (!existsSync(root)) return null;
  const versions = readDirectoryNames(root).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  return firstExisting(versions.map((version) => path.join(root, version, agent)));
}

function readDirectoryNames(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function xcodeRoot(): string {
  return path.join(os.homedir(), "Library", "Developer", "Xcode", "CodingAssistant");
}

function xcodeCodexHome(): string {
  return path.join(xcodeRoot(), "codex");
}

function xcodeClaudeHome(): string {
  return path.join(xcodeRoot(), "ClaudeAgentConfig");
}

function appExists(appName: string): boolean {
  if (process.platform !== "darwin") return false;
  return existsSync(path.join("/Applications", appName)) || existsSync(path.join(os.homedir(), "Applications", appName));
}

function firstExisting(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function findExecutable(command: string): string | null {
  const lookup = process.platform === "win32"
    ? spawnSync("where", [command], { encoding: "utf8" })
    : spawnSync("/usr/bin/which", [command], { encoding: "utf8" });
  if (lookup.status !== 0) return null;
  return lookup.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function run(command: string, args: string[], env = process.env): { ok: boolean; output: string } {
  const result = spawnSync(command, args, { encoding: "utf8", env });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.error) return { ok: false, output: result.error.message };
  return { ok: result.status === 0, output };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function formatLaunch(launch: LaunchSpec): string {
  return [launch.command, ...launch.args].join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
