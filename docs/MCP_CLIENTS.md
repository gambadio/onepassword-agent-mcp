# MCP Client Configuration

1Password Agent MCP is a local stdio MCP server. After installation, clients should launch:

```bash
onepassword-agent-mcp mcp
```

The CLI detects and configures common clients for you. Preview first, then apply:

```bash
onepassword-agent-mcp setup all
onepassword-agent-mcp setup all --apply
```

The apply command uses an absolute path to the installed executable. Existing JSON configurations are merged rather than replaced and receive a timestamped backup before a change.

## Install 1Password Agent MCP

```bash
npm install -g onepassword-agent-mcp
```

## Claude Code

Automatic:

```bash
onepassword-agent-mcp setup claude-code --apply
```

Equivalent:

```bash
claude mcp add --scope user onepassword-agent-mcp -- onepassword-agent-mcp mcp
```

## Codex

Automatic:

```bash
onepassword-agent-mcp setup codex --apply
```

Equivalent:

```bash
codex mcp add onepassword-agent-mcp -- onepassword-agent-mcp mcp
```

## GitHub Copilot In VS Code

Automatic:

```bash
onepassword-agent-mcp setup copilot --apply
```

Equivalent:

```bash
code --add-mcp '{"name":"onepassword-agent-mcp","command":"onepassword-agent-mcp","args":["mcp"]}'
```

Workspace fallback at `.vscode/mcp.json`:

```json
{
  "servers": {
    "onepassword-agent-mcp": {
      "type": "stdio",
      "command": "onepassword-agent-mcp",
      "args": ["mcp"]
    }
  }
}
```

## Claude Desktop

```bash
onepassword-agent-mcp setup claude-desktop --apply
```

The CLI merges `onepassword-agent-mcp` into Claude Desktop's user configuration without replacing other servers or settings.

## Xcode Coding Agents

```bash
onepassword-agent-mcp setup xcode --apply
```

Xcode uses isolated agent homes under `~/Library/Developer/Xcode/CodingAssistant`. The command configures both Xcode's Codex environment and Claude Agent environment when those agents are installed.

## Raycast AI

```bash
onepassword-agent-mcp setup raycast --apply
```

Raycast does not expose a supported external configuration writer. The command opens Raycast's official **Import Servers** screen with the entries prepared by the other client setup. Review and confirm the import in Raycast. Raycast asks for tool approval by default.

## ChatGPT Desktop

ChatGPT Desktop does not currently launch arbitrary local stdio MCP servers, so it is not a setup target. A remote tunnel would weaken the local-only boundary and is intentionally not created.

## Generic MCP JSON

```json
{
  "mcpServers": {
    "onepassword-agent-mcp": {
      "command": "onepassword-agent-mcp",
      "args": ["mcp"]
    }
  }
}
```

You can print this with:

```bash
onepassword-agent-mcp setup generic --json
```

## With A Service Account Token

For headless environments, scope a 1Password service account token to the smallest vault set possible:

```json
{
  "mcpServers": {
    "onepassword-agent-mcp": {
      "command": "onepassword-agent-mcp",
      "args": ["mcp"],
      "env": {
        "OP_SERVICE_ACCOUNT_TOKEN": "ops_...",
        "MCP_VAULT_NAME": "MCPVAULT"
      }
    }
  }
}
```

Do not commit service account tokens.

For the strictest boundary, grant the service account access only to `MCPVAULT`.

## Useful Admin Command

Keep the approval console running while setting up policy:

```bash
onepassword-agent-mcp admin
```

Then open:

```text
http://127.0.0.1:7319
```

## Current MCP Tools

- `onepassword_status`: check local status without returning secrets.
- `find_secrets_for_site`: get encrypted handles for approved fields on a website.
- `list_approved_secrets`: list enabled approved handles.
- `copy_secret`: copy an approved field to the clipboard without returning plaintext.
- `paste_secret`: paste an approved field into the active app without returning plaintext.
- `clear_secret_clipboard`: clear the clipboard.
- `save_secret_item`: save a new Login, Password, API Credential, Secure Note, or Credit Card item into `MCPVAULT` after the local save setting is enabled.
- `get_profile_data`: return local profile values the user entered in the admin UI.
- `find_passwords_for_site`, `list_approved_passwords`, `copy_password`, `paste_password`, and `clear_password_clipboard`: compatibility aliases.

## Runtime Behavior

Installing the package creates CLI commands. The package installation alone does not start anything at boot.

- The admin UI exists only while `onepassword-agent-mcp admin` is running.
- MCP clients launch `onepassword-agent-mcp mcp` as a stdio child process when the client session needs the server.
- The setup command writes MCP client configuration; it does not install a daemon or service.
- The optional visible macOS menu-bar shortcut is installed only after a separate explicit choice. Launch at login is off by default.

Show the same explanation locally:

```bash
onepassword-agent-mcp runtime
```

## Remove Client Configuration

Dry run:

```bash
onepassword-agent-mcp uninstall all
```

Apply supported removers:

```bash
onepassword-agent-mcp uninstall all --apply
```

The command removes the package's entries from Claude Code, Claude Desktop, Codex, VS Code, and Xcode. Raycast opens its native **Manage Servers** screen for the final explicit removal. Workspace-scoped `.vscode/mcp.json` files remain project-owned and must be edited in that project.
