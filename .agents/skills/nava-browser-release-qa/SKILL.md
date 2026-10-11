---
name: nava-browser-release-qa
description: Validate a web UI release in a real browser across required viewport classes, states, interactions, console/network health, layout/overflow, and business invariants. Use after dashboard/frontend changes and before release; complements impeccable, which owns design quality.
---

# NAVA Browser Release QA

Prove the shipped UI works; do not merely inspect that it looks good.

## Setup

1. Load `impeccable` when visual/UX quality is in scope.
2. Freeze release/business invariants before opening the browser, including any server-side aggregation rules that client code must not bypass.
3. Define the viewport/state matrix. Default when unspecified:
   - 1920x1080 desktop
   - 1366x768 desktop
   - about 768px tablet
   - about 390x844 mobile

## Validation

For each relevant viewport:

1. Load the target through managed Chrome.
2. Capture DOM/layout/screenshot evidence.
3. Check horizontal overflow, clipping, truncation, sticky/fixed collisions, drawer/modal fit, table behavior, and touch-sized controls.
4. Exercise key interactions: navigation, filters, toggles, drill-downs, modal/drawer open-close, empty/zero states, and any user-declared workflow.
5. Test declared runtime states such as LIVE, STALE, OFFLINE, ERROR, DATA DELAY, loading, and empty.
6. Inspect console and network. No uncaught JS errors, failed required assets, or silent API failures are allowed.
7. Verify business invariants from the rendered result and backing request/DOM evidence; do not reimplement server aggregation in client-side QA code.
8. Use screenshot comparison only after functional invariants pass.

## Release Verdict

- `PASS`: all required viewports/states/interactions and invariants pass.
- `PASS_WITH_KNOWN_LIMITATION`: non-blocking issue is documented and explicitly accepted.
- `FAIL`: functional, invariant, console/network, or layout blocker exists.

Keep evidence bounded: one defect batch, one fix batch, one confirmation pass rather than endless visual polishing.
