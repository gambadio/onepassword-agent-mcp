<p align="center">
  <img src="public/assets/logo.svg" width="92" alt="1Password Agent MCP logo">
</p>

# 1Password Agent MCP

Local MCP access to approved 1Password items and profile data for AI agents.

[npm package](https://www.npmjs.com/package/onepassword-agent-mcp) · [setup guide](docs/SETUP.md) · [security model](docs/SECURITY.md) · [uninstall guide](docs/UNINSTALL.md)

Agents receive encrypted local handles, not plaintext 1Password secrets. At the moment of copy or paste, the MCP resolves the selected field locally through the 1Password CLI and sends it to the OS clipboard or active app.

The repo contains no personal 1Password data. Every install connects to that user's own 1Password CLI and local approval policy.

> Not affiliated with or endorsed by 1Password.

![Agent vault drag flow](docs/screenshots/mcpvault-workbench.svg)

## How It Works

1. Create a dedicated 1Password vault named `MCPVAULT`.
2. Copy or move selected logins, passwords, API credentials, credit cards, secure notes, or other supported items from your normal vaults into `MCPVAULT`.
3. Approve exact `MCPVAULT` fields for specific websites.
4. Connect Claude Code, Codex, GitHub Copilot, or another MCP client.
5. The agent can paste approved fields without seeing the plaintext in its response.

The MCP tools only expose approved fields from the configured agent vault. The local profile-data section can also expose user-entered values such as email, phone, address, name, and company.

## Quick Start

Install from npm:

```bash
npm install -g onepassword-agent-mcp
```

Run the friendly installer. It detects supported MCP clients, shows what it found, and asks before changing their user configuration. On macOS it separately offers the optional visible menu-bar shortcut:

```bash
onepassword-agent-mcp install
```

Or install from GitHub:

```bash
npm install -g github:gambadio/onepassword-agent-mcp
```

Prefer explicit commands? Check your setup and connect clients manually:

```bash
onepassword-agent-mcp doctor
```

Connect every detected MCP client with one command:

```bash
onepassword-agent-mcp setup all --apply
```

Start the local console:

```bash
onepassword-agent-mcp admin
```

Open:

```text
http://127.0.0.1:7319
```

Full walkthrough: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)

Uninstall guide: [docs/UNINSTALL.md](docs/UNINSTALL.md)

## Does It Always Run?

No. Installing the npm package itself adds commands only. It does not install a launch agent, daemon, background service, startup item, browser extension, or hidden resident process.

- `onepassword-agent-mcp admin` runs the local approval console only while that terminal process is alive.
- `onepassword-agent-mcp mcp` is a stdio MCP server. MCP clients such as Claude Code, Codex, or VS Code launch it as a child process when they need it.
- `onepassword-agent-mcp setup ... --apply` only writes MCP client configuration. Existing JSON files are backed up before a merge.
- The optional macOS menu-bar companion is installed only when you explicitly choose it. Its icon is visible whenever it is running.
- Launch at login is a separate choice and is off by default. Even when enabled, the visible menu-bar app does not start the admin server until you choose **Open Admin Console**.
- Restarting the computer does not auto-start this project unless you enabled the optional menu-bar login item or another app starts an MCP client that then launches the stdio server.
- Persistent local state is limited to approvals and the local encryption key in `~/.onepassword-mcp`.

You can see this explanation any time:

```bash
onepassword-agent-mcp runtime
```

## Optional Mac Menu Bar

On macOS, the guided installer can add a clearly labeled **1P** item to the menu bar. You can also enable it later under **Mac Menu Bar Shortcut** in the local admin page.

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

Use `menubar remove` to close the visible shortcut without uninstalling it, and `menubar launch` to show it again. Use `menubar install` after uninstalling it. The local admin page offers the same installation controls under **Mac Menu Bar Shortcut** while the admin console is running.

The menu contains **Open Admin Console**, **Stop Admin Console**, **Launch Menu Bar at Login**, **Remove From Menu Bar**, and **Uninstall Menu Bar Shortcut**. **Open Admin Console** starts the console when needed and then opens it, so there is no separate Start action. **Remove From Menu Bar** only closes the visible helper; it stays installed and can be reopened. **Uninstall Menu Bar Shortcut** removes the helper and its login item after confirmation. Neither action changes MCP client configuration, local approvals, `MCPVAULT`, or 1Password items.

The admin console itself has explicit process controls:

```bash
onepassword-agent-mcp admin status
onepassword-agent-mcp admin stop
```

## Requirements

- Node.js 20+
- 1Password CLI (`op`)
- 1Password desktop app integration, or an `OP_SERVICE_ACCOUNT_TOKEN`
- An MCP client that supports local stdio servers

macOS:

```bash
brew install node 1password-cli
```

Enable the 1Password desktop integration:

1. Open 1Password.
2. Go to **Settings > Developer**.
3. Turn on **Integrate with 1Password CLI**.
4. When your agent or terminal asks for access, approve only clients you trust.

![Authorize CLI access](docs/screenshots/authorize-codex.svg)

## The Local Console

The console is a simple left-to-right vault flow:

- **Agent Vault Setup** checks whether `MCPVAULT` exists and can create it.
- **Choose From 1Password** searches your normal vaults and can filter by item type.
- **Approve Agent Items** is the right-side `MCPVAULT` area. Drag an item from the left list onto it, then choose **Copy** or **Move**.
- Copied items are grouped into simple checklists for logins, API keys, credit cards, notes, and other fields already in `MCPVAULT`.
- **Allowed For Agents** is the final allow list MCP clients can use.
- **Profile Data For Agents** stores profile values agents may read directly, such as email, phone, address, name, or company.

![Drag to MCPVAULT](docs/screenshots/drag-to-copy.svg)

Copy is the safe default. Copy now uses 1Password's revealed JSON clone pipe so the destination item keeps the original fields. Move is available, but 1Password creates a new item in the destination vault and deletes the original item from the source vault.

After copying, nothing is shared with agents yet. In **All Fields**, copied items stay compact so the page remains easy to scan. Click **Review Details** on an item, tick only the details the agent may use, then click **Approve Selected**. Credit cards show normal checkout details separately from sensitive details like CVV or PIN. Blank allowed-sites fields mean the approved item may be used on all URLs. Items in `MCPVAULT` can also be deleted from the approval console after a confirmation prompt.

When agents are allowed to create new credentials, those items are saved into `MCPVAULT` first. In **Approve Agent Items**, open the saved item and use **Save this item to another vault** to copy or move it into a normal 1Password vault. Copy keeps the agent-vault version. Move removes it from `MCPVAULT` and removes local approvals for that copied item.

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

Remove the global npm package:

```bash
npm uninstall -g onepassword-agent-mcp
```

Optional: delete this app's local approvals and encryption key:

```bash
onepassword-agent-mcp uninstall state
onepassword-agent-mcp uninstall state --apply
```

This deletes `~/.onepassword-mcp`. It does not delete 1Password vaults or items. Delete `MCPVAULT` inside 1Password only if you intentionally want to remove that vault.

## MCP Tools

- `onepassword_status`: check CLI, `MCPVAULT`, local approvals, profile data, and settings.
- `find_secrets_for_site`: return approved encrypted handles for a website.
- `list_approved_secrets`: list approved handles and allowed sites.
- `copy_secret`: resolve a handle and copy the selected field to the clipboard.
- `paste_secret`: resolve a handle, copy it, paste into the active app, and return no plaintext.
- `clear_secret_clipboard`: clear the clipboard.
- `save_secret_item`: save a new login, password, API credential, secure note, or credit card into `MCPVAULT` when the local save setting is enabled.
- `get_profile_data`: return user-defined profile data allowed for the current site.
- `find_passwords_for_site`, `list_approved_passwords`, `copy_password`, `paste_password`, and `clear_password_clipboard`: compatibility aliases.
- `admin_ui_info`: return the approval console URL.

## Security Model

Protected:

- Passwords are not stored by this project.
- MCP copy/paste tools never return plaintext 1Password secret fields.
- Handles and stored 1Password secret references are encrypted locally.
- Disabled or deleted approvals invalidate old handles.
- Allowed-site checks run again at copy and paste time.
- The MCP server only lists and resolves approvals from the configured agent vault.
- Agent-created items are opt-in, and are saved only into the configured agent vault.

Still sensitive:

- The OS clipboard briefly contains the plaintext field value.
- The active app receives the field value when paste is triggered.
- A local process with clipboard access may observe copied secrets.
- With desktop CLI integration, the local 1Password CLI session may have broader vault access than the MCP exposes.
- `get_profile_data` returns plaintext profile values you explicitly added in the admin UI.

For the strictest boundary, use a 1Password service account scoped only to `MCPVAULT`.

Read [docs/SECURITY.md](docs/SECURITY.md) before using this with powerful browser-control agents.

## Local State

Default state location:

```text
~/.onepassword-mcp/policy.json
~/.onepassword-mcp/key.bin
```

Use a different state directory:

```bash
ONEPASSWORD_MCP_HOME=/path/to/state onepassword-agent-mcp admin
```

Use a different agent vault name:

```bash
MCP_VAULT_NAME=AgentVault onepassword-agent-mcp admin
```

Headless service-account example:

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

## Troubleshooting

Run:

```bash
onepassword-agent-mcp doctor
```

Common fixes:

- `op` missing: install the 1Password CLI.
- 1Password auth failure: enable desktop CLI integration or set `OP_SERVICE_ACCOUNT_TOKEN`.
- `MCPVAULT` missing: start the admin console and click **Create MCPVAULT**.
- Copilot setup cannot find `code`: install the VS Code shell command or use `.vscode/mcp.json`.
- Admin UI not running: run `onepassword-agent-mcp admin`.

## Development

Clone the repo:

```bash
git clone https://github.com/gambadio/onepassword-agent-mcp.git
cd onepassword-agent-mcp
npm install
```

Run checks:

```bash
npm run build
npm run typecheck
npm test
```

Run locally:

```bash
npm run dev:admin
npm run dev:mcp
```

## License

MIT
