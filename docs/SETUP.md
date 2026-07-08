# Setup Guide

This guide shows the full local setup flow for 1Password Agent Bridge.

## 1. Install 1Password CLI

macOS:

```bash
brew install 1password-cli
```

Verify:

```bash
op --version
```

## 2. Enable 1Password CLI Integration

1. Open the 1Password desktop app.
2. Open **Settings > Developer**.
3. Turn on **Integrate with 1Password CLI**.

When your MCP client first asks for secrets, 1Password may show a prompt:

![Authorize CLI access](screenshots/authorize-codex.svg)

Click **Authorize** only for MCP clients you trust.

## 3. Start The Approval Console

```bash
npm install
npm run build
npm run start:admin
```

Open:

```text
http://127.0.0.1:7319
```

The console should show `1Password CLI ready`.

## 4. Search And Approve

![Approval console](screenshots/admin-ui.png)

Use **Find Logins To Approve** to search your 1Password entries by:

- item title
- website
- vault
- account label

Click **Approve** only for entries your agents may use.

## 5. Connect An MCP Client

Use a stdio MCP configuration:

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

## 6. Test With An Agent

Ask the agent to:

1. Open a site you approved.
2. Call `find_passwords_for_site` with the current URL.
3. Click the password field.
4. Call `paste_password` with the encrypted handle and `expectedSite`.

The agent should not receive the plaintext password.
