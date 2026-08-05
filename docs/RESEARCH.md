# Research Notes

Docs were checked on August 5, 2026 while building 1Password Agent MCP.

## MCP TypeScript SDK

Context7 docs for `/modelcontextprotocol/typescript-sdk/v1.29.0` showed the stable SDK imports:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
```

It also showed tool registration with `server.registerTool(...)` and Zod input schemas.

## 1Password CLI

Primary docs:

- 1Password CLI reference: <https://www.1password.dev/cli/reference>
- Item commands: <https://www.1password.dev/cli/reference/management-commands/item>
- `op read`: <https://www.1password.dev/cli/reference/commands/read>
- Secret reference syntax: <https://www.1password.dev/cli/secret-reference-syntax>
- Service account guide: <https://www.1password.dev/service-accounts/get-started>
- Service account command reference: <https://www.1password.dev/cli/reference/management-commands/service-account>

Relevant findings:

- `op item list --vault <vault>` lists items in a vault.
- `op item list --long --format json` can search item metadata without reading secret field values.
- `op item move <item> --current-vault <source> --destination-vault <destination>` moves an item between vaults.
- 1Password documents that moving creates a copy in the destination vault and deletes the original item, which gives the item a new ID.
- `op item get "<item>" --format json | op item create --vault <vault> -` is the documented pattern for duplicating an existing item into another vault.
- The app uses `op item get "<item>" --format json --reveal | op item create --vault <vault> -` for copy, because the destination item needs the source item's revealed field values. The revealed JSON is piped directly and not logged or stored.
- `op item create` can read JSON templates from stdin, which avoids putting sensitive field values into command arguments.
- `op read --no-newline <secret-reference>` resolves one secret reference without appending a newline.
- Secret references have the form `op://<vault>/<item>/[section/]<field>`.
- `op item get --format json` field objects include a `reference` key, which is useful for expert/custom fields.
- 1Password service accounts can be scoped to selected vaults and permissions.
- 1Password service accounts cannot access built-in Personal, Private, Employee, or default Shared vaults.

## Product Decisions From The Research

- The MCP runtime is constrained to a dedicated agent vault, `MCPVAULT` by default.
- The admin console can use the user's local CLI access to copy or move selected items into `MCPVAULT`.
- Copy is the safe default because the original item stays in its source vault.
- Move is exposed but confirmed because 1Password changes the item ID and removes the source item.
- For strict headless use, docs recommend a 1Password service account that can access only `MCPVAULT`.
- The normal source search stays item-level. The agent-vault approval view reads field metadata for shown items and lets users approve exact fields.
- The expert fallback accepts a 1Password secret reference only when it points at the configured agent vault.
