# 0.3.8 repair verification

This release addresses the 9 September 2026 diagnostic handoff.

- JSON reaches `op item create` through a real OS pipe on macOS, while the
  original terminal session remains available for CLI authorization.
- Create and copy require a real item ID and verify destination and content
  with `--reveal` readback. The category/title fallback that could create blank
  copies has been removed.
- A private local operation journal and unique item tags support reconciliation
  after lost output or interrupted readback. Repeated requests do not create
  duplicate items. Save, verification, audit, and approval outcomes are distinct.
- Policy writes serialize across processes; files use unique atomic temporary
  names. Concurrent first-use key creation publishes only complete keys.
- Field type and purpose matching use consistent casing. Candidate item limits
  retain all fields, and unreadable items are reported as partial failures.
- Refresh reloads candidate lists. Request ordering prevents older searches
  from replacing newer results. Settings retain unsaved edits and distinguish
  save failure from reload failure.
- CLI stdin errors, bounded output, timeout, cancellation, and descendant
  cleanup are tested. Raw process diagnostics are excluded from error responses.
- Protocol and health metadata use the installed package version. Doctor uses
  the lightweight health endpoint for console liveness.

Automated coverage includes actual SDK protocol calls, a synthetic executable
that checks stdin is a FIFO and parses its template, cross-process policy
writers, subprocess failure cases, and Chromium UI tests. Live verification
uses `scripts/test-live.mjs`; the script defaults to dry runs.

1Password represents MONTH_YEAR values as YYYYMM. Input such as 2028/09 is
normalized before saving so readback compares the intended stored value.

Reference: [1Password CLI item commands](https://www.1password.dev/cli/reference/management-commands/item).

## Validation on 9 September 2026

- Type-check, build, release metadata, and package-content inspection passed.
- 69 Node regression tests and 6 Chromium browser tests passed.
- `npm audit` reported zero known vulnerabilities after compatible dependency updates.
- With 1Password CLI 2.39.0 on macOS, Node 26.8.1 and Node 24.18.0 both passed
  dry runs for all five categories and actual MCP saves with exact readback,
  retry deduplication, and a concealed-field copy. Each completed live run
  removed all six of its verified fixtures. The Node 24 run completed the
  protocol handshake as package version 0.3.8.
- Real testing exposed two additional credit-card issues beyond the handoff:
  expiry canonicalization and a missing section definition for the PIN. Both
  were fixed and passed the subsequent complete live runs.
