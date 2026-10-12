# Clipboard saves, unattended access, and dashboard refresh

Outcome: agents can save copied browser/text secrets without secret tool arguments or responses; users can configure unattended 1Password access and persistent app permissions in a modern local dashboard. Release the tested package and update MCP listings.

Decisions: retain explicit vault/field/site policy and existing defaults. Clipboard capture requires its own opt-in plus item creation permission. Require a stable request ID and encrypted, expiring retry staging. Never read real user clipboard during development. Unattended access uses a user-supplied 1Password service account, encrypted locally with the existing local key; no bypass of desktop unlock or MCP host approvals. Tokens never appear in settings/status responses. Loopback admin API rejects cross-origin mutations. Preserve existing local configuration. Browser agents must click Copy without extracting the value; plaintext already sent in a chat cannot be removed retroactively.

Roadmap:
- M1 active: clipboard save tool and encrypted retry staging; prove exact roundtrip with fakes, disabled settings, safe errors, idempotent retry, expiry and clipboard changes.
- M2 active: encrypted service-account configuration, CLI integration and dashboard controls; prove token not stored as plaintext/returned, persistence/toggle/removal, fail-closed config and origin protections.
- M3 active: responsive dashboard redesign preserving existing flows; Playwright interaction checks and rendered desktop/mobile inspection.
- M4 planned: integrated tests/typecheck/build/package checks, independent security review, documentation, minor release through existing automation, verified npm and registry/listing outcomes.

Ownership: root integrates auth/backend/docs/release; clipboard_save owns paste, MCP tools and capture tests; dashboard owns public assets and browser tests; research_release checks current release/discovery channels read-only.

Acceptance: saving a copied login returns verified item metadata/opaque handles with no canary value in output or disk; changed clipboard does not mutate a retried save; disabled capture does not read clipboard. Service token is usable only inside local CLI environment, can be disabled/deleted, and cannot leak through API diagnostics. Existing grants and sites continue to work and revoke. UI save status persists and controls remain keyboard/mobile usable. Published version/artifacts are checked separately from local test results.

Evidence: 137 unit/integration tests passed in the full suite; 14 dashboard browser tests passed, plus a production Express API/browser integration test. Added symlink-entry regression and 5 MCPB packaging tests also passed. Typecheck/build/release metadata checks pass. Independent review caught and fixed control-character token validation, retry vault binding, and metadata leakage edge cases. Desktop/mobile screenshots inspected. MCPB production-only contents validated and extracted MCP handshake passed. A real 1Password synthetic dry run timed out waiting for desktop authorization; no real items created. No personal clipboard or token accessed.

M1-M3 implemented and verified with synthetic secrets. M4 active: update docs, commit, release minor version via existing npm/MCP Registry/GitHub workflow, rebuild final MCPB and attach it, refresh existing directory listings, update installed app where authorized. Live unattended credentials are user-configured through Permissions and have not been set by this development session. Initial checkout was clean on main at 0.3.8.
