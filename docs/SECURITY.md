# Security Notes

1Password Agent Bridge is designed to keep plaintext passwords out of the model response path. It does not make the local machine immune to malicious software or a malicious MCP host.

## What Is Protected

- Passwords are not stored by this project.
- MCP tools never return plaintext passwords.
- Approved handles are encrypted with a local AES-256-GCM key in `~/.onepassword-mcp/key.bin`.
- The encrypted handle is rechecked against the current local grant before each copy or paste.
- Disabled or deleted grants invalidate old handles.
- Allowed-site checks happen at paste time.

## What Is Still Sensitive

- The OS clipboard briefly contains the plaintext password during copy/paste.
- Any local process with clipboard access might read it during that short window.
- The admin UI can create or delete grants, so keep it bound to `127.0.0.1`.
- If you set `allowPasteWithoutSite`, an agent can paste an approved handle without proving the target site.
- If the wrong field is focused, `paste_password` will paste into that field. Browser-control agents should click the password input first and pass the current URL as `expectedSite`.

## Recommended Defaults

- Keep `allowPasteWithoutSite` off.
- Use narrow site patterns.
- Keep clipboard clearing at 20 seconds or less.
- Use a dedicated 1Password vault or service account for AI-accessible secrets.
- Prefer 1Password desktop app integration for interactive local use.
- For headless use, scope `OP_SERVICE_ACCOUNT_TOKEN` to only the vaults the agent should touch.

## Why Secret References

The local policy stores encrypted 1Password secret references, not passwords. A secret reference looks like:

```text
op://Private/GitHub/password
```

At paste time the server calls:

```bash
op read --no-newline "op://Private/GitHub/password"
```

This gets the latest password from 1Password and avoids keeping password material in project files.

## Importer Limitation

The bulk importer avoids `op item get --format json` because the current 1Password docs show field values in JSON item output. Instead, it uses `op item list --long`, filters locally by search query, and assumes the standard `password` field for Login/Password items. For custom fields, paste a secret reference manually from 1Password.
