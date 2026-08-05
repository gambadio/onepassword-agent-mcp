# Setup Guide

This guide shows the full local setup flow for 1Password Agent MCP.

## 1. Install Requirements

macOS:

```bash
brew install node 1password-cli
```

Verify:

```bash
node --version
op --version
```

Node.js must be version 20 or newer.

## 2. Enable 1Password CLI Integration

1. Open the 1Password desktop app.
2. Open **Settings > Developer**.
3. Turn on **Integrate with 1Password CLI**.

When your MCP client first uses the CLI, 1Password may show a prompt:

![Authorize CLI access](screenshots/authorize-codex.svg)

Click **Authorize** only for MCP clients you trust.

## 3. Install The MCP

```bash
npm install -g onepassword-agent-mcp
```

Run:

```bash
onepassword-agent-mcp doctor
```

Fix any required checks before continuing.

## 4. Connect MCP Clients

Dry run:

```bash
onepassword-agent-mcp setup all
```

Apply setup for installed clients:

```bash
onepassword-agent-mcp setup all --apply
```

Individual clients:

```bash
onepassword-agent-mcp setup claude-code --apply
onepassword-agent-mcp setup codex --apply
onepassword-agent-mcp setup copilot --apply
```

For unsupported clients, print generic MCP JSON:

```bash
onepassword-agent-mcp setup generic --json
```

## 5. Start The Local Console

```bash
onepassword-agent-mcp admin
```

Open:

```text
http://127.0.0.1:7319
```

The console should show `1Password CLI ready`.

## 6. Create The Agent Vault

The default agent vault is:

```text
MCPVAULT
```

If it does not exist, click **Create MCPVAULT** in the console.

This creates an empty 1Password vault. It does not copy or approve anything yet.

## 7. Copy Or Move Logins Into MCPVAULT

![Vault workbench](screenshots/mcpvault-workbench.svg)

Use **Choose From 1Password**:

1. Select a source vault.
2. Search by item title, website, or account label.
3. Drag a login to **Copy Into MCPVAULT** or **Move Into MCPVAULT**.

Copy is safest because the original item stays where it is. Move removes the item from the source vault and creates a new item in `MCPVAULT`.

## 8. Approve Sites

![Approve sites](screenshots/approve-sites.svg)

Use **Approve Agent Items**:

1. Find the copied or moved login in `MCPVAULT`.
2. Enter allowed sites, such as `github.com, *.github.com`.
3. Click **Approve**.

Leave allowed sites blank when an entry may be used on all URLs.

Approved entries appear under **Allowed For Agents**. Agents can use only enabled approvals.

## 9. Test With An Agent

Ask the agent to:

1. Open a site you approved.
2. Call `find_passwords_for_site` with the current URL.
3. Click the password field.
4. Call `paste_password` with the encrypted handle and `expectedSite`.

The agent should not receive the plaintext password.

## Update

Install the latest npm version again:

```bash
npm install -g onepassword-agent-mcp@latest
```

Your approvals live in `~/.onepassword-mcp` and are not replaced by reinstalling the package.

## Stop Or Uninstall

The package does not install a launch agent, daemon, service, startup item, browser extension, or hidden background process.

Stop the admin console with `Ctrl-C` in the terminal that is running:

```bash
onepassword-agent-mcp admin
```

Disconnect supported MCP clients:

```bash
onepassword-agent-mcp uninstall all
onepassword-agent-mcp uninstall all --apply
```

Remove the npm package:

```bash
npm uninstall -g onepassword-agent-mcp
```

Optional local cleanup:

```bash
onepassword-agent-mcp uninstall state --apply
```

This removes `~/.onepassword-mcp`, which contains local approvals and the local encryption key. It does not delete `MCPVAULT` or any 1Password item.
