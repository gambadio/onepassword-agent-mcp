# Research Notes

Docs were checked on July 8, 2026 while building 1Password Agent MCP.

## MCP TypeScript SDK

Context7 docs for `/modelcontextprotocol/typescript-sdk/v1.29.0` showed the stable SDK imports:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
```

It also showed tool registration with `server.registerTool(...)` and Zod input schemas.

## 1Password CLI

Firecrawl was used to ingest the current 1Password developer docs:

- `https://www.1password.dev/cli/reference`
- `https://www.1password.dev/cli/reference/management-commands/item`
- `https://www.1password.dev/cli/reference/commands/read`
- `https://www.1password.dev/cli/reference/commands/signin`
- `https://www.1password.dev/cli/reference/commands/whoami`
- `https://www.1password.dev/cli/secret-reference-syntax`
- `https://www.1password.dev/cli/secret-references`

Relevant findings:

- `op read <reference>` resolves a 1Password secret reference.
- `op read --no-newline` avoids adding a trailing newline to the pasted password.
- Secret references have the form `op://<vault>/<item>/[section/]<field>`.
- `op item list --long --format json` can list items without requiring full item JSON.
- `op item get --format json` field objects include a `reference` key, but current docs also show `value` keys in field objects. This project avoids full item import by default for that reason.
- `op whoami` reports the active account or service account and errors if not authenticated.
- 1Password CLI can authenticate through desktop app integration or service account tokens.
