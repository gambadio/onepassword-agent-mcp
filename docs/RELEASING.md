# Releasing

Releases use GitHub Actions and short-lived OpenID Connect credentials. Maintainers do not run `npm publish` or `mcp-publisher login` locally.

## One-Time npm Setup

The npm package trusts this exact GitHub Actions publisher:

- GitHub owner: `gambadio`
- Repository: `onepassword-agent-mcp`
- Workflow: `publish.yml`
- Permission: `npm publish`
- Environment: none

This trust relationship is configured once in the npm package settings. It does not store an npm publishing token in GitHub.

The MCP Registry recognizes GitHub's OIDC identity for the `io.github.gambadio` namespace and needs no repository secret.

## Publish A Version

Start with a clean, up-to-date branch. Choose the appropriate semantic-version change:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

The command:

1. Runs the type-checker and test suite.
2. Updates `package.json`, `package-lock.json`, `server.json`, and the MCPB `manifest.json` together.
3. Creates the version commit and matching `vX.Y.Z` tag.
4. Pushes the commit and tag.

The tag starts `.github/workflows/publish.yml`, which verifies the versions, tests and builds again, publishes npm with provenance, updates the official MCP Registry, and creates the GitHub Release.

Watch the release at [GitHub Actions](https://github.com/gambadio/onepassword-agent-mcp/actions/workflows/publish.yml). A failed workflow can be inspected and rerun there.

## Local MCP Bundle

MCPB packages the local stdio server for compatible desktop clients and bundle
directories. Keep `manifest.json` at the same version as `package.json`,
`package-lock.json`, and `server.json`.

```bash
node scripts/build-mcpb.mjs
```

The build compiles the app, stages only runtime files in a temporary directory,
and installs production dependencies from the lockfile with lifecycle scripts
disabled. It never copies the working tree's `node_modules`, environment files,
or local 1Password state. The pinned official `@anthropic-ai/mcpb@2.1.2` tool
validates and packs the bundle. ZIP timestamps and file attributes are normalized
so repeat builds from identical inputs produce identical bytes on the same
platform. The temporary staging directory is removed even if the build fails.

The result is `dist/onepassword-agent-mcp-VERSION.mcpb`, with its SHA-256 printed
after building. Use `--output /path/to/server.mcpb` to choose another destination.
The npm cache defaults to a dedicated directory under the system temporary
directory; `NPM_CONFIG_CACHE` overrides it.

After testing the bundle's local stdio startup, attach it to the matching GitHub
Release. Compare the uploaded asset's SHA-256 with the build output:

```bash
gh release upload vVERSION ./dist/onepassword-agent-mcp-VERSION.mcpb
```

Smithery also documents a local-bundle distribution path, separate from its
remote HTTP publishing form. An authenticated maintainer can optionally publish
the bundle under an existing account namespace:

```bash
smithery mcp publish ./dist/onepassword-agent-mcp-VERSION.mcpb -n YOUR_NAMESPACE/onepassword-agent-mcp
```

Smithery publication requires its own account authorization; the npm/MCP Registry
OIDC release does not authorize Smithery. Verify the release status and downloadable
bundle on Smithery after publishing. The bundle still requires the 1Password CLI
installed and authorized locally. It does not include credentials or configure
unattended access. See the [Smithery publishing guide](https://smithery.ai/docs/build/publish)
and [MCPB specification](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md).

## Why There Is No Device Prompt

Manual npm and MCP Registry publishing use interactive device authorization to prove that the person at the computer approves a sensitive account action. Automated releases instead use short-lived OIDC credentials issued only to the named workflow in this public repository. They expire after the job and cannot be reused elsewhere.
