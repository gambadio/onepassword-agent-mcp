# Stop And Uninstall

1Password Agent MCP is intentionally not always running.

Installing the npm package adds CLI commands. Running `setup --apply` writes MCP client configuration. Neither action installs a launch agent, daemon, service, startup item, browser extension, or hidden resident process.

## Stop Running Processes

Stop the admin console by pressing `Ctrl-C` in the terminal running:

```bash
onepassword-agent-mcp admin
```

The MCP server is normally a child process of your MCP client. Close the client session, or remove the MCP client configuration below.

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
- Codex config with `codex mcp remove`.

For GitHub Copilot in VS Code, remove the server named `onepassword-agent-mcp` from VS Code's MCP configuration UI. If you used workspace config, remove the `onepassword-agent-mcp` block from `.vscode/mcp.json`.

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
