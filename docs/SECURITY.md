# Security Notes

1Password Agent MCP keeps plaintext 1Password secret fields out of model responses. It does not make the local machine immune to malicious software or a malicious MCP host.

## Core Boundary

The MCP is built around one dedicated 1Password vault:

```text
MCPVAULT
```

The admin console can help you search your normal vaults and copy or move selected items into `MCPVAULT`. The MCP tools only list and resolve approvals that point at the configured agent vault.

With 1Password desktop CLI integration, the local `op` session may technically have access to every vault your 1Password user can access. This app enforces the `MCPVAULT` boundary in code.

For the strictest 1Password-side boundary, use a 1Password service account scoped only to `MCPVAULT`.

## Process Model

The npm installation does not install a launch agent, daemon, service, startup item, browser extension, or hidden resident process.

- The admin console runs only while `onepassword-agent-mcp admin` is running.
- The MCP server runs as a stdio child process when an MCP client launches `onepassword-agent-mcp mcp`.
- Client setup writes MCP client configuration only.
- The optional macOS menu-bar companion is built and installed only after explicit approval. It is visible while running, does not start the admin server until asked, and its separate launch-at-login setting defaults to off.
- Persistent local app state is limited to `~/.onepassword-mcp` unless `ONEPASSWORD_MCP_HOME` is set.

## What Is Protected

- Passwords and other 1Password secret fields are not stored by this project.
- MCP copy/paste tools never return plaintext 1Password secret fields.
- Approved handles are encrypted with a local AES-256-GCM key in `~/.onepassword-mcp/key.bin`.
- The encrypted handle is rechecked against the current local grant before each copy or paste.
- Disabled or deleted grants invalidate old handles.
- Allowed-site checks happen at paste time.
- Grants outside the configured agent vault are ignored and cannot be resolved.
- A blank allowed-sites list means the grant may be used for all URLs.
- Agent-created items are opt-in, and are saved only into the configured agent vault.
- Profile data is stored locally and returned in plaintext only through the explicit `get_profile_data` tool.

## What Is Still Sensitive

- The OS clipboard briefly contains the plaintext field value during copy/paste.
- Any local process with clipboard access might read it during that short window.
- The active app receives the password when paste is triggered.
- The admin UI can create vaults, transfer items, and create or delete grants, so keep it bound to `127.0.0.1`.
- If you set `allowPasteWithoutSite`, an agent can paste an approved handle without proving the target site.
- If the wrong field is focused, `paste_secret` will paste into that field. Browser-control agents should click the intended input first and pass the current URL as `expectedSite`.

## Copy Versus Move

Copy duplicates a source item into `MCPVAULT` through a direct 1Password CLI pipeline:

```bash
op item get "<item>" --format json --reveal | op item create --vault MCPVAULT -
```

The `--reveal` flag is required so the duplicate keeps the original secret field values. The app pipes that JSON directly from one 1Password CLI process into another; it does not log or store that JSON.

Move uses 1Password's native move command:

```bash
op item move "<item>" --current-vault "<source>" --destination-vault MCPVAULT
```

1Password creates a new item in the destination vault and deletes the original source item, so the item ID changes.

## Recommended Defaults

- Keep `allowPasteWithoutSite` off.
- Use narrow site patterns.
- Leave allowed sites blank only when the item is intentionally URL-agnostic.
- Keep clipboard clearing at 20 seconds or less.
- Put only agent-usable items in `MCPVAULT`.
- Use copy before move when you are unsure.
- Prefer a service account scoped only to `MCPVAULT` for headless or production use.

## Why Secret References

The local policy stores encrypted 1Password secret references, not secret values. A secret reference looks like:

```text
op://MCPVAULT/ExampleLogin/password
```

At paste time the server calls:

```bash
op read --no-newline "op://MCPVAULT/ExampleLogin/password"
```

This gets the latest field value from 1Password and avoids keeping 1Password secret material in project files.

## Supported Item Types

The approval view can expose approvable fields from logins, passwords, API credentials, credit cards, secure notes, SSH keys, and other items with concealed or known sensitive fields. For unusual custom fields, use the expert manual secret-reference form and point it at an item in `MCPVAULT`.

## Agent-Created Items

The `save_secret_item` MCP tool can create new Login, Password, API Credential, Secure Note, and Credit Card items in `MCPVAULT` after **Allow agents to save new items into MCPVAULT** is enabled in local settings. Sensitive values are sent to `op item create` through stdin as a JSON template, not command arguments.

The admin console can later copy or move an item from `MCPVAULT` to another existing 1Password vault. This action is human-driven in the local console. Copy keeps the `MCPVAULT` item and its approvals; move removes the `MCPVAULT` item and removes local approvals for that copied item.

Keep this off unless you want connected MCP clients to be able to create new items in the agent vault.

## Profile Data

Profile data such as email address, phone number, mailing address, name, and company is stored in this app's local policy file. It is not fetched from 1Password. The MCP returns those values directly through `get_profile_data`, filtered by each profile entry's allowed-sites list.
