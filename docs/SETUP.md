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

When your MCP client first uses the CLI, 1Password may ask you to unlock or authorize access. Approve only MCP clients you trust. For unattended work, you can configure a scoped service account later in **Permissions**; that is separate from your client’s tool confirmations.

## 3. Install The MCP

```bash
npm install -g onepassword-agent-mcp
```

Run the guided installer:

```bash
onepassword-agent-mcp install
```

It asks before connecting detected MCP clients. Detection covers Claude Code, Claude Desktop, Codex, VS Code, Xcode coding agents, and Raycast AI. On macOS it separately asks whether to install the visible **1P** menu-bar shortcut and whether that shortcut should appear after login. Both menu-bar choices are optional; launch at login defaults to off.

Then run:

```bash
onepassword-agent-mcp doctor
```

Fix any required checks before continuing.

### Optional macOS menu-bar shortcut

The shortcut can also be installed later:

```bash
onepassword-agent-mcp menubar install
```

It is compiled locally from the package's Swift source and installed in `~/Applications`. It does not start the admin server until you choose **Open Admin Console**. Install or uninstall it at any time from the admin page or with `onepassword-agent-mcp menubar` commands.

Choose **Remove From Menu Bar**, or run `onepassword-agent-mcp menubar remove`, to close the visible shortcut without uninstalling it. Reopen it with `onepassword-agent-mcp menubar launch`. If you chose **Uninstall Menu Bar Shortcut**, restore it with `onepassword-agent-mcp menubar install`. Turn automatic login launch back on with `onepassword-agent-mcp menubar login on`.

## 4. Connect MCP Clients

Dry run:

```bash
onepassword-agent-mcp setup all
```

Apply setup for installed clients:

```bash
onepassword-agent-mcp setup all --apply
```

The command uses absolute executable paths so desktop apps work without Terminal's `PATH`. It creates timestamped backups before merging Claude Desktop, VS Code, or Xcode Claude JSON. Raycast opens its own import screen and asks you to confirm because Raycast keeps MCP settings in app-managed storage.

Individual clients:

```bash
onepassword-agent-mcp setup claude-code --apply
onepassword-agent-mcp setup claude-desktop --apply
onepassword-agent-mcp setup codex --apply
onepassword-agent-mcp setup copilot --apply
onepassword-agent-mcp setup xcode --apply
onepassword-agent-mcp setup raycast --apply
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

Open **Vault** in the sidebar. When 1Password is reachable, the top bar shows **Connected locally**. Use **Refresh** after changing the connection.

The other views are **Permissions** for saving and access settings, **Profile** for directly readable contact details, and **Activity** for recent local operations.

![Vault dashboard with synthetic example items](screenshots/dashboard-vault.png)

## 6. Create The Agent Vault

The default agent vault is:

```text
MCPVAULT
```

If it does not exist, click **Create MCPVAULT** under **Vault → Agent Vault Setup**.

This creates an empty 1Password vault. It does not copy or approve anything yet.

## 7. Copy Or Move Items Into MCPVAULT

In **Vault**, use **Choose From 1Password**:

1. Select a source vault.
2. Select a type filter when you want only logins, API keys, credit cards, notes, or other items.
3. Search by item title, website, category, or account label.
4. Drag an item from the left list onto the **Approve Agent Items** panel on the right.
5. Choose **Copy** or **Move** in the confirmation window.

You can also use the item’s **Copy** or **Move** button. Copy keeps the original item where it is. Move removes the item from the source vault and creates a new item in `MCPVAULT`.

## 8. Approve Fields And Sites

In **Vault**, use **Approve Agent Items**:

1. Use the type boxes to switch between logins, API keys, credit cards, notes, and other fields.
2. Find the copied or moved item in `MCPVAULT`.
3. Click **Review Details**.
4. Tick the exact details agents may use. Sensitive details like card CVV, card PIN, and SSH private keys are shown separately.
5. Enter allowed sites, such as `github.com, *.github.com`.
6. Click **Approve Selected**.

Leave allowed sites blank when an entry may be used on all URLs.

Approved entries appear under **Allowed For Agents**. Agents can use only enabled approvals.

For items agents create themselves, you can skip manual review by enabling **Automatically approve items agents create** under **Permissions** and clicking **Save Settings**. This defaults to off and requires agent item creation to be enabled separately. It approves every supported field, including card CVV and PIN, after a verified save into the configured agent vault. Existing and transferred items still require manual approval. See the [user guide](USER_GUIDE.md#automatically-approve-items-agents-create) for site restrictions and revocation behavior.

The same setting is available in the CLI:

```bash
onepassword-agent-mcp settings auto-approve on
onepassword-agent-mcp settings auto-approve off
onepassword-agent-mcp settings --json
```

### Optional: save copied secrets without exposing them

In **Permissions**, enable **Allow agents to save new items into MCPVAULT** and **Save secrets from the clipboard**, then click **Save Settings**. Both default to off.

Copy the intended secret with a browser’s **Copy** button or the operating system’s Copy action. Then call `save_secret_from_clipboard` with metadata only: title, stable `requestId`, category, and optional website or username. Do not read the secret into the agent’s context or pass it as an argument. The browser and MCP must use the same computer’s clipboard.

The tool encrypts a local retry snapshot, saves through the CLI, and verifies the result. Reuse the same request ID and metadata on retries; the snapshot is usable for 15 minutes and expired captures fail closed. Check the returned clipboard-cleanup status. See the [clipboard workflow](USER_GUIDE.md#save-copied-secrets-without-showing-them-to-the-agent) for supported categories and retry details.

### Optional: avoid repeated desktop authorization

![Permissions and unattended-access dashboard](screenshots/dashboard-permissions.png)

In **Permissions → Unattended access**, paste a 1Password service-account token directly into **Service account token**, then click **Save encrypted token**. Scope it only to your agent vault, with read access and write access if you will save items. Prepare the vault and copy any desktop-account items before enabling this restricted account.

Click **Test connection** to check vault visibility; this does not test write permission. **Use saved service account** pauses or resumes the saved credential, and **Remove saved token** removes it locally. An environment-provided `OP_SERVICE_ACCOUNT_TOKEN` takes precedence. Your machine and MCP must remain running, and MCP-client tool confirmations remain configured in that client. See [Unattended Access](USER_GUIDE.md#unattended-access) for scope and revocation details.

## 9. Save Agent-Created Items Elsewhere

When an agent creates a new credential, it is saved into `MCPVAULT`.

To keep it in a normal vault, open **Review Details** for the item under **Vault → Approve Agent Items**, choose a destination under **Save this item to another vault**, then use **Copy To Vault** or **Move To Vault**.

Copy keeps the `MCPVAULT` version. Move removes it from `MCPVAULT` and removes local approvals for that copied item.

## 10. Add Optional Profile Data

Open **Profile** and use **Profile Data For Agents** to define email, phone, address, name, company, username, or custom text values that agents may retrieve directly.

Profile data is local to this app. It is not read from 1Password. Blank allowed sites means a profile value may be returned for any site.

## 11. Test With An Agent

Ask the agent to:

1. Open a site you approved.
2. Call `find_secrets_for_site` with the current URL.
3. Click the field that should receive the value.
4. Call `paste_secret` with the encrypted handle and `expectedSite`.

The agent should not receive the plaintext 1Password secret field.

## Update

Install the latest npm version again:

```bash
npm install -g onepassword-agent-mcp@latest
```

Your approvals and local access configuration live in `~/.onepassword-mcp` and are not replaced by reinstalling the package. Restart running MCP clients and the admin console to load the updated package.

## Stop Or Uninstall

The npm package itself does not install a launch agent, daemon, service, startup item, browser extension, or hidden background process. The optional menu-bar shortcut and its separate launch-at-login setting are installed only after an explicit choice and remain visible while running.

Stop the admin console with `Ctrl-C` in the terminal that is running:

```bash
onepassword-agent-mcp admin
```

Disconnect supported MCP clients:

```bash
onepassword-agent-mcp uninstall all
onepassword-agent-mcp uninstall all --apply
```

That removes supported client entries and also removes the optional menu-bar shortcut and login item if present. Raycast opens **Manage Servers** for your final confirmation. It does not delete 1Password data.

Optional local cleanup, before removing the command:

```bash
onepassword-agent-mcp uninstall state --apply
```

This removes `~/.onepassword-mcp`, including approvals, the encryption key, clipboard retry records, and any locally saved service-account token. It does not delete `MCPVAULT` or any 1Password item, or revoke the token at 1Password.

Then remove the npm package:

```bash
npm uninstall -g onepassword-agent-mcp
```
