# Security Notes

1Password Agent MCP keeps plaintext passwords out of model responses. It does not make the local machine immune to malicious software or a malicious MCP host.

## Core Boundary

The MCP is built around one dedicated 1Password vault:

```text
MCPVAULT
```

The admin console can help you search your normal vaults and copy or move selected logins into `MCPVAULT`. The MCP tools only list and resolve approvals that point at the configured agent vault.

With 1Password desktop CLI integration, the local `op` session may technically have access to every vault your 1Password user can access. This app enforces the `MCPVAULT` boundary in code.

For the strictest 1Password-side boundary, use a 1Password service account scoped only to `MCPVAULT`.

## What Is Protected

- Passwords are not stored by this project.
- MCP tools never return plaintext passwords.
- Approved handles are encrypted with a local AES-256-GCM key in `~/.onepassword-mcp/key.bin`.
- The encrypted handle is rechecked against the current local grant before each copy or paste.
- Disabled or deleted grants invalidate old handles.
- Allowed-site checks happen at paste time.
- Grants outside the configured agent vault are ignored and cannot be resolved.

## What Is Still Sensitive

- The OS clipboard briefly contains the plaintext password during copy/paste.
- Any local process with clipboard access might read it during that short window.
- The active app receives the password when paste is triggered.
- The admin UI can create vaults, transfer items, and create or delete grants, so keep it bound to `127.0.0.1`.
- If you set `allowPasteWithoutSite`, an agent can paste an approved handle without proving the target site.
- If the wrong field is focused, `paste_password` will paste into that field. Browser-control agents should click the password input first and pass the current URL as `expectedSite`.

## Copy Versus Move

Copy duplicates a source item into `MCPVAULT` through a direct 1Password CLI pipeline:

```bash
op item get "<item>" --format json | op item create --category login --vault MCPVAULT -
```

The app does not log or store that JSON.

Move uses 1Password's native move command:

```bash
op item move "<item>" --current-vault "<source>" --destination-vault MCPVAULT
```

1Password creates a new item in the destination vault and deletes the original source item, so the item ID changes.

## Recommended Defaults

- Keep `allowPasteWithoutSite` off.
- Use narrow site patterns.
- Keep clipboard clearing at 20 seconds or less.
- Put only agent-usable logins in `MCPVAULT`.
- Use copy before move when you are unsure.
- Prefer a service account scoped only to `MCPVAULT` for headless or production use.

## Why Secret References

The local policy stores encrypted 1Password secret references, not passwords. A secret reference looks like:

```text
op://MCPVAULT/ExampleLogin/password
```

At paste time the server calls:

```bash
op read --no-newline "op://MCPVAULT/ExampleLogin/password"
```

This gets the latest password from 1Password and avoids keeping password material in project files.

## Importer Limitation

The search view uses `op item list --long` and assumes the standard `password` field for Login/Password items. For custom fields, use the expert manual secret-reference form and point it at an item in `MCPVAULT`.
