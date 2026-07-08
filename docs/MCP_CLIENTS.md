# MCP Client Configuration

1Password Agent Bridge is a local stdio MCP server. After installation, clients should launch:

```bash
onepassword-agent-bridge mcp
```

The bridge CLI can configure common clients for you.

## Install The Bridge

```bash
npm install -g github:gambadio/onepassword-agent-bridge
```

## Claude Code

Automatic:

```bash
onepassword-agent-bridge setup claude-code --apply
```

Equivalent:

```bash
claude mcp add --scope user onepassword-agent-bridge -- onepassword-agent-bridge mcp
```

## Codex

Automatic:

```bash
onepassword-agent-bridge setup codex --apply
```

Equivalent:

```bash
codex mcp add onepassword-agent-bridge -- onepassword-agent-bridge mcp
```

## GitHub Copilot In VS Code

Automatic:

```bash
onepassword-agent-bridge setup copilot --apply
```

Equivalent:

```bash
code --add-mcp '{"name":"onepassword-agent-bridge","command":"onepassword-agent-bridge","args":["mcp"]}'
```

Workspace fallback at `.vscode/mcp.json`:

```json
{
  "servers": {
    "onepassword-agent-bridge": {
      "type": "stdio",
      "command": "onepassword-agent-bridge",
      "args": ["mcp"]
    }
  }
}
```

## Generic MCP JSON

```json
{
  "mcpServers": {
    "onepassword-agent-bridge": {
      "command": "onepassword-agent-bridge",
      "args": ["mcp"]
    }
  }
}
```

You can print this with:

```bash
onepassword-agent-bridge setup generic --json
```

## With A Service Account Token

For headless environments, scope a 1Password service account token to the smallest vault set possible:

```json
{
  "mcpServers": {
    "onepassword-agent-bridge": {
      "command": "onepassword-agent-bridge",
      "args": ["mcp"],
      "env": {
        "OP_SERVICE_ACCOUNT_TOKEN": "ops_..."
      }
    }
  }
}
```

Do not commit service account tokens.

## Useful Admin Command

Keep the approval console running while setting up policy:

```bash
onepassword-agent-bridge admin
```

Then open:

```text
http://127.0.0.1:7319
```
