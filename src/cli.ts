#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { startAdmin } from "./admin.js";
import { getAdminRuntimeStatus, stopAdmin } from "./adminRuntime.js";
import {
  type ClientResult,
  type ClientTarget,
  clientLabel,
  genericMcpServersConfig,
  isClientDetected,
  serverName,
  setupClient,
  setupPlan,
  setupTargets,
  uninstallClient,
  vscodeWorkspaceConfig,
} from "./clientSetup.js";
import { startMcp } from "./mcp.js";
import {
  getMenuBarStatus,
  installMenuBar,
  launchMenuBar,
  quitMenuBar,
  setMenuBarLaunchAtLogin,
  uninstallMenuBar,
} from "./menuBar.js";
import { appHome, keyPath, policyPath } from "./paths.js";
import { OpCli } from "./opCli.js";
import { StateStore } from "./state.js";

interface ParsedArgs {
  positionals: string[];
  apply: boolean;
  json: boolean;
  scope: string;
  help: boolean;
  launch: boolean;
  launchAtLogin?: boolean;
}

type SetupTarget = "all" | ClientTarget;
type UninstallTarget = SetupTarget | "state" | "menubar";

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
      await manageAdmin(args);
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
    case "install":
      await guidedInstall();
      return;
    case "setup":
      await setup(normalizeTarget(args.positionals[0] || "all"), args);
      return;
    case "menubar":
      await manageMenuBar(args);
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

async function manageAdmin(args: ParsedArgs): Promise<void> {
  const action = (args.positionals[0] || "start").toLowerCase();
  if (action === "start" || action === "run" || action === "open") {
    await startAdmin();
    return;
  }

  const file = await new StateStore().load();
  if (action === "status") {
    const status = await getAdminRuntimeStatus(file.settings);
    if (args.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log("1Password Agent MCP admin console\n");
    console.log(`Running: ${status.running ? "yes" : "no"}`);
    console.log(`Managed stop available: ${status.managed ? "yes" : "no"}`);
    console.log(`URL: ${status.url}`);
    return;
  }

  if (action === "stop" || action === "quit") {
    const result = await stopAdmin(file.settings, { expectedCliPath: process.argv[1] });
    ok(result.wasRunning ? "Admin console stopped." : "Admin console was already stopped.");
    return;
  }

  throw new Error(`Unknown admin action: ${action}. Use start, status, or stop.`);
}

function normalizeCommand(command: string): string {
  if (command === "start") return "admin";
  if (command === "serve") return "mcp";
  if (command === "check") return "doctor";
  if (command === "configure" || command === "config") return "setup";
  if (command === "menu-bar" || command === "tray") return "menubar";
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
  let launch = true;
  let launchAtLogin: boolean | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply" || arg === "--yes") {
      apply = true;
    } else if (arg === "--dry-run") {
      apply = false;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--no-launch") {
      launch = false;
    } else if (arg === "--launch-at-login") {
      launchAtLogin = true;
    } else if (arg === "--no-launch-at-login") {
      launchAtLogin = false;
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

  return { positionals, apply, json, scope, help, launch, launchAtLogin };
}

function normalizeTarget(target: string): SetupTarget {
  const value = target.toLowerCase();
  if (value === "claude" || value === "claude-code" || value === "claude_code") return "claude-code";
  if (value === "claude-desktop" || value === "claude_desktop" || value === "desktop") return "claude-desktop";
  if (value === "openai" || value === "openai-codex" || value === "codex") return "codex";
  if (value === "github-copilot" || value === "copilot" || value === "vscode" || value === "vs-code") {
    return "copilot";
  }
  if (value === "xcode" || value === "apple-xcode") return "xcode";
  if (value === "raycast" || value === "raycast-ai") return "raycast";
  if (value === "json" || value === "generic" || value === "mcp") return "generic";
  if (value === "all") return "all";
  throw new Error(`Unknown client target: ${target}`);
}

function normalizeUninstallTarget(target: string): UninstallTarget {
  const value = target.toLowerCase();
  if (value === "state" || value === "local-state" || value === "data" || value === "policy") return "state";
  if (value === "menubar" || value === "menu-bar" || value === "tray") return "menubar";
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

  const menuBar = await getMenuBarStatus(file.settings);
  if (menuBar.installed) {
    ok(`Menu-bar shortcut: installed${menuBar.running ? " and running" : ""}`);
    if (menuBar.launchAtLogin) console.log("    It is configured to launch visibly in the menu bar after login.");
    if (menuBar.needsUpdate) warn("Menu-bar shortcut was built by an older package version. Refresh it in the admin UI.");
  } else if (menuBar.supported) {
    console.log("INFO Menu-bar shortcut: not installed (optional)");
  }

  console.log("");
  printRuntimeSummary();

  console.log("");
  if (failures) {
    console.log(`${failures} required check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("Ready. Approve item fields in the admin UI, then connect an MCP client.");
  }
}

function printRuntimeInfo(): void {
  console.log("1Password Agent MCP runtime\n");
  printRuntimeSummary();
  console.log("");
  console.log("Stop:");
  console.log("  Admin console: press Ctrl-C in the terminal running onepassword-agent-mcp admin.");
  console.log("  MCP server: close the MCP client session that launched it.");
  console.log("  Menu bar: choose Remove From Menu Bar, or run onepassword-agent-mcp menubar remove.");
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
  console.log("  npm installation itself adds no launch agent, daemon, service, or startup item.");
  console.log("  The admin console runs only while onepassword-agent-mcp admin is running.");
  console.log("  MCP clients launch onepassword-agent-mcp mcp as a stdio child process when they need it.");
  console.log("  The optional macOS menu-bar shortcut is installed only after an explicit choice and is always visible while running.");
  console.log("  Launch at login is separate, off by default, and removable from the menu, admin UI, or CLI.");
  console.log(`  Persistent local files live in ${appHome()}.`);
}

async function guidedInstall(): Promise<void> {
  console.log("1Password Agent MCP guided install\n");
  console.log("Nothing is added to login items or left running invisibly by this package.");
  console.log("This wizard changes only the options you approve.\n");

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log("Interactive input is unavailable. Use these explicit commands instead:");
    console.log("  onepassword-agent-mcp setup all --apply");
    if (process.platform === "darwin") console.log("  onepassword-agent-mcp menubar install");
    console.log("  onepassword-agent-mcp admin");
    return;
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const detected = setupTargets().filter(isClientDetected);
    if (detected.length) {
      const labels = detected.map(clientLabel).join(", ");
      if (await askYesNo(prompt, `Connect the detected MCP clients (${labels})?`, true)) {
        for (const target of detected) printClientResult(setupClient(target, "user"));
      }
    } else {
      warn("No supported MCP client was detected. You can configure one later with onepassword-agent-mcp setup.");
    }

    if (process.platform === "darwin" && await askYesNo(
      prompt,
      "Install the optional visible menu-bar shortcut for opening the admin console?",
      false,
    )) {
      const launchAtLogin = await askYesNo(prompt, "Show that menu-bar shortcut automatically after login?", false);
      const file = await new StateStore().load();
      await installMenuBar(file.settings, { launch: true, launchAtLogin });
      ok("Menu-bar shortcut installed in your user Applications folder.");
    }
  } finally {
    prompt.close();
  }

  console.log("\nSetup finished.");
  console.log("Run onepassword-agent-mcp admin, or use the menu-bar shortcut if you installed it.");
  console.log("Run onepassword-agent-mcp doctor to see every active part.");
}

async function manageMenuBar(args: ParsedArgs): Promise<void> {
  const action = (args.positionals[0] || "status").toLowerCase();
  const file = await new StateStore().load();

  if (action === "status") {
    const status = await getMenuBarStatus(file.settings);
    if (args.json) console.log(JSON.stringify(status, null, 2));
    else printMenuBarStatus(status);
    return;
  }

  if (action === "install" || action === "enable" || action === "update") {
    const status = await installMenuBar(file.settings, {
      launch: args.launch,
      launchAtLogin: args.launchAtLogin,
    });
    ok(`Menu-bar shortcut installed: ${status.appPath}`);
    console.log(`Launch at login: ${status.launchAtLogin ? "on" : "off"}`);
    console.log("Uninstall it with: onepassword-agent-mcp menubar uninstall --apply");
    return;
  }

  if (action === "uninstall" || action === "disable") {
    const status = await getMenuBarStatus(file.settings);
    console.log("1Password Agent MCP menu-bar uninstall\n");
    console.log(`Shortcut: ${status.appPath}`);
    console.log(`Login item: ${status.launchAgentPath}`);
    console.log("MCP client configuration, local approvals, MCPVAULT, and 1Password items are not removed.\n");
    if (!args.apply) {
      console.log("Dry run only. Apply with:");
      console.log("  onepassword-agent-mcp menubar uninstall --apply");
      return;
    }
    await uninstallMenuBar(file.settings);
    ok("Menu-bar shortcut and its login item uninstalled.");
    return;
  }

  if (action === "launch" || action === "open" || action === "start") {
    launchMenuBar();
    ok("Menu-bar shortcut opened.");
    return;
  }

  if (action === "remove" || action === "quit" || action === "stop") {
    quitMenuBar();
    ok("Menu-bar shortcut removed from the menu bar. It remains installed.");
    return;
  }

  if (action === "login") {
    const value = (args.positionals[1] || "").toLowerCase();
    if (value !== "on" && value !== "off") throw new Error("Use: onepassword-agent-mcp menubar login on|off");
    await setMenuBarLaunchAtLogin(value === "on");
    ok(`Menu-bar launch at login ${value === "on" ? "enabled" : "disabled"}.`);
    return;
  }

  throw new Error(`Unknown menubar action: ${action}`);
}

function printMenuBarStatus(status: Awaited<ReturnType<typeof getMenuBarStatus>>): void {
  console.log("1Password Agent MCP menu bar\n");
  console.log(`Platform support: ${status.supported ? "yes" : "no"}`);
  console.log(`Installed: ${status.installed ? "yes" : "no"}`);
  console.log(`Running visibly: ${status.running ? "yes" : "no"}`);
  console.log(`Launch at login: ${status.launchAtLogin ? "yes" : "no"}`);
  console.log(`App: ${status.appPath}`);
  if (status.reason) console.log(`Note: ${status.reason}`);
}

async function askYesNo(
  prompt: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = (await prompt.question(`${question}${suffix}`)).trim().toLowerCase();
  if (!answer) return defaultValue;
  return answer === "y" || answer === "yes";
}

async function setup(target: SetupTarget, args: ParsedArgs): Promise<void> {
  const targets = target === "all" ? setupTargets() : [target];

  if (args.json) {
    console.log(JSON.stringify(genericMcpServersConfig(), null, 2));
    return;
  }

  if (!args.apply) {
    printSetupPlan(targets, args.scope);
    return;
  }

  for (const item of targets) {
    printClientResult(setupClient(item, args.scope));
  }
}

async function uninstall(target: UninstallTarget, args: ParsedArgs): Promise<void> {
  if (target === "state") {
    await uninstallState(args);
    return;
  }

  if (target === "menubar") {
    await manageMenuBar({ ...args, positionals: ["uninstall"] });
    return;
  }

  const targets = target === "all" ? setupTargets() : [target];

  if (args.json || target === "generic") {
    printGenericUninstall();
    return;
  }

  if (!args.apply) {
    printUninstallPlan(targets, args.scope);
    if (target === "all") {
      console.log("Optional macOS menu-bar shortcut");
      console.log("  Remove it if installed, including its explicit launch-at-login item.");
      console.log("");
    }
    return;
  }

  for (const item of targets) {
    printClientResult(uninstallClient(item, args.scope));
  }

  if (target === "all") {
    const file = await new StateStore().load();
    const menuBar = await getMenuBarStatus(file.settings);
    if (menuBar.installed || menuBar.launchAtLogin) {
      await uninstallMenuBar(file.settings);
      ok("Menu-bar shortcut: removed");
    }
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

function printSetupPlan(targets: ClientTarget[], scope: string): void {
  console.log("1Password Agent MCP setup\n");
  console.log("This dry run does not modify client config. Add --apply to configure detected clients.\n");

  for (const target of targets) {
    console.log(`${clientLabel(target)}${isClientDetected(target) ? " (detected)" : " (not detected)"}`);
    for (const line of setupPlan(target, scope)) console.log(indent(line, "  "));
    if (target === "copilot") {
      console.log("  Workspace fallback: .vscode/mcp.json");
      console.log(indent(JSON.stringify(vscodeWorkspaceConfig(), null, 2), "  "));
    }
    console.log("");
  }

  console.log("Only detected clients are changed. Existing JSON config files are backed up before a merge.");
  console.log("Raycast keeps MCP settings in app-managed storage, so its official import screen requires one final confirmation.\n");

  console.log("After setup, run:");
  console.log("  onepassword-agent-mcp admin");
  console.log("  onepassword-agent-mcp doctor");
  if (process.platform === "darwin") {
    console.log("");
    console.log("Optional visible macOS menu-bar shortcut:");
    console.log("  onepassword-agent-mcp menubar install");
  }
}

function printUninstallPlan(targets: ClientTarget[], scope: string): void {
  console.log("1Password Agent MCP uninstall\n");
  console.log("This dry run does not modify client config. Add --apply to remove supported client entries.\n");

  for (const target of targets) {
    console.log(clientLabel(target));
    if (target === "raycast") {
      console.log("  Open Raycast's official Manage Servers screen and confirm removal.");
    } else if (target === "generic") {
      console.log(`  Remove the ${serverName} server block from the client config.`);
    } else {
      console.log(`  Remove the ${serverName} entry from this client's user configuration.`);
    }
    console.log("");
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

function printClientResult(result: ClientResult): void {
  const suffix = result.detail ? `: ${result.detail}` : "";
  if (result.status === "failed") {
    fail(`${result.label}${suffix}`);
    process.exitCode = 1;
  } else if (result.status === "not-detected") {
    console.log(`SKIP ${result.label}: not detected`);
  } else if (result.status === "needs-user-action") {
    console.log(`NEXT ${result.label}${suffix}`);
  } else if (result.status === "unchanged") {
    ok(`${result.label}: already configured${result.detail ? ` (${result.detail})` : ""}`);
  } else {
    ok(`${result.label}: ${result.status}${suffix}`);
  }
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
  onepassword-agent-mcp install
  onepassword-agent-mcp admin [start|status|stop]
  onepassword-agent-mcp mcp
  onepassword-agent-mcp doctor
  onepassword-agent-mcp runtime
  onepassword-agent-mcp setup [all|claude-code|claude-desktop|codex|copilot|xcode|raycast|generic] [--apply]
  onepassword-agent-mcp menubar [status|install|launch|remove|login|uninstall]
  onepassword-agent-mcp uninstall [all|claude-code|claude-desktop|codex|copilot|xcode|raycast|generic|menubar|state] [--apply]

Commands:
  install    Run the guided, interactive installer.
  admin      Start, inspect, or stop the local approval console.
  mcp        Start the stdio MCP server. MCP clients run this command.
  doctor     Check Node.js, 1Password CLI, auth, local state, and admin UI.
  runtime    Explain what runs, what persists, and how to stop it.
  setup      Print or apply client MCP configuration.
  menubar    Manage the optional visible macOS menu-bar shortcut.
  uninstall  Print or apply client MCP removal. State removal is explicit.

Setup examples:
  onepassword-agent-mcp setup all
  onepassword-agent-mcp setup all --apply
  onepassword-agent-mcp setup claude-code --apply
  onepassword-agent-mcp setup xcode --apply
  onepassword-agent-mcp setup raycast --apply
  onepassword-agent-mcp setup generic --json

Admin-console examples:
  onepassword-agent-mcp admin
  onepassword-agent-mcp admin status
  onepassword-agent-mcp admin stop

Menu-bar examples (macOS only):
  onepassword-agent-mcp menubar status
  onepassword-agent-mcp menubar install
  onepassword-agent-mcp menubar install --launch-at-login
  onepassword-agent-mcp menubar remove
  onepassword-agent-mcp menubar login off
  onepassword-agent-mcp menubar uninstall
  onepassword-agent-mcp menubar uninstall --apply

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
