import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appHome, packageRoot } from "./paths.js";
import type { Settings } from "./types.js";

const bundleId = "io.github.gambadio.onepassword-agent-mcp.menubar";
const appName = "1Password Agent MCP.app";
const executableName = "OnePasswordAgentMCPMenuBar";
const appIconName = "AppIcon.icns";
const launchServicesRegister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export interface MenuBarStatus {
  supported: boolean;
  compilerAvailable: boolean;
  installed: boolean;
  running: boolean;
  launchAtLogin: boolean;
  appPath: string;
  launchAgentPath: string;
  adminUrl: string;
  currentVersion: string;
  installedVersion?: string;
  needsUpdate: boolean;
  reason?: string;
}

export interface InstallMenuBarOptions {
  launch?: boolean;
  launchAtLogin?: boolean;
}

export interface UninstallMenuBarOptions {
  quit?: boolean;
}

interface MenuBarConfig {
  nodePath: string;
  cliPath: string;
  adminUrl: string;
  appHome: string;
  logPath: string;
  appPath: string;
  launchAgentPath: string;
  version: string;
}

export function menuBarAppPath(): string {
  return process.env.ONEPASSWORD_MCP_MENUBAR_APP || path.join(os.homedir(), "Applications", appName);
}

export function menuBarLaunchAgentPath(): string {
  return process.env.ONEPASSWORD_MCP_MENUBAR_LAUNCH_AGENT
    || path.join(os.homedir(), "Library", "LaunchAgents", `${bundleId}.plist`);
}

export async function getMenuBarStatus(settings: Pick<Settings, "adminHost" | "adminPort">): Promise<MenuBarStatus> {
  const supported = process.platform === "darwin";
  const appPath = menuBarAppPath();
  const launchAgentPath = menuBarLaunchAgentPath();
  const installed = existsSync(appPath);
  const compilerAvailable = supported && hasSwiftCompiler();
  const currentVersion = await readPackageVersion();
  const installedVersion = installed ? await readInstalledVersion(appPath) : undefined;

  return {
    supported,
    compilerAvailable,
    installed,
    running: installed && isMenuBarRunning(),
    launchAtLogin: existsSync(launchAgentPath),
    appPath,
    launchAgentPath,
    adminUrl: adminUrl(settings),
    currentVersion,
    installedVersion,
    needsUpdate: Boolean(installedVersion && installedVersion !== currentVersion),
    reason: supported
      ? compilerAvailable || installed
        ? undefined
        : "Install Apple's free Command Line Tools to build the transparent menu-bar companion."
      : "The optional menu-bar companion is available on macOS only.",
  };
}

export async function installMenuBar(
  settings: Pick<Settings, "adminHost" | "adminPort">,
  options: InstallMenuBarOptions = {},
): Promise<MenuBarStatus> {
  assertMacOS();
  if (!hasSwiftCompiler()) {
    throw new Error("The menu-bar companion needs Apple's Command Line Tools. Run xcode-select --install, then try again.");
  }

  const targetApp = menuBarAppPath();
  assertSafeAppPath(targetApp);
  const targetParent = path.dirname(targetApp);
  const source = path.join(packageRoot(), "native", "MenuBarApp.swift");
  const iconSource = path.join(packageRoot(), "native", appIconName);
  if (!existsSync(source)) throw new Error(`Menu-bar source is missing: ${source}`);
  if (!existsSync(iconSource)) throw new Error(`Menu-bar icon is missing: ${iconSource}`);

  const version = await readPackageVersion();
  const config: MenuBarConfig = {
    nodePath: process.execPath,
    cliPath: resolveCliScript(),
    adminUrl: adminUrl(settings),
    appHome: appHome(),
    logPath: path.join(appHome(), "menu-bar-admin.log"),
    appPath: targetApp,
    launchAgentPath: menuBarLaunchAgentPath(),
    version,
  };

  await fs.mkdir(targetParent, { recursive: true });
  await fs.mkdir(appHome(), { recursive: true, mode: 0o700 });
  const buildRoot = await fs.mkdtemp(path.join(targetParent, ".onepassword-agent-mcp-build-"));
  const builtApp = path.join(buildRoot, appName);
  const macOSDir = path.join(builtApp, "Contents", "MacOS");
  const resourcesDir = path.join(builtApp, "Contents", "Resources");
  const builtExecutable = path.join(macOSDir, executableName);

  try {
    await fs.mkdir(macOSDir, { recursive: true });
    await fs.mkdir(resourcesDir, { recursive: true });
    await fs.writeFile(path.join(builtApp, "Contents", "Info.plist"), infoPlist(version), "utf8");
    await fs.copyFile(iconSource, path.join(resourcesDir, appIconName));
    await fs.writeFile(path.join(resourcesDir, "menu-bar.json"), `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });

    const compile = spawnSync("xcrun", [
      "swiftc",
      "-parse-as-library",
      "-O",
      "-framework",
      "AppKit",
      source,
      "-o",
      builtExecutable,
    ], { encoding: "utf8" });
    if (compile.error) throw compile.error;
    if (compile.status !== 0) {
      throw new Error(`Could not build the menu-bar companion: ${(compile.stderr || compile.stdout).trim()}`);
    }
    await fs.chmod(builtExecutable, 0o755);

    if (existsSync(targetApp)) {
      quitMenuBar();
      await delay(300);
      await fs.rm(targetApp, { recursive: true, force: true });
    }
    await fs.rename(builtApp, targetApp);
    registerMenuBarApp(targetApp);
  } finally {
    await fs.rm(buildRoot, { recursive: true, force: true });
  }

  if (options.launchAtLogin !== undefined) {
    await setMenuBarLaunchAtLogin(options.launchAtLogin);
  }
  if (options.launch !== false) launchMenuBar();
  await delay(250);
  return getMenuBarStatus(settings);
}

export async function uninstallMenuBar(
  settings: Pick<Settings, "adminHost" | "adminPort">,
  options: UninstallMenuBarOptions = {},
): Promise<MenuBarStatus> {
  assertMacOS();
  const targetApp = menuBarAppPath();
  assertSafeAppPath(targetApp);
  await setMenuBarLaunchAtLogin(false);
  await fs.rm(targetApp, { recursive: true, force: true });
  const status = await getMenuBarStatus(settings);
  if (options.quit !== false) quitMenuBar();
  return status;
}

export async function setMenuBarLaunchAtLogin(enabled: boolean): Promise<void> {
  assertMacOS();
  const plistPath = menuBarLaunchAgentPath();
  const domain = `gui/${typeof process.getuid === "function" ? process.getuid() : 0}`;
  spawnSync("/bin/launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });

  if (!enabled) {
    await fs.rm(plistPath, { force: true });
    return;
  }

  const appPath = menuBarAppPath();
  if (!existsSync(appPath)) throw new Error("Install the menu-bar companion before enabling launch at login.");
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  const tempPath = `${plistPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, launchAgentPlist(appPath), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, plistPath);
  const bootstrap = spawnSync("/bin/launchctl", ["bootstrap", domain, plistPath], { encoding: "utf8" });
  if (bootstrap.error) throw bootstrap.error;
  if (bootstrap.status !== 0) {
    throw new Error(`Could not enable launch at login: ${(bootstrap.stderr || bootstrap.stdout).trim()}`);
  }
}

export function launchMenuBar(): void {
  assertMacOS();
  const appPath = menuBarAppPath();
  if (!existsSync(appPath)) throw new Error("The menu-bar companion is not installed.");
  const result = spawnSync("/usr/bin/open", ["-g", appPath], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not open the menu-bar companion: ${result.stderr.trim()}`);
}

export function quitMenuBar(): void {
  if (process.platform !== "darwin") return;
  const result = spawnSync("/usr/bin/osascript", ["-e", `tell application id "${bundleId}" to quit`], {
    stdio: "ignore",
  });
  if (result.status !== 0) {
    const executable = path.join(menuBarAppPath(), "Contents", "MacOS", executableName);
    spawnSync("/usr/bin/pkill", ["-f", executable], { stdio: "ignore" });
  }
}

export function infoPlist(version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>1Password Agent MCP</string>
  <key>CFBundleExecutable</key><string>${executableName}</string>
  <key>CFBundleIconFile</key><string>${appIconName}</string>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>1Password Agent MCP</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xmlEscape(version)}</string>
  <key>CFBundleVersion</key><string>${xmlEscape(version)}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSMultipleInstancesProhibited</key><true/>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
}

export function launchAgentPlist(appPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${bundleId}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-g</string>
    <string>${xmlEscape(appPath)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
</dict>
</plist>
`;
}

function adminUrl(settings: Pick<Settings, "adminHost" | "adminPort">): string {
  const host = settings.adminHost === "0.0.0.0" || settings.adminHost === "::" ? "127.0.0.1" : settings.adminHost;
  return `http://${host}:${settings.adminPort}`;
}

function hasSwiftCompiler(): boolean {
  const result = spawnSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" });
  return result.status === 0;
}

function registerMenuBarApp(appPath: string): void {
  if (!existsSync(launchServicesRegister)) return;
  spawnSync(launchServicesRegister, ["-f", appPath], { stdio: "ignore" });
}

function isMenuBarRunning(): boolean {
  const result = spawnSync("/usr/bin/osascript", ["-e", `application id "${bundleId}" is running`], {
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === "true";
}

function resolveCliScript(): string {
  const sibling = fileURLToPath(new URL("./cli.js", import.meta.url));
  if (existsSync(sibling)) return sibling;
  const built = path.join(packageRoot(), "dist", "src", "cli.js");
  if (existsSync(built)) return built;
  throw new Error("Build the package before installing the menu-bar companion (npm run build).");
}

async function readPackageVersion(): Promise<string> {
  const raw = await fs.readFile(path.join(packageRoot(), "package.json"), "utf8");
  return String((JSON.parse(raw) as { version?: string }).version || "0.0.0");
}

async function readInstalledVersion(appPath: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(appPath, "Contents", "Resources", "menu-bar.json"), "utf8");
    return String((JSON.parse(raw) as { version?: string }).version || "") || undefined;
  } catch {
    return undefined;
  }
}

function assertMacOS(): void {
  if (process.platform !== "darwin") throw new Error("The optional menu-bar companion is available on macOS only.");
}

function assertSafeAppPath(value: string): void {
  const resolved = path.resolve(value);
  if (path.basename(resolved) !== appName || resolved === path.parse(resolved).root || resolved === os.homedir()) {
    throw new Error(`Refusing unsafe menu-bar app path: ${resolved}`);
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
