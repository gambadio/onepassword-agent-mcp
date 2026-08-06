import assert from "node:assert/strict";
import test from "node:test";
import { infoPlist, launchAgentPlist } from "../src/menuBar.js";

test("menu-bar app is a visible status item without a Dock icon", () => {
  const plist = infoPlist("0.3.0");
  assert.match(plist, /<key>LSUIElement<\/key><true\/>/);
  assert.match(plist, /io\.github\.gambadio\.onepassword-agent-mcp\.menubar/);
  assert.match(plist, /<key>CFBundleShortVersionString<\/key><string>0\.3\.0<\/string>/);
});

test("menu-bar status item has an identifiable 1Password label", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile("native/MenuBarApp.swift", "utf8"));
  assert.match(source, /statusItem\(withLength: 32\)/);
  assert.match(source, /button\.image = nil/);
  assert.match(source, /button\.title = "1P"/);
  assert.match(source, /application\.delegate = delegate/);
  assert.match(source, /application\.run\(\)/);
  assert.match(source, /menu\.autoenablesItems = false/);
  assert.match(source, /self\.runCli\(\["admin", "stop"\], wait: true\)/);
  assert.match(source, /self\.stopMenuItem\.isEnabled = reachable/);
  assert.match(source, /\/api\/health/);
  assert.match(source, /Remove From Menu Bar/);
  assert.match(source, /Uninstall Menu Bar Shortcut\.\.\./);
  assert.match(source, /@objc private func removeFromMenuBar\(\)/);
  assert.match(source, /@objc private func uninstallShortcut\(\)/);
  assert.match(source, /DispatchQueue\.main\.asyncAfter\(deadline: \.now\(\) \+ 0\.5\)/);
  assert.match(source, /private func confirmUninstallShortcut\(\)/);
  assert.match(source, /uninstallButton\.hasDestructiveAction = true/);
  assert.match(source, /cancelButton\.keyEquivalent = "\\u\{1b\}"/);
  assert.match(source, /alert\.window\.defaultButtonCell = cancelCell/);
  assert.match(source, /alert\.runModal\(\) == \.alertFirstButtonReturn/);
  assert.match(source, /runCli\(\["menubar", "uninstall", "--apply"\], wait: false\)/);
  assert.doesNotMatch(source, /Start Admin Console/);
  assert.doesNotMatch(source, /Quit Menu Bar/);
  assert.doesNotMatch(source, /startMenuItem/);
});

test("launch-at-login plist opens only the explicit user app path", () => {
  const plist = launchAgentPlist("/Users/example/Applications/1Password Agent MCP.app");
  assert.match(plist, /<string>\/usr\/bin\/open<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><false\/>/);
  assert.doesNotMatch(plist, /onepassword-agent-mcp admin/);
});

test("launch-at-login plist escapes paths as XML", () => {
  const plist = launchAgentPlist("/Users/A & B/Applications/1Password Agent MCP.app");
  assert.match(plist, /A &amp; B/);
});
