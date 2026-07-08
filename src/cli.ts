#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { startAdmin } from "./admin.js";
import { startMcp } from "./mcp.js";
import { appHome, keyPath, policyPath } from "./paths.js";
import { OpCli } from "./opCli.js";
import { StateStore } from "./state.js";

const serverName = "onepassword-agent-bridge";
const mcpCommand = "onepassword-agent-bridge";
const mcpArgs = ["mcp"];

interface ParsedArgs {
  positionals: string[];
  apply: boolean;
  json: boolean;
  scope: string;
  help: boolean;
}

type SetupTarget = "all" | "claude-code" | "codex" | "copilot" | "generic";

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
    case "setup":
      await setup(normalizeTarget(args.positionals[0] || "all"), args);
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
  throw new Error(`Unknown setup target: ${target}`);
}

async function doctor(): Promise<void> {
  console.log("1Password Agent Bridge doctor\n");

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
    warn(`Admin UI is not running. Start it with: onepassword-agent-bridge admin`);
    console.log(`    Then open ${adminUrl}`);
  }

  console.log("");
  if (failures) {
    console.log(`${failures} required check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("Ready. Approve logins in the admin UI, then connect an MCP client.");
  }
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

function printSetupPlan(targets: SetupTarget[], scope: string): void {
  console.log("1Password Agent Bridge MCP setup\n");
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
  console.log("  onepassword-agent-bridge admin");
  console.log("  onepassword-agent-bridge doctor");
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

function targetSpec(target: SetupTarget, scope: string): { label: string; command: string; args: string[] } {
  if (target === "claude-code") return { label: "Claude Code", command: "claude", args: claudeArgs(scope) };
  if (target === "codex") return { label: "Codex", command: "codex", args: codexArgs() };
  return { label: "GitHub Copilot in VS Code", command: "code", args: copilotArgs() };
}

function claudeArgs(scope: string): string[] {
  return ["mcp", "add", "--scope", scope, serverName, "--", mcpCommand, ...mcpArgs];
}

function codexArgs(): string[] {
  return ["mcp", "add", serverName, "--", mcpCommand, ...mcpArgs];
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
  console.log(`1Password Agent Bridge

Usage:
  onepassword-agent-bridge admin
  onepassword-agent-bridge mcp
  onepassword-agent-bridge doctor
  onepassword-agent-bridge setup [all|claude-code|codex|copilot|generic] [--apply]

Commands:
  admin      Start the local approval console at http://127.0.0.1:7319
  mcp        Start the stdio MCP server. MCP clients run this command.
  doctor     Check Node.js, 1Password CLI, auth, local state, and admin UI.
  setup      Print or apply client MCP configuration.

Setup examples:
  onepassword-agent-bridge setup all
  onepassword-agent-bridge setup claude-code --apply
  onepassword-agent-bridge setup claude-code --apply --scope user
  onepassword-agent-bridge setup codex --apply
  onepassword-agent-bridge setup copilot --apply
  onepassword-agent-bridge setup generic --json
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
