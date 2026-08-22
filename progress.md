# Progress

## 2026-08-23

- Reviewed user-provided reference repositories and official OpenAI Secure MCP Tunnel documentation.
- Refreshed upstream and created this isolated v4.8.3 worktree.
- Confirmed prior end-to-end tunnel success and isolated the current failure to reconnect after stdio exit.
- Source not yet modified.
- Captured a fresh NAVA accessibility state. First UI click attempt was not delivered because the accessibility-only observation lacked geometry; no app state changed.
- Reproduced the exact UI failure with a delivered Start Tunnel click.
- Added the regression test first; targeted Vitest is red only on the new test because `probeCurrentProcessStart` does not exist yet (9 existing tests passed, 1 expected failure).
- Implemented `probeCurrentProcessStart` and routed Desktop/STDIO self-owner checks through it.
- MCP shared-activity suite passed all 10 tests. Desktop tunnel-lock collection is pending workspace dependency links, not a code failure.
- Installed frozen workspace dependencies. Combined targeted run passed the complete MCP suite; 2 of 20 Desktop lock tests hit existing 2s/5s helper deadlines under load, while 18 passed.
- Isolated single-worker rerun passed all 20 Desktop tunnel-lock tests, confirming the combined-run failures were host-load timing noise rather than a regression.
- Root TypeScript build/typecheck passed with Node 24.
- Broader combined test run passed 35/39. Two timing-sensitive lifecycle cases exceeded their existing deadlines under combined load; two packaging cases correctly failed because Desktop build artifacts had not been generated yet.
- Ported the NAVA branding patch made directly on v4.8.3, built with bundled Node 24, and passed packaging 4/4, controller 26/26, and session-resilience 9/9.
- Installed the first corrected package after backing up `D:\Program Files\NAVA Agent`; live feedback revealed a second timeout in the external tunnel-process CIM probe.
- Added native tasklist preflight plus three regression tests; typecheck and controller 29/29 passed after stopping the old polling runtime.
- Reproduced the quoted-path doctor failure, validated the corrected YAML syntax with a real `RESULT ok`, and added a seven-test profile rewrite suite.
- Rebuilt the package, installed it over the backed-up v4.8.3 directory, and confirmed NAVA branding/version metadata on the installed executable.
- Relaunched from Windows Explorer with the normal desktop environment. The tunnel acquired its lock, fetched `NAVA Web Fallback` metadata, started the packaged stdio bridge, and remained running.
- Verified local control-plane health: `/healthz` = `200 live`, `/readyz` = `200 ready`, local MCP listener = `127.0.0.1:18765`, and NAVA UI = connected.
- Added the NAVA Obsidian project pages for architecture, setup/usage, troubleshooting, status, rollback, and safety boundaries.
- Opened the logged-in ChatGPT Web Work conversation and confirmed `NAVA Agent` is attached. The final fresh read-only send is pending user confirmation because it is an external representational action.
- Re-ran the MCP regression suite with Node 24: 10/10 passed. A combined Desktop rerun while the installed NAVA/tunnel stayed live passed 44/56 but hit 12 known PowerShell/Windows timing deadlines; the final isolated evidence remains controller 29/29, tunnel-lock 20/20, and profile 7/7.
- After explicit user confirmation, sent one read-only ChatGPT Web prompt requesting `workspace_list`. The first click timed out without submitting; page re-observation proved the prompt remained a draft, then Enter submitted it exactly once.
- ChatGPT Web completed in 6 seconds and returned four workspaces: `Local Disk C:`, `Local Disk D:`, `Local Disk E:`, and `THANATOS`.
- Correlated the response with a fresh tunnel log event at `2026-08-23T01:07:26.6132244+07:00`: `dispatcher forwarded command to MCP server`. End-to-end validation passed.
