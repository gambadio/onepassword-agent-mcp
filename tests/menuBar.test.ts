import assert from "node:assert/strict";
import test from "node:test";
import { infoPlist, launchAgentPlist } from "../src/menuBar.js";

test("menu-bar app is a visible status item without a Dock icon", () => {
  const plist = infoPlist("0.3.0");
  assert.match(plist, /<key>LSUIElement<\/key><true\/>/);
  assert.match(plist, /io\.github\.gambadio\.onepassword-agent-mcp\.menubar/);
  assert.match(plist, /<key>CFBundleShortVersionString<\/key><string>0\.3\.0<\/string>/);
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
