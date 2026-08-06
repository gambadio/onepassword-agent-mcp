# Stop And Uninstall

1Password Agent MCP is intentionally not always running.

Installing the npm package adds CLI commands. Running `setup --apply` writes MCP client configuration. Neither action installs a launch agent, daemon, service, startup item, browser extension, or hidden resident process.

The optional macOS menu-bar shortcut is different: it is installed only after you explicitly choose it in the guided installer or admin page. Its icon remains visible while it is running, and launch at login is a separate setting that defaults to off.

## Stop Running Processes

Stop the admin console from its menu or from any terminal:

```bash
onepassword-agent-mcp admin stop
```

You can also press `Ctrl-C` in the terminal running:

```bash
onepassword-agent-mcp admin
```

The MCP server is normally a child process of your MCP client. Close the client session, or remove the MCP client configuration below.

To close the optional menu-bar shortcut without uninstalling it, choose **Remove From Menu Bar** or run:

```bash
onepassword-agent-mcp menubar remove
```

The helper remains installed. Show it again with:

```bash
onepassword-agent-mcp menubar launch
```

To uninstall the helper and disable its login item, choose **Uninstall Menu Bar Shortcut** or run:

```bash
onepassword-agent-mcp menubar uninstall --apply
```

## Disconnect MCP Clients

Preview the cleanup:

```bash
onepassword-agent-mcp uninstall all
```

Apply supported cleanup:

```bash
onepassword-agent-mcp uninstall all --apply
```

This removes:

- Claude Code config with `claude mcp remove`.
- The merged Claude Desktop entry.
- Codex config with `codex mcp remove`.
- The VS Code user MCP entry.
- Xcode's isolated Codex and Claude Agent entries.
- The optional menu-bar app and its launch-at-login item, if installed.

Raycast keeps MCP configuration in app-managed storage, so uninstall opens its **Manage Servers** screen. Remove `onepassword-agent-mcp` there. If you separately created a workspace-scoped `.vscode/mcp.json`, remove the package's block from that project file as well.

To remove only the menu-bar shortcut:

```bash
onepassword-agent-mcp menubar uninstall
onepassword-agent-mcp menubar uninstall --apply
```

This leaves the MCP connection and local approvals in place.

## Remove The npm Package

```bash
npm uninstall -g onepassword-agent-mcp
```

## Optional: Remove Local App State

Preview:

```bash
onepassword-agent-mcp uninstall state
```

Remove:

```bash
onepassword-agent-mcp uninstall state --apply
```

This deletes `~/.onepassword-mcp`, which contains this app's local approval policy and local encryption key. It does not contain plaintext passwords.

## What This Does Not Delete

Uninstalling does not delete:

- 1Password itself.
- Your normal 1Password vaults.
- `MCPVAULT`.
- Items copied or moved into `MCPVAULT`.

Delete `MCPVAULT` inside 1Password only if you intentionally want to remove that vault and its items.
