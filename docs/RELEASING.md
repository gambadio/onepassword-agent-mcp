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
2. Updates `package.json`, `package-lock.json`, and `server.json` together.
3. Creates the version commit and matching `vX.Y.Z` tag.
4. Pushes the commit and tag.

The tag starts `.github/workflows/publish.yml`, which verifies the versions, tests and builds again, publishes npm with provenance, updates the official MCP Registry, and creates the GitHub Release.

Watch the release at [GitHub Actions](https://github.com/gambadio/onepassword-agent-mcp/actions/workflows/publish.yml). A failed workflow can be inspected and rerun there.

## Why There Is No Device Prompt

Manual npm and MCP Registry publishing use interactive device authorization to prove that the person at the computer approves a sensitive account action. Automated releases instead use short-lived OIDC credentials issued only to the named workflow in this public repository. They expire after the job and cannot be reused elsewhere.
