# User Guide

This guide uses fake example vaults and items. Your install connects only to your own local 1Password account.

## The Simple Model

1Password Agent MCP uses one dedicated vault for AI agents:

```text
MCPVAULT
```

Put only the items you are comfortable letting agents use into that vault. Then approve exact fields for specific websites.

![Agent vault drag flow](screenshots/mcpvault-workbench.svg)

## First Run

Install the package:

```bash
npm install -g onepassword-agent-mcp
```

Run the guided installer:

```bash
onepassword-agent-mcp install
```

It explains each change before making it. On a Mac, you may choose a visible menu-bar shortcut; launch at login is a separate optional question and defaults to off.

Check your machine:

```bash
onepassword-agent-mcp doctor
```

Start the local console:

```bash
onepassword-agent-mcp admin
```

Open:

```text
http://127.0.0.1:7319
```

## Step 1: Create MCPVAULT

If the console says `MCPVAULT does not exist yet`, click **Create MCPVAULT**.

That creates an empty 1Password vault. It does not copy, move, or approve anything yet.

## Step 2: Copy Or Move Items Into MCPVAULT

Use **Choose From 1Password**:

1. Pick your source vault, such as `Private`.
2. Pick a type filter, such as **API keys** or **Credit cards**, when you do not want a mixed list.
3. Search by item name, website, category, or account label.
4. Drag the item from the left list onto the **Approve Agent Items** panel on the right.
5. Choose **Copy** or **Move** in the small confirmation window.

![Drag to MCPVAULT](screenshots/drag-to-copy.svg)

Use **Copy** first when you are unsure. Copy leaves the original item in the source vault and duplicates its fields into `MCPVAULT`.

Use **Move** only when you want the item removed from the source vault. 1Password creates a new item in the destination vault, so the item ID changes.

The source search shows up to 500 items by default. After a copy, the left list stays in place; after a move, the moved item is removed from the visible list without reloading the whole source vault.

## Step 3: Approve Agent Fields

After an item is inside `MCPVAULT`, it appears under **Approve Agent Items**. Nothing is shared with agents yet.

Use the boxes at the top of that panel to manage each type independently:

- **Logins** for login/password items.
- **API Keys** for API Credential items.
- **Credit Cards** for cardholder, number, CVV, PIN, and expiry fields.
- **Notes & SSH** for secure notes and SSH keys.
- **Other** for remaining supported concealed/custom fields.

Think of this section as a checklist:

1. Pick the type box you want, such as **Credit Cards**.
2. Find the copied item. It appears once, even if it contains several fields.
3. Click **Review Details**.
4. Read the simple field names and tick only what the agent may use.
5. Enter allowed sites, such as:

```text
github.com, *.github.com
```

Leave allowed sites blank when the approved details may be used on any URL.

6. Click **Approve Selected**.

For credit cards, suggested details are usually cardholder name, card number, and expiry date. CVV and PIN are shown separately and are not suggested by default.

![Approve sites](screenshots/approve-sites.svg)

Approved details appear under **Allowed For Agents**. Agents can request encrypted handles for those entries, but the MCP copy/paste tools do not return plaintext field values.

Supported fields include normal login passwords, API credentials, credit-card number/CVV/expiry fields, secure-note text, SSH private keys, and many custom concealed fields.

## Save Agent-Created Items To A Normal Vault

If you enable **Allow agents to save new items into MCPVAULT**, the agent can create a login, API key, secure note, credit card, or password item. It is saved into the agent vault first, not your normal vaults.

When you trust the new item:

1. Open **Approve Agent Items**.
2. Click **Review Details** on the item.
3. Choose a destination under **Save this item to another vault**.
4. Click **Copy To Vault** to keep the agent-vault copy, or **Move To Vault** to remove it from `MCPVAULT`.

Moving an item out of `MCPVAULT` also removes local agent approvals for that copied item.

## Step 4: Add Profile Data

Use **Profile Data For Agents** when an agent needs contact or identity details that are not a 1Password secret field:

- email address
- phone number
- mailing address
- name
- company
- username

Profile data is stored locally by this app and returned directly through the `get_profile_data` MCP tool. Use allowed sites when a value should only be used on specific websites. Leave allowed sites blank when it may be used anywhere.

## Delete An Agent Vault Item

In **Approve Agent Items**, click **Delete** next to an item to remove it from `MCPVAULT`.

The console asks for confirmation first. 1Password moves deleted items to Recently Deleted, and any local agent approval for that item is removed.

## What Agents Can Do

Agents can:

- Ask which approved secret fields match the current website.
- Receive encrypted local handles.
- Ask the MCP to copy or paste a field.
- Save new logins, passwords, API credentials, secure notes, or credit cards into `MCPVAULT` after you enable that write permission in local settings.
- Read profile data that you added in the admin page.

Agents cannot:

- Search your whole 1Password account through the MCP.
- See plaintext 1Password secret fields in model responses from copy/paste tools.
- Use entries that are not enabled under **Allowed For Agents**.
- Use a secret for the wrong site unless you turn on the unsafe advanced setting.

## What Is The Expert Fallback?

Most users should ignore **Expert fallback: add a secret reference manually**.

Use it only when the normal search cannot show the exact field you need, for example a custom API token field. The secret reference must point at an item in `MCPVAULT`, for example:

```text
op://MCPVAULT/GitHub deploy token/password
```

The app encrypts that reference locally. It still does not store the field value.

## What Are Advanced Local Settings?

Most users can leave them alone.

- `Agent vault name`: the dedicated vault agents may use. Default: `MCPVAULT`.
- `1Password CLI path`: where the `op` command lives. Default: `op`.
- `Account`: optional account shorthand or sign-in address.
- `Clipboard clear seconds`: how long a copied field value stays on the clipboard.
- `Allow paste without expected site`: keep this off. It removes the site safety check.
- `Allow agents to save new items into MCPVAULT`: opt-in write permission for MCP clients to create new items in the agent vault.

## Best Practice

Use desktop 1Password CLI integration for interactive local use.

For stricter production or headless use, create a 1Password service account that has access only to `MCPVAULT`, then run the MCP with `OP_SERVICE_ACCOUNT_TOKEN`.

## Is It Always Running?

No. Installing 1Password Agent MCP adds local commands and lets MCP clients launch the server when needed. The npm installation itself does not install a startup item or hidden background service.

- The approval console runs only while `onepassword-agent-mcp admin` is running.
- The MCP server runs only when an MCP client launches `onepassword-agent-mcp mcp`.
- Client setup writes client config, so the client can launch the MCP later.
- The optional Mac menu-bar app is installed only when you choose it and is visible while running. It starts the admin console only when you ask.
- Restarting the computer does not auto-start this project unless you separately enabled **Launch Menu Bar at Login** or an MCP client starts it.

If the **1P** menu item is closed, run `onepassword-agent-mcp menubar launch`. If you removed it, run `onepassword-agent-mcp menubar install`. The menu's **Stop Admin Console** action and `onepassword-agent-mcp admin stop` can stop the console even when it was originally started somewhere else.

Run this any time:

```bash
onepassword-agent-mcp runtime
```

## Optional Mac Menu Bar

Use **Mac Menu Bar Shortcut** in the admin page to enable or remove the clearly labeled **1P** menu item. **Open Admin Console** starts the console when needed and opens it. The same menu can stop the console, change launch at login, or remove the shortcut without changing MCP configuration or 1Password data.

The app is compiled locally from readable Swift source. It lives in your user `Applications` folder, requires no administrator password, and can be removed without deleting approvals or anything in 1Password.

## Uninstall

1. Stop the admin console with `Ctrl-C`.
2. Disconnect clients:

```bash
onepassword-agent-mcp uninstall all
onepassword-agent-mcp uninstall all --apply
```

3. Remove the npm package:

```bash
npm uninstall -g onepassword-agent-mcp
```

4. Optional: remove local approvals and the local encryption key:

```bash
onepassword-agent-mcp uninstall state --apply
```

This optional cleanup removes `~/.onepassword-mcp`. It does not delete `MCPVAULT` or any 1Password item.
