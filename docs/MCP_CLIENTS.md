# MCP Client Configuration

1Password Agent MCP is a local stdio MCP server. After installation, clients should launch:

```bash
onepassword-agent-mcp mcp
```

The CLI can configure common clients for you.

## Install 1Password Agent MCP

```bash
npm install -g https://github.com/gambadio/onepassword-agent-mcp/archive/refs/tags/v0.2.2.tar.gz
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
