#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { startAdmin } from "./admin.js";
import { startMcp } from "./mcp.js";
import { appHome, keyPath, policyPath } from "./paths.js";
import { OpCli } from "./opCli.js";
import { StateStore } from "./state.js";

const serverName = "onepassword-agent-mcp";
const mcpCommand = "onepassword-agent-mcp";
const mcpArgs = ["mcp"];

interface ParsedArgs {
  positionals: string[];
  apply: boolean;
  json: boolean;
  scope: string;
  help: boolean;
}

type SetupTarget = "all" | "claude-code" | "codex" | "copilot" | "generic";
type UninstallTarget = SetupTarget | "state";

async function main(argv: string[]): Promise<void> {
  const [rawCommand = "help", ...rest] = argv;
  if (rawCommand === "-h" || rawCommand === "--help") {
    printHelp();
    return;
  }

  const command = normalizeCommand(rawCommand);
  const args = parseArgs(rest);

  if (args.help) {
    printHelp();
    return;
  }

  switch (command) {
    case "admin":
      await startAdmin();
      return;
    case "mcp":
      await startMcp();
      return;
    case "doctor":
      await doctor();
      return;
    case "runtime":
      printRuntimeInfo();
      return;
    case "setup":
      await setup(normalizeTarget(args.positionals[0] || "all"), args);
      return;
    case "uninstall":
      await uninstall(normalizeUninstallTarget(args.positionals[0] || "all"), args);
      return;
    case "help":
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${rawCommand}`);
      printHelp();
      process.exitCode = 1;
  }
}

function normalizeCommand(command: string): string {
  if (command === "start") return "admin";
  if (command === "serve") return "mcp";
  if (command === "check") return "doctor";
  if (command === "install" || command === "configure" || command === "config") return "setup";
  if (command === "remove" || command === "disconnect" || command === "teardown") return "uninstall";
  if (command === "background" || command === "status" || command === "transparency") return "runtime";
  return command;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let apply = false;
  let json = false;
  let scope = "user";
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply" || arg === "--yes") {
      apply = true;
    } else if (arg === "--dry-run") {
      apply = false;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--scope") {
      const value = argv[index + 1];
      if (!value) throw new Error("--scope requires a value");
      scope = value;
      index += 1;
    } else if (arg.startsWith("--scope=")) {
      scope = arg.slice("--scope=".length);
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, apply, json, scope, help };
}

function normalizeTarget(target: string): SetupTarget {
  const value = target.toLowerCase();
  if (value === "claude" || value === "claude-code" || value === "claude_code") return "claude-code";
  if (value === "openai" || value === "openai-codex" || value === "codex") return "codex";
  if (value === "github-copilot" || value === "copilot" || value === "vscode" || value === "vs-code") {
    return "copilot";
  }
  if (value === "json" || value === "generic" || value === "mcp") return "generic";
  if (value === "all") return "all";
  throw new Error(`Unknown client target: ${target}`);
}

function normalizeUninstallTarget(target: string): UninstallTarget {
  const value = target.toLowerCase();
  if (value === "state" || value === "local-state" || value === "data" || value === "policy") return "state";
  return normalizeTarget(target);
}

async function doctor(): Promise<void> {
  console.log("1Password Agent MCP doctor\n");

  let failures = 0;
  const store = new StateStore();
  const file = await store.load();
  const op = new OpCli(file.settings);

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 20) {
    ok(`Node.js ${process.version}`);
  } else {
    failures += 1;
    fail(`Node.js ${process.version}; install Node.js 20 or newer`);
  }

  ok(`State directory: ${appHome()}`);
  ok(`Policy file: ${policyPath()}`);
  if (existsSync(keyPath())) {
    ok(`Encryption key: ${keyPath()}`);
  } else {
    warn("Encryption key has not been created yet. It is created when the first approval is stored.");
  }

  try {
    const version = await op.version();
    ok(`1Password CLI: ${version}`);
    try {
      const vaults = await op.listVaults();
      ok(`1Password auth: ${vaults.length} vault(s) visible`);
      const expected = file.settings.mcpVaultName.trim().toLowerCase();
      const mcpVault = vaults.find((vault) => {
        return vault.name?.trim().toLowerCase() === expected || vault.id?.trim().toLowerCase() === expected;
      });
      if (mcpVault) {
        ok(`Agent vault: ${file.settings.mcpVaultName}`);
      } else {
        warn(`Agent vault ${file.settings.mcpVaultName} does not exist yet. Create it in the admin UI.`);
      }
    } catch (error) {
      failures += 1;
      fail(`1Password auth: ${(error as Error).message}`);
      console.log("    Enable 1Password desktop CLI integration or set OP_SERVICE_ACCOUNT_TOKEN.");
    }
  } catch (error) {
    failures += 1;
    fail(`1Password CLI: ${(error as Error).message}`);
    console.log("    Install it with: brew install 1password-cli");
  }

  const adminUrl = `http://${file.settings.adminHost}:${file.settings.adminPort}`;
  try {
    const response = await fetch(`${adminUrl}/api/status`, { signal: AbortSignal.timeout(1_500) });
    if (response.ok) {
      ok(`Admin UI: ${adminUrl}`);
    } else {
      warn(`Admin UI responded with HTTP ${response.status}: ${adminUrl}`);
    }
  } catch {
    warn(`Admin UI is not running. Start it with: onepassword-agent-mcp admin`);
    console.log(`    Then open ${adminUrl}`);
  }

  console.log("");
  printRuntimeSummary();

  console.log("");
  if (failures) {
    console.log(`${failures} required check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("Ready. Approve logins in the admin UI, then connect an MCP client.");
  }
}

function printRuntimeInfo(): void {
  console.log("1Password Agent MCP runtime\n");
  printRuntimeSummary();
  console.log("");
  console.log("Stop:");
  console.log("  Admin console: press Ctrl-C in the terminal running onepassword-agent-mcp admin.");
  console.log("  MCP server: close the MCP client session that launched it.");
  console.log("");
  console.log("Uninstall:");
  console.log("  onepassword-agent-mcp uninstall all");
  console.log("  onepassword-agent-mcp uninstall all --apply");
  console.log("  npm uninstall -g onepassword-agent-mcp");
  console.log("");
  console.log("Optional local-state removal:");
  console.log(`  onepassword-agent-mcp uninstall state`);
  console.log(`  onepassword-agent-mcp uninstall state --apply`);
}

function printRuntimeSummary(): void {
  console.log("Runtime model:");
  console.log("  No launch agent, daemon, service, or startup item is installed.");
  console.log("  The admin console runs only while onepassword-agent-mcp admin is running.");
  console.log("  MCP clients launch onepassword-agent-mcp mcp as a stdio child process when they need it.");
  console.log(`  Persistent local files live in ${appHome()}.`);
}

async function setup(target: SetupTarget, args: ParsedArgs): Promise<void> {
  const targets = target === "all" ? ["claude-code", "codex", "copilot"] as SetupTarget[] : [target];

  if (args.json) {
    console.log(JSON.stringify(genericMcpServersConfig(), null, 2));
    return;
  }

  if (!args.apply) {
    printSetupPlan(targets, args.scope);
    return;
  }

  for (const item of targets) {
    applySetup(item, args.scope);
  }
}

async function uninstall(target: UninstallTarget, args: ParsedArgs): Promise<void> {
  if (target === "state") {
    await uninstallState(args);
    return;
  }

  const targets = target === "all" ? ["claude-code", "codex", "copilot"] as SetupTarget[] : [target];

  if (args.json || target === "generic") {
    printGenericUninstall();
    return;
  }

  if (!args.apply) {
    printUninstallPlan(targets, args.scope);
    return;
  }

  for (const item of targets) {
    applyUninstall(item, args.scope);
  }

  console.log("");
  console.log("MCP client entries removed where supported.");
  console.log("To remove the npm package too, run:");
  console.log("  npm uninstall -g onepassword-agent-mcp");
  console.log("");
  console.log("To delete only this app's local approvals and encryption key, run:");
  console.log("  onepassword-agent-mcp uninstall state --apply");
  console.log("This does not delete 1Password vaults or items.");
}

function printSetupPlan(targets: SetupTarget[], scope: string): void {
  console.log("1Password Agent MCP setup\n");
  console.log("This dry run does not modify client config. Add --apply to run supported CLI installers.\n");

  for (const target of targets) {
    if (target === "claude-code") {
      console.log("Claude Code");
      console.log(`  ${formatCommand("claude", claudeArgs(scope))}`);
      console.log("");
    } else if (target === "codex") {
      console.log("Codex");
      console.log(`  ${formatCommand("codex", codexArgs())}`);
      console.log("");
    } else if (target === "copilot") {
      console.log("GitHub Copilot in VS Code");
      console.log(`  ${formatCommand("code", copilotArgs())}`);
      console.log("");
      console.log("  Workspace fallback: .vscode/mcp.json");
      console.log(indent(JSON.stringify(vscodeWorkspaceConfig(), null, 2), "  "));
      console.log("");
    } else if (target === "generic") {
      console.log("Generic MCP client JSON");
      console.log(JSON.stringify(genericMcpServersConfig(), null, 2));
      console.log("");
    }
  }

  console.log("After setup, run:");
  console.log("  onepassword-agent-mcp admin");
  console.log("  onepassword-agent-mcp doctor");
}

function printUninstallPlan(targets: SetupTarget[], scope: string): void {
  console.log("1Password Agent MCP uninstall\n");
  console.log("This dry run does not modify client config. Add --apply to run supported CLI removers.\n");

  for (const target of targets) {
    if (target === "claude-code") {
      console.log("Claude Code");
      console.log(`  ${formatCommand("claude", claudeRemoveArgs(scope))}`);
      console.log("");
    } else if (target === "codex") {
      console.log("Codex");
      console.log(`  ${formatCommand("codex", codexRemoveArgs())}`);
      console.log("");
    } else if (target === "copilot") {
      console.log("GitHub Copilot in VS Code");
      console.log("  The VS Code CLI exposes --add-mcp, but no stable --remove-mcp flag was found.");
      console.log(`  Remove the server named ${serverName} from VS Code's MCP configuration UI, or from .vscode/mcp.json if you used workspace config.`);
      console.log("");
    } else if (target === "generic") {
      printGenericUninstall();
    }
  }

  console.log("Then uninstall the npm package:");
  console.log("  npm uninstall -g onepassword-agent-mcp");
  console.log("");
  console.log("Optional: delete this app's local approvals and encryption key:");
  console.log("  onepassword-agent-mcp uninstall state --apply");
  console.log("This does not delete 1Password vaults or items.");
}

function printGenericUninstall(): void {
  console.log("Generic MCP client");
  console.log(`  Remove the ${serverName} server block from your client's MCP config.`);
  console.log("");
}

function applySetup(target: SetupTarget, scope: string): void {
  if (target === "generic") {
    console.log(JSON.stringify(genericMcpServersConfig(), null, 2));
    return;
  }

  const spec = targetSpec(target, scope);
  if (!commandExists(spec.command)) {
    warn(`${spec.label}: ${spec.command} was not found in PATH.`);
    console.log(`    ${formatCommand(spec.command, spec.args)}`);
    if (target === "copilot") {
      console.log("    Or create .vscode/mcp.json with:");
      console.log(indent(JSON.stringify(vscodeWorkspaceConfig(), null, 2), "    "));
    }
    return;
  }

  const result = spawnSync(spec.command, spec.args, { stdio: "inherit" });
  if (result.error) {
    fail(`${spec.label}: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    fail(`${spec.label}: installer exited with code ${result.status}`);
    process.exitCode = result.status;
    return;
  }
  ok(`${spec.label}: configured`);
}

function applyUninstall(target: SetupTarget, scope: string): void {
  if (target === "generic") {
    printGenericUninstall();
    return;
  }

  const spec = removeSpec(target, scope);
  if (!spec) {
    warn("GitHub Copilot in VS Code: automatic removal is not available through the detected code CLI.");
    console.log(`    Remove the server named ${serverName} from VS Code's MCP configuration UI, or from .vscode/mcp.json if you used workspace config.`);
    return;
  }

  if (!commandExists(spec.command)) {
    warn(`${spec.label}: ${spec.command} was not found in PATH.`);
    console.log(`    ${formatCommand(spec.command, spec.args)}`);
    return;
  }

  const result = spawnSync(spec.command, spec.args, { stdio: "inherit" });
  if (result.error) {
    fail(`${spec.label}: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    fail(`${spec.label}: remover exited with code ${result.status}`);
    process.exitCode = result.status;
    return;
  }
  ok(`${spec.label}: removed`);
}

async function uninstallState(args: ParsedArgs): Promise<void> {
  console.log("1Password Agent MCP local-state removal\n");
  console.log(`Local state directory: ${appHome()}`);
  console.log("This contains this app's approval policy and local encryption key.");
  console.log("It does not contain plaintext passwords and does not delete 1Password vaults or items.\n");

  if (!args.apply) {
    console.log("Dry run only. To remove local state, run:");
    console.log("  onepassword-agent-mcp uninstall state --apply");
    return;
  }

  await rm(appHome(), { recursive: true, force: true });
  ok(`Removed local state directory: ${appHome()}`);
}

function targetSpec(target: SetupTarget, scope: string): { label: string; command: string; args: string[] } {
  if (target === "claude-code") return { label: "Claude Code", command: "claude", args: claudeArgs(scope) };
  if (target === "codex") return { label: "Codex", command: "codex", args: codexArgs() };
  return { label: "GitHub Copilot in VS Code", command: "code", args: copilotArgs() };
}

function removeSpec(target: SetupTarget, scope: string): { label: string; command: string; args: string[] } | null {
  if (target === "claude-code") return { label: "Claude Code", command: "claude", args: claudeRemoveArgs(scope) };
  if (target === "codex") return { label: "Codex", command: "codex", args: codexRemoveArgs() };
  return null;
}

function claudeArgs(scope: string): string[] {
  return ["mcp", "add", "--scope", scope, serverName, "--", mcpCommand, ...mcpArgs];
}

function codexArgs(): string[] {
  return ["mcp", "add", serverName, "--", mcpCommand, ...mcpArgs];
}

function claudeRemoveArgs(scope: string): string[] {
  return ["mcp", "remove", "--scope", scope, serverName];
}

function codexRemoveArgs(): string[] {
  return ["mcp", "remove", serverName];
}

function copilotArgs(): string[] {
  return ["--add-mcp", JSON.stringify({
    name: serverName,
    command: mcpCommand,
    args: mcpArgs,
  })];
}

function vscodeWorkspaceConfig(): unknown {
  return {
    servers: {
      [serverName]: {
        type: "stdio",
        command: mcpCommand,
        args: mcpArgs,
      },
    },
  };
}

function genericMcpServersConfig(): unknown {
  return {
    mcpServers: {
      [serverName]: {
        command: mcpCommand,
        args: mcpArgs,
      },
    },
  };
}

function commandExists(command: string): boolean {
  const lookup = process.platform === "win32"
    ? spawnSync("where", [command], { stdio: "ignore" })
    : spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], { stdio: "ignore" });
  return lookup.status === 0;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function indent(value: string, prefix: string): string {
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function ok(message: string): void {
  console.log(`OK   ${message}`);
}

function warn(message: string): void {
  console.log(`WARN ${message}`);
}

function fail(message: string): void {
  console.log(`FAIL ${message}`);
}

function printHelp(): void {
  console.log(`1Password Agent MCP

Usage:
  onepassword-agent-mcp admin
  onepassword-agent-mcp mcp
  onepassword-agent-mcp doctor
  onepassword-agent-mcp runtime
  onepassword-agent-mcp setup [all|claude-code|codex|copilot|generic] [--apply]
  onepassword-agent-mcp uninstall [all|claude-code|codex|copilot|generic|state] [--apply]

Commands:
  admin      Start the local approval console at http://127.0.0.1:7319
  mcp        Start the stdio MCP server. MCP clients run this command.
  doctor     Check Node.js, 1Password CLI, auth, local state, and admin UI.
  runtime    Explain what runs, what persists, and how to stop it.
  setup      Print or apply client MCP configuration.
  uninstall  Print or apply client MCP removal. State removal is explicit.

Setup examples:
  onepassword-agent-mcp setup all
  onepassword-agent-mcp setup claude-code --apply
  onepassword-agent-mcp setup claude-code --apply --scope user
  onepassword-agent-mcp setup codex --apply
  onepassword-agent-mcp setup copilot --apply
  onepassword-agent-mcp setup generic --json

Uninstall examples:
  onepassword-agent-mcp uninstall all
  onepassword-agent-mcp uninstall claude-code --apply
  onepassword-agent-mcp uninstall codex --apply
  onepassword-agent-mcp uninstall state
  onepassword-agent-mcp uninstall state --apply
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
