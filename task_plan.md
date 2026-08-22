# NAVA Secure MCP Tunnel recovery

## Goal

Restore reliable NAVA v4.8.3 Secure MCP Tunnel startup and verify the full ChatGPT Web -> OpenAI Tunnel -> local NAVA MCP path without weakening tunnel ownership safety.

## SCQA

- **Situation:** Local MCP is healthy and the configured tunnel previously forwarded real OpenAI requests.
- **Complication:** After the stdio child exited, Desktop tunnel restart fails at new-owner process verification with `probe_timeout`; there is no stale lock.
- **Question:** How can Windows process start-time verification remain fail-closed while avoiding false timeouts on this host?
- **Answer:** Measure the real v4.8.3 probe, reproduce with a deterministic test, replace only the unreliable process-query boundary, then package/install and validate official tunnel readiness plus a forwarded request.

## Phases

- [completed] Reproduce and identify the process-probe root cause on v4.8.3.
- [completed] Add a regression test and minimum safe fix.
- [completed] Run targeted tests, typecheck, and packaging checks.
- [completed] Back up and install the corrected package while preserving user data.
- [in_progress] Verify local MCP, tunnel doctor, health, readiness, and remote forwarding.
- [in_progress] Update Obsidian evidence, scan secrets, and commit task-owned files.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| None in this worktree yet | 0 | N/A |
| Accessibility-only NAVA state had no click geometry | 1 | Re-observe with screenshot plus accessibility before retrying the single Start Tunnel action. |
| First targeted Vitest call outlived the tool wait and left task-owned workers | 1 | Captured a second bounded run with explicit metadata; it produced the expected red test. Inspect and terminate only the first run's exact process tree. |
| Desktop tunnel-lock suite could not resolve workspace package links in the fresh worktree | 1 | MCP unit suite passed; install the frozen pnpm workspace with the bundled Node 24 runtime, then rerun both suites. |
| Combined MCP + Desktop test run hit two existing PowerShell-mutex timing deadlines | 1 | The new 10-test MCP suite passed; rerun Desktop tunnel-lock alone with one worker to distinguish host-load flakiness from a regression. |
| Combined controller/acceptance/packaging run hit host timing and missing pre-build bundle failures | 1 | Typecheck passed; run controller/acceptance in isolation and build the Desktop runtime before packaging tests. |
| electron-builder could not extract winCodeSign cache symlinks without Windows developer privilege | 1 | Build the unpacked package with `signAndEditExecutable=false`, then apply the NAVA icon and version metadata with the cached `rcedit-x64.exe`. |
| Installed package passed the self-owner probe but the external tunnel-process CIM probe timed out at 3 seconds | 1 | Keep the duplicate-process check fail-closed and widen only its Windows CIM timeout to 10 seconds. |
| Tunnel doctor split the packaged launcher at `D:/Program Files/...` | 1 | Quote the executable token inside a single-quoted YAML scalar and verify the exact profile with `doctor --explain`. |
| Launching through the Codex PowerShell environment inherited an invalid `PSModulePath` for crypto cmdlets | 1 | Relaunch the installed application through Windows Explorer so it inherits the normal desktop environment; no product secret or code workaround was added. |
| Re-running all three Desktop tunnel suites together while the installed app and tunnel were live caused 12 Windows timing failures | 1 | Keep the live service intact; rely on the earlier isolated green controller 29/29 and lock 20/20 runs, plus the current MCP 10/10 and profile 7/7 evidence. Record the combined-load result as host timing noise, not a green run. |
