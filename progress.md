# NAVA Progress (rolling summary)

Historical per-day progress logs were pruned from the repository on 2026-09-02
to keep the tracked tree small and free of machine-specific content; the prior
content remains in git history for the operator. Phase-by-phase records live in
`docs/PHASE_PROGRESS.md`.

Current state:

- `main` tracks v4.12.0 Phase 3 development; the published stable installer
  remains v4.11.4 and the locally deployed pilot was built from the PR #7 merge
  (see the README status banner for the authoritative deployed/published split).
- 2026-09-02: PR #8 (fail-closed security defaults, git permission fence,
  lease transactions, corepack-free test runner) and PR #9 (repo hygiene,
  e2e poll hardening, opt-in local MCP HTTP bearer token, Command Room
  room-close lease fan-out test) merged after the authoritative Windows gate.
- Next milestone: Phase 3D browser extension integration (unmerged work on
  `feature/command-room-phase3d`).
