# MCP Client Configuration

1Password Agent Bridge is a stdio MCP server.

## Generic MCP JSON

```json
{
  "mcpServers": {
    "onepassword-agent-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/onepassword-agent-bridge/dist/src/mcp.js"]
    }
  }
}
```

## With A Service Account Token

For headless environments, scope a 1Password service account token to the smallest vault set possible:

```json
{
  "mcpServers": {
    "onepassword-agent-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/onepassword-agent-bridge/dist/src/mcp.js"],
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
npm run start:admin
```

Then open:

```text
http://127.0.0.1:7319
```
