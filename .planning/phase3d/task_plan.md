# NAVA Phase 3D — Browser Extension Pair/Wake

## SCQA brief

### Situation

The branch starts at merged PR #7 (`5a12a084ac97bd0c405dbb36d40cca9c41dd4a7f`).
Phase 3C.5–3C.7 backend contracts, migration 007, wake policy, loopback
Extension Bridge, and Desktop Command Room controls are present. The installed
NAVA runtime is kept separate and remains untouched during this source phase.

### Complication

The repository has no `apps/chatgpt-extension` package. Pairing and wake state
cannot reach a real ChatGPT tab, so wrong-tab, duplicate-tab, composer, SPA,
offline fallback, and end-to-end restart gates are not yet provable.

### Question

What is the smallest safe browser-extension slice that uses the existing Bridge
and Command Room authority without adding a generic MCP proxy or storing browser
credentials/transcripts?

### Answer

Build a Manifest V3 extension package with a narrow authenticated loopback
client, exact conversation identity checks, visible manual/automatic wake
handling, and focused tests. Keep the feature opt-in and leave installed NAVA
alone until source and packaging gates pass.

## Completion pass

The first source-only slice is committed as `8037dd2`. This pass closes the
remaining local extension gates without changing the installed NAVA runtime.

## Phases

- [x] Inspect existing Bridge/IPC contracts and define the extension package seam
- [x] Add the minimum Manifest V3 extension package and Bridge client
- [x] Add exact conversation/tab/composer/SPA fail-closed logic
- [x] Add focused unit/contract tests and preserve existing regressions
- [x] Run typecheck, ESLint, tests, packaging and secret/artifact scans
- [x] Commit the initial source-only Phase 3D slice
- [x] Add encrypted persistent binding material with explicit unlock/re-pair fallback
- [x] Add bounded automatic wake polling that only runs while unlocked and paired
- [x] Close the manual user-submit flow and SPA/offline/retry contract tests
- [x] Run the extension runtime harness, repository regressions, packaging, and secret scan
- [ ] Run the optional authenticated Chrome pilot with the user's explicit browser session
- [x] Inspect the scoped diff and commit the Phase 3D completion pass

## Acceptance criteria

- Extension package is isolated under `apps/chatgpt-extension` and has no API
  key, cookie, transcript, generic MCP, filesystem, shell, or arbitrary tool
  access.
- Pairing and wake requests use the existing authenticated Extension Bridge.
- Persistent binding material is encrypted at rest and requires an explicit
  local passphrase after browser restart; the passphrase is never persisted.
- Automatic wake polling is bounded to one minute, opt-in through pairing, and
  stops when the extension is locked, unpaired, offline, ambiguous, or unsafe.
- Wake is sent only for the exact bound conversation and unambiguous tab.
- A non-empty composer, generation/edit/voice state, URL/SPA identity change,
  unsupported DOM, or duplicate/ambiguous tab fails closed.
- Existing repository typecheck, lint, relevant tests, and packaging guards pass.
- The user must still paste and submit the continuation prompt manually; the
  extension never overwrites a draft or clicks ChatGPT's Send button.
- The authenticated Chrome pilot remains an operator installation check: this
  source pass does not open or alter the user's browser profile.
- Source diff is small, reviewable, and does not touch the installed runtime,
  original dirty worktree, live EA/MT5 state, Command Room sessions, or epochs.

## Boundaries

- Never call Command Room authority through `tool_batch`.
- Never rejoin, rebind, takeover, or create a connection epoch.
- Never modify `D:\Program`, `D:\Program Files\NAVA Agent`, `%APPDATA%`, or the
  active SQLite database.
- Preserve unrelated dirty files in other worktrees.
