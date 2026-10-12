<p align="center">
  <img src="https://raw.githubusercontent.com/gambadio/onepassword-agent-mcp/main/public/assets/logo.svg" width="92" alt="1Password Agent MCP logo">
</p>

# 1Password Agent MCP

Let AI agents use and save 1Password secrets through a local MCP server, with a dashboard that puts you in control.

- **Use approved secrets:** agents receive encrypted handles. The server resolves and copies or pastes the selected field locally, without returning its plaintext to the agent.
- **Save copied secrets:** copy a password or API key in your browser or a local app, then let the server save it to 1Password with metadata-only tool arguments.
- **Work unattended:** opt into automatic approval for new items and connect a scoped 1Password service account to avoid repeated desktop unlock prompts.

[npm package](https://www.npmjs.com/package/onepassword-agent-mcp) · [setup guide](docs/SETUP.md) · [user guide](docs/USER_GUIDE.md) · [security model](docs/SECURITY.md) · [uninstall guide](docs/UNINSTALL.md)

> Independent project. Not affiliated with or endorsed by 1Password. Every installation uses its own local settings and 1Password account.

![Vault view showing synthetic example items, approved fields, and clipboard capture status](https://raw.githubusercontent.com/gambadio/onepassword-agent-mcp/main/docs/screenshots/dashboard-vault.png)

*The current dashboard, rendered with synthetic example items. All screenshots in this README use demo data; no real account, password, or service-account token is shown. [Open full-size Vault screenshot](https://raw.githubusercontent.com/gambadio/onepassword-agent-mcp/main/docs/screenshots/dashboard-vault.png).*

## Quick Start

You need **Node.js 20+**, the **1Password CLI (`op`)**, and an MCP client that supports local stdio servers. Authenticate using 1Password desktop integration or a scoped service account.

On macOS, install the prerequisites if needed:

```bash
brew install node 1password-cli
```

For desktop authorization, open **1Password → Settings → Developer** and enable **Integrate with 1Password CLI**. Approve only clients you trust. Service-account setup is described under [Unattended Access](#unattended-access).

Install and run the guided installer:

```bash
npm install -g onepassword-agent-mcp
onepassword-agent-mcp install
```

The installer detects supported MCP clients and asks before updating their configuration. On macOS, it separately offers the optional visible menu-bar shortcut.

Start the dashboard:

```bash
onepassword-agent-mcp admin
```

Open [http://127.0.0.1:7319](http://127.0.0.1:7319). For a manual setup, use `onepassword-agent-mcp doctor`, then `onepassword-agent-mcp setup all --apply`.

**Updating an existing installation?** Run `npm install -g onepassword-agent-mcp@latest`, then restart the admin console and existing MCP clients so they use the new code. Your local settings, approvals, and encryption key are retained.

## Your Dashboard

The sidebar separates the four everyday tasks:

| View | What you control |
| --- | --- |
| **Vault** | Create the agent vault, copy or move items, approve exact fields, and manage **Allowed For Agents**. |
| **Permissions** | Enable item creation, clipboard capture, and automatic approval; configure unattended access and the optional Mac menu-bar shortcut. |
| **Profile** | Add profile data, such as email or address, that agents may read directly. |
| **Activity** | Review recent local operations without secret values. |

### Give An Agent Its First Credential

1. Open **Vault**. Under **Agent Vault Setup**, choose **Create MCPVAULT** if the dedicated vault does not exist.
2. In **Choose From 1Password**, select a **Source vault**, search for an item, and click **Copy**. You can also drag it into **Approve Agent Items** and choose **Copy** or **Move**.
3. In **Approve Agent Items**, click **Review Details**. Choose the exact fields to allow and enter the websites where agents may use them.
4. Click **Approve Selected**. The approved fields appear in **Allowed For Agents**; use its **Enabled** switch, **Save**, and **Delete** controls to manage access.
5. In your MCP client, ask the agent to find the approved credential for the current website and paste it into the intended field.

**Copy** keeps the source item. **Move** removes it from the source vault after transfer. Copying an item into the agent vault does not approve it. An empty website list allows all websites, so add a domain when access should be limited.

The type filters—**All Fields**, **Logins**, **API Keys**, **Credit Cards**, **Notes & SSH**, and **Other**—make larger vaults easier to review. Sensitive fields such as card CVV and PIN are not suggested automatically during manual approval.

To transfer a newly saved credential back to another vault, open **Review Details → Save this item to another vault**. **Copy To Vault** keeps the agent-vault item; **Move To Vault** removes it from the agent vault and removes its local approvals. Use the 1Password app for items containing attachments, documents, or passkeys.

### Choose How Much Agents May Do

Open **Permissions**, choose the settings you want, then click **Save Settings**. All three options below are **off on a fresh installation**.

| Setting | Effect |
| --- | --- |
| **Allow agents to save new items into MCPVAULT** | Allows supported new items to be saved into the configured agent vault. |
| **Save secrets from the clipboard** | Allows metadata-only clipboard saves. Item creation must also be enabled. |
| **Automatically approve items agents create** | Approves supported fields after a new save is verified, so agents can use them immediately. |

![Permissions view with synthetic enabled settings and unattended access](https://raw.githubusercontent.com/gambadio/onepassword-agent-mcp/main/docs/screenshots/dashboard-permissions.png)

*Demo configuration with the three opt-in permissions enabled and simulated saved service-account status. The token field is empty; the saved token is never displayed. [Open full-size Permissions screenshot](https://raw.githubusercontent.com/gambadio/onepassword-agent-mcp/main/docs/screenshots/dashboard-permissions.png).*

<details>
<summary>View the responsive dashboard</summary>

<p><img src="https://raw.githubusercontent.com/gambadio/onepassword-agent-mcp/main/docs/screenshots/dashboard-permissions-mobile.png" width="360" alt="Permissions view at a narrow mobile viewport, using synthetic demo settings"></p>

*The same local dashboard at a narrow viewport. This screenshot does not imply remote access; the server binds to loopback by default.*

</details>

The **Profile** view is separate: values entered there are intentionally readable by agents through `get_profile_data`. Do not store passwords or tokens as profile values.

## Save From The Browser Or Selected Text

In **Permissions**, enable **Allow agents to save new items into MCPVAULT** and **Save secrets from the clipboard**, then click **Save Settings**. Optionally enable automatic approval if agents should be able to use new items immediately.

1. In a browser, click the secret's **Copy** button, or select text in a local app and use Copy. The agent should perform that action without reading the field, clipboard, DOM value, or a screenshot that reveals it.
2. Call the local tool with metadata only:

```json
{
  "title": "Example account",
  "requestId": "example-signup-unique-id",
  "category": "login",
  "url": "https://example.com",
  "username": "my-login"
}
```

Use those arguments with `save_secret_from_clipboard`. Supported categories are `login`, `password`, `api_credential`, and `secure_note`. Text is preserved exactly, including spaces and newlines. The tool runs on the computer hosting this MCP server and reads that computer's clipboard; a remote browser's clipboard is a different clipboard.

The app encrypts a retry snapshot locally, usable for 15 minutes, passes plaintext only through the local CLI's stdin, and verifies the stored item. The response contains save and approval metadata, never the copied text; use the find/list tools for approved encrypted handles. Expired ciphertext is removed while the process runs or on the next capture after downtime; a metadata-only record prevents reusing an old request ID. Clipboard clearing rechecks that the value has not changed and is best effort; check the returned cleanup status. Clipboard managers may retain their own history.

Reuse the same `requestId` and metadata to retry. A retry uses the original encrypted capture even if the clipboard changes. An expired capture fails closed instead of capturing unrelated text; inspect the previous operation before intentionally starting a new request. Metadata such as titles, usernames, and URLs remains visible to the model: never put a secret in those fields. `save_secret_item` remains available for values already in context; it cannot undo that exposure.

## Automatic Approval

Under **Permissions**, enable **Automatically approve items agents create**, then click **Save Settings**. This option defaults to off. Agent item creation must also be enabled.

When enabled, a verified save through `save_secret_item` or `save_secret_from_clipboard` automatically approves every supported field of the new item in the configured agent vault, including credit-card CVV and PIN. The agent can use the resulting encrypted handles immediately. Existing items and items copied or moved in through the admin console still need manual approval.

<details>
<summary>CLI controls, site scoping, and retry behavior</summary>

The CLI controls the same saved option:

```bash
onepassword-agent-mcp settings auto-approve on
onepassword-agent-mcp settings auto-approve off
onepassword-agent-mcp settings --json
```

Changes apply to subsequent new saves without restarting the MCP server. Add `--dry-run` to preview a change. Turning the option off keeps existing approvals; disable or delete individual approvals in **Allowed For Agents** to revoke them. The automatic approval choice is recorded when each save starts. Retrying an older save or a save that opted out does not opt it into automatic approval, and retries do not reinstate revoked approvals.

Automatic approvals use `allowedSites` when provided, otherwise the saved item's website. An empty list or an item without a website allows all sites. `approveForAgents: false` skips approval for that save. With automatic approval off, `approveForAgents: true` retains the existing single-field approval behavior, using `approveField` when supplied and allowing all sites unless `allowedSites` is provided. With automatic approval on, `approveField` does not narrow the set of approved fields.

</details>

## Unattended Access

The **Permissions → Unattended access** card accepts a 1Password service-account token directly in the local dashboard. Create the token in [1Password's service-account settings](https://www.1password.dev/service-accounts/get-started/) with access only to your dedicated agent vault. Grant `read_items`, plus `write_items` for saves. In the dashboard, paste it into **Service account token** and click **Save encrypted token**. The input clears immediately. Do not send the token in chat.

The app encrypts the token locally in `~/.onepassword-mcp/access.json`, never returns it to the dashboard or MCP client, and supplies it only to the CLI process environment. Changes apply to later CLI calls without restarting. **Test connection** checks vault visibility; it does not write a test item or certify write permissions. Turn off **Use saved service account** to switch back to desktop authentication, or choose **Remove saved token** to delete the local credential. Revoke the token in 1Password if you want to invalidate it everywhere. In-flight operations may finish after a toggle.

An externally configured `OP_SERVICE_ACCOUNT_TOKEN` takes precedence; the dashboard reports that mode, and removing a local token cannot disable the environment credential. Service accounts cannot access built-in Personal/Private/Employee vaults. While scoped unattended access is active, the console can only see vaults that token can access; disable it before copying items from other desktop-account vaults.

There are three separate permission layers:

| Permission | Where to control it |
| --- | --- |
| Creating items, clipboard capture, automatic field approval | This console's Permissions view; approvals persist locally |
| Repeated 1Password unlock/biometric prompts | Use the supported service-account path for unattended work |
| Confirmation before an MCP tool call | Your MCP client's own permission settings |

This app does not change your MCP client's tool confirmations or bypass 1Password's desktop unlock protections. See [1Password's desktop integration security model](https://www.1password.dev/cli/app-integration-security/) and [service-account CLI documentation](https://www.1password.dev/cli/reference/management-commands/service-account/).

## Client Setup

The setup CLI prints a dry run by default. It detects Claude Code, Claude Desktop, Codex, VS Code, Xcode coding agents, and Raycast AI when they are installed:

```bash
onepassword-agent-mcp setup all
```

Apply setup to every detected client:

```bash
onepassword-agent-mcp setup all --apply
```

The command uses absolute executable paths so GUI apps do not depend on Terminal's `PATH`. Claude Desktop and VS Code JSON are merged with timestamped backups. Xcode's private Codex and Claude configuration folders are handled separately because Xcode does not use the normal CLI configuration.

Raycast stores MCP configuration in app-managed storage and does not expose a supported external config writer. The CLI opens Raycast's official **Import Servers** screen; review the prepared entry and confirm it once in Raycast. This is the only interactive client-specific step.

### Claude Code

```bash
onepassword-agent-mcp setup claude-code --apply
```

Equivalent command:

```bash
claude mcp add --scope user onepassword-agent-mcp -- onepassword-agent-mcp mcp
```

### Codex

```bash
onepassword-agent-mcp setup codex --apply
```

Equivalent command:

```bash
codex mcp add onepassword-agent-mcp -- onepassword-agent-mcp mcp
```

### GitHub Copilot In VS Code

```bash
onepassword-agent-mcp setup copilot --apply
```

Equivalent VS Code command:

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

### Claude Desktop

```bash
onepassword-agent-mcp setup claude-desktop --apply
```

The CLI safely merges the server into Claude Desktop's user JSON and preserves all other settings.

### Xcode

```bash
onepassword-agent-mcp setup xcode --apply
```

This configures the isolated Codex and Claude Agent environments used only inside Xcode.

### Raycast AI

```bash
onepassword-agent-mcp setup raycast --apply
```

Raycast opens its native import screen for the final confirmation. Raycast asks before MCP tool calls by default.

### ChatGPT Desktop

ChatGPT Desktop is intentionally not included in local setup. ChatGPT currently connects to remote MCP servers rather than arbitrary local stdio commands. Do not expose this password bridge through a public tunnel merely to connect it.

### Other MCP Clients

Print generic MCP JSON:

```bash
onepassword-agent-mcp setup generic --json
```

Generic config:

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

## Runtime And Menu Bar

Installing the npm package adds commands only. It does not install a launch agent, daemon, background service, startup item, browser extension, or hidden resident process.

- `onepassword-agent-mcp admin` runs the local approval console only while that terminal process is alive.
- `onepassword-agent-mcp mcp` is a stdio MCP server. MCP clients such as Claude Code, Codex, or VS Code launch it as a child process when they need it.
- `onepassword-agent-mcp setup ... --apply` only writes MCP client configuration. Existing JSON files are backed up before a merge.
- The optional macOS menu-bar companion is installed only when you explicitly choose it. Its icon is visible whenever it is running.
- Launch at login is a separate choice and is off by default. Even when enabled, the visible menu-bar app does not start the admin server until you choose **Open Admin Console**.
- Restarting the computer does not auto-start this project unless you enabled the optional menu-bar login item or another app starts an MCP client that then launches the stdio server.
- Local state in `~/.onepassword-mcp` includes settings, approvals, profile data, audit and save-operation metadata, the encryption key, optional encrypted service-account credentials, and clipboard retry records. See [Local State](#local-state).

You can see this explanation any time:

```bash
onepassword-agent-mcp runtime
```

### Optional Mac Menu Bar

On macOS, the guided installer can add a clearly labeled **1P** item to the menu bar. You can also enable it later under **Permissions → Mac Menu Bar Shortcut** in the dashboard.

The companion is built locally from the readable Swift source in [`native/MenuBarApp.swift`](native/MenuBarApp.swift). No opaque app binary is shipped in the npm package. The generated app uses the project's teal shield logo, is placed at `~/Applications/1Password Agent MCP.app`, and never asks for administrator access.

Manual controls:

```bash
onepassword-agent-mcp menubar status
onepassword-agent-mcp menubar install
onepassword-agent-mcp menubar launch
onepassword-agent-mcp menubar remove
onepassword-agent-mcp menubar install --launch-at-login
onepassword-agent-mcp menubar login on
onepassword-agent-mcp menubar login off
onepassword-agent-mcp menubar uninstall --apply
```

Use `menubar remove` to close the visible shortcut without uninstalling it, and `menubar launch` to show it again. Use `menubar install` after uninstalling it. The local admin page offers the same installation controls under **Permissions → Mac Menu Bar Shortcut** while the admin console is running.

The menu contains **Open Admin Console**, **Stop Admin Console**, **Launch Menu Bar at Login**, **Remove From Menu Bar**, and **Uninstall Menu Bar Shortcut**. **Open Admin Console** starts the console when needed and then opens it, so there is no separate Start action. **Remove From Menu Bar** only closes the visible helper; it stays installed and can be reopened. **Uninstall Menu Bar Shortcut** removes the helper and its login item after confirmation. Neither action changes MCP client configuration, local approvals, `MCPVAULT`, or 1Password items.

The admin console itself has explicit process controls:

```bash
onepassword-agent-mcp admin status
onepassword-agent-mcp admin stop
```

## MCP Tools

- `onepassword_status`: check CLI, `MCPVAULT`, local approvals, profile data, and settings.
- `find_secrets_for_site`: return approved encrypted handles for a website.
- `list_approved_secrets`: list approved handles and allowed sites.
- `copy_secret`: resolve a handle and copy the selected field to the clipboard.
- `paste_secret`: resolve a handle, copy it, paste into the active app, and return no plaintext.
- `clear_secret_clipboard`: clear the clipboard.
- `save_secret_item`: save a new login, password, API credential, secure note, or credit card into `MCPVAULT` when the local save setting is enabled. Returns verification and approval status, plus `approvedFields` (and the first field as `approvedField` for compatibility). Automatic approval follows the local `autoApproveAgentItems` setting.
- `save_secret_from_clipboard`: save exact locally copied text with metadata-only tool arguments, encrypted retry capture, verification, and optional automatic approval. Requires both clipboard-save and item-creation permissions.
- `get_profile_data`: return user-defined profile data allowed for the current site.
- `find_passwords_for_site`, `list_approved_passwords`, `copy_password`, `paste_password`, and `clear_password_clipboard`: compatibility aliases.
- `admin_ui_info`: return the approval console URL.

### Save Verification And Retries

`save_secret_item` reports `created`, `verified`, `itemId`, `vaultId`, and
`operationId`. Success requires a readback that matches the intended title,
category, destination, websites, and field values. Secret values are compared
locally and are never included in the result. The optional `approvalStatus`
is separate: an item can be saved and verified while its approval still needs
review in the admin UI.

Reuse the same `requestId` and input after an interrupted save. If omitted,
identical item contents in the same destination are deduplicated. Supply a new
`requestId` only to intentionally create another item. Recovery uses a unique
`opmcp-…` item tag and a local operation record, never a title match. If a previous
operation cannot be reconciled, the tool reports an unresolved result instead
of silently creating another item. An approval revoked by the user is never
reinstated by a save retry.

On macOS and Linux, JSON crosses an OS pipe with no plaintext temporary files
or secret values in command arguments. The runner preserves the terminal
session for 1Password authorization and cleans up its child process group on
timeout or cancellation. Copy reads and verifies supported JSON fields,
including concealed values. Items containing attachments, documents, or
passkeys must be copied using the 1Password app.

Restart existing MCP clients and the admin console after updating so every
writer uses the current policy locking and save verification code. Existing
settings, approvals, and the encryption key are retained.

## Security Model

Protected:

- Saved item secrets stay in 1Password. Clipboard saves use temporary encrypted retry captures; an optional unattended service-account token is encrypted locally.
- MCP copy/paste tools never return plaintext 1Password secret fields.
- Handles and stored 1Password secret references are encrypted locally.
- Disabled or deleted approvals invalidate old handles.
- Allowed-site checks run again at copy and paste time.
- The MCP server only lists and resolves approvals from the configured agent vault.
- Agent-created items and clipboard capture are separate opt-ins; new items are saved only into the configured agent vault.
- Automatic approval of agent-created fields is a separate opt-in setting and defaults to off.

Still sensitive:

- The OS clipboard briefly contains the plaintext field value.
- The active app receives the field value when paste is triggered.
- A local process with clipboard access may observe copied secrets.
- The encryption key is local to the same user account. A process that can read both the key and encrypted files can decrypt them.
- With desktop CLI integration, the local 1Password CLI session may have broader vault access than the MCP exposes.
- `get_profile_data` returns plaintext profile values you explicitly added in the admin UI.

For the strictest boundary, use a 1Password service account scoped only to `MCPVAULT`.

Read [docs/SECURITY.md](docs/SECURITY.md) before using this with powerful browser-control agents.

## Local State

The default state directory is `~/.onepassword-mcp`:

| File or directory | Contents |
| --- | --- |
| `policy.json` | Settings, approvals with encrypted secret references, user-entered profile values, audit metadata, and save-operation records. |
| `key.bin` | The local encryption key. Protect it together with the state directory. |
| `access.json` | Optional encrypted service-account token and its enabled state. |
| `clipboard-captures/` | Encrypted retry captures usable for 15 minutes. Expired captures retain metadata to prevent reuse of an old request ID. |
| `admin-runtime.json` | Local process-control metadata while the dashboard runs. |
| `menu-bar-admin.log` | Admin output when launched through the optional menu-bar companion. |

Saved item secrets live in 1Password. Encrypted captures and service-account credentials are the local exceptions described above. This is local encryption, not protection against a process that can read both the ciphertext and the key.

Use a different state directory:

```bash
ONEPASSWORD_MCP_HOME=/path/to/state onepassword-agent-mcp admin
```

Use a different agent vault name for a new configuration:

```bash
MCP_VAULT_NAME=AgentVault onepassword-agent-mcp admin
```

For an existing installation, change **Permissions → Advanced local settings → Agent vault name** and save. Keep the admin console and MCP clients on the same state directory.

For headless deployments, supply `OP_SERVICE_ACCOUNT_TOKEN` securely in the MCP server's environment. An environment token takes precedence over the dashboard's saved token. Do not commit tokens to source control or paste them into an agent conversation.

## Stop And Uninstall

Stop the local approval console by pressing `Ctrl-C` in the terminal running:

```bash
onepassword-agent-mcp admin
```

Disconnect MCP clients:

```bash
onepassword-agent-mcp uninstall all
onepassword-agent-mcp uninstall all --apply
```

The uninstall command removes its entries from Claude Code, Claude Desktop, Codex, VS Code, and Xcode where present, then removes the optional menu-bar app/login item. Raycast opens **Manage Servers** for an explicit removal because its settings are app-managed. Other client settings and all 1Password data remain untouched.

Optional: delete this app's local state, including approvals, profile data, settings, the encryption key, saved service-account token, and clipboard retry records:

```bash
onepassword-agent-mcp uninstall state
onepassword-agent-mcp uninstall state --apply
```

This deletes `~/.onepassword-mcp`. It does not delete 1Password vaults or items, or revoke a service-account token in 1Password. Delete `MCPVAULT` inside 1Password only if you intentionally want to remove that vault.

Finally, remove the global npm package after any optional state cleanup:

```bash
npm uninstall -g onepassword-agent-mcp
```

## Troubleshooting

Run `onepassword-agent-mcp doctor` to check CLI discovery, authorization, vault visibility, local creation permission, and console liveness.

| Symptom | Check |
| --- | --- |
| `op` is missing, or works only in Terminal | Install the 1Password CLI. Under **Permissions → Advanced local settings**, leave **1Password CLI path** as `op` for automatic discovery, or set the correct path. On macOS, discovery also checks `/opt/homebrew/bin/op` and `/usr/local/bin/op`. |
| Repeated 1Password authorization prompts | Configure [Unattended Access](#unattended-access) with a scoped service account. MCP-client tool confirmations are a separate setting in that client. |
| Clipboard save is unavailable | Enable both creation and clipboard saving under **Permissions**, then **Save Settings**. The tool reads the clipboard on the MCP server's computer. |
| A save succeeded but the agent cannot use it | Check its approval status. Review fields under **Vault → Approve Agent Items**, or opt into automatic approval for future saves. |
| Source vaults disappeared | A scoped service account may only see the agent vault. Pause **Use saved service account** to return to desktop authorization before copying from other vaults. |
| `MCPVAULT` is missing | Open **Vault** and choose **Create MCPVAULT** using an account permitted to create vaults. |
| Dashboard is not running | Run `onepassword-agent-mcp admin`, or use **Open Admin Console** in the optional menu-bar app. |
| Copilot setup cannot find `code` | Install the VS Code shell command or use the `.vscode/mcp.json` configuration above. |

## Development

Clone and install:

```bash
git clone https://github.com/gambadio/onepassword-agent-mcp.git
cd onepassword-agent-mcp
npm ci
```

Run locally with `npm run dev:admin` or `npm run dev:mcp`.

### Verification

```bash
npm ci
npm run typecheck
npm test
npx playwright install chromium
npm run test:ui
npm run build
node scripts/test-live.mjs
```

The final command tests all five categories using real CLI dry runs. Unlock
1Password and authorize CLI access when prompted. To additionally test actual
MCP saves, exact readback, retry deduplication, and copy, run:

```bash
node scripts/test-live.mjs --create
```

This requires the saved agent-creation setting. It creates uniquely tagged
synthetic fixtures in the configured agent vault, verifies them, then moves
those exact fixtures to Recently Deleted. It uses isolated local policy state.
If verification or cleanup fails, it prints the recovery state directory and
retains it for inspection. `doctor` checks CLI authorization, destination
visibility, local creation permission, and console liveness; it does not
perform save/copy validation.

Maintainer releases are automated through GitHub Actions with short-lived OIDC credentials. See [docs/RELEASING.md](docs/RELEASING.md); local `npm publish` and repeated device authorization are not part of the release process.

## License

MIT
