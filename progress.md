# Progress

## 2026-08-25 v4.9.0 deployment

- **Status:** authorized; release metadata and installation preflight in progress.
- Recovered the completed source-preparation plan and clean commit `388545a`; branch is one commit ahead of its `nava` remote.
- Confirmed the required isolated toolchain remains Node 24.19.0 with pnpm 10.15.0.
- Selected v4.9.0 because the prepared change adds persistent writer coordination, a diagnostic primitive, skills, and recipes rather than a v4.8.7 patch-only repair.
- Synchronized root/app/package/shared metadata and packaging assertions to v4.9.0, added release notes, and corrected the release smoke check to the existing `nava-agent-Setup-${version}.exe` artifact name.
- Lint, typecheck, 17 packaging/release/hygiene tests, and the full 19-package build passed. First packaging attempt reached electron-builder but failed only while extracting macOS symlinks in its Windows cache; no installed files were touched.


## 2026-08-25 v4.9 source preparation

- **Status:** source implementation complete and verified; intentionally not installed or activated.
- Confirmed the source branch is clean and the installed v4.8.7 runtime is active but will not be modified, restarted, packaged, or replaced.
- Loaded SCQA, persistent-planning, minimal-implementation, skill-authoring, and recovery guidance.
- Inventoried the current tool/skill/recipe surfaces and selected only two new primitive capabilities: workspace leases and a redacted diagnostic bundle.
- Logged the planning-file discovery command error and switched to an explicit read-only lookup.
- Located the central runtime/catalog, central permission dispatch, SQLite migration, and audit-redaction seams; no new package is required.
- Added migration 004 plus a SQLite/WAL workspace lease repository and cross-connection expiry/renew/release tests; initial test command was not run because the default PATH lacks Corepack.
- Storage tests pass 14/14. Initial MCP focused run passed 22/23; the sole failure was a malformed test double and was corrected before rerun.
- Lease/diagnostic/registry tests now pass 23/23. Extension discovery passes 8/8 and recipe/runtime coverage passes with the combined MCP focused total of 37/37.
- Added three repository-owned NAVA skills and five deterministic operating recipes. Skill Sync Doctor completed; structural fallback confirmed valid frontmatter, matching names/folders, descriptions, and no placeholders.
- Generated the authoritative 219-tool contract and updated the README count/catalog (213 advertised by default because six Codex delegation tools remain opt-in).
- Full verification pass 1: root lint/typecheck, Storage 14/14, and Extensions 8/8 passed. MCP behavior passed 154/157; only three expected-count assertions still said 207 and were updated to 213.
- Final verification: MCP 157/157, integration 2/2, packaging 4/4, release gate 5/5, public-repository hygiene 8/8, root lint/typecheck, all 19 package builds, and synchronized 219-tool documentation passed.
- Whole-tree secret/artifact scan completed; its findings were confined to ignored generated installers/binaries and dependency fixtures. Task-owned staged files receive the final commit-only gate.
- Live-install proof remained unchanged throughout source work: PID 8080, v4.8.7.0, EXE SHA256 `0F7FA63052212560FB03DC44DE7D5D71321FE333840C5A408BE43628B346511B`, last write `2026-08-25T00:43:22.0737005+07:00`.
- No package/install/restart/Tunnel/profile/key/live-database operation was performed; deployment remains blocked until the user says ready.


## 2026-08-25 Desktop updater EPIPE

- Confirmed repeated dialogs are the same updater-triggered `write EPIPE` incident, not the previous large-response Tunnel fault.
- Selected TDD scope: one safe-write/logger public seam, preserve stdio peer-close behavior, then installed updater live check.
- Scoped restart through Windows Explorer did not stop the dialogs; proceeding with a reversible updater-schedule mitigation before the permanent build.
- Backed up the database, persisted temporary `update_auto_check=false` and `update_check_on_startup=false`, relaunched NAVA, and observed no new EPIPE record after the startup window.
- RED: the new GUI output-guard test failed because the public guard module did not exist. GREEN: three focused cases now pass for EPIPE, ECONNRESET, and an unexpected error.
- Wired the guard only into GUI/log-viewer modes and disabled electron-updater's default console logger; stdio startup remains on its existing transport-specific handler.
- Released source metadata/docs as v4.8.7. Desktop passes 231/231, packaging metadata 4/4, root lint/typecheck, and all 19 package builds.
- Installed hash-matched v4.8.7 EXE/ASAR after backing up v4.8.6 at `E:\AI_CACHE\nava-agent-setup\20260825-004407-v4.8.6-before-v4.8.7-epipe-fix`.
- Restored automatic update defaults, observed the startup check complete with no new crash record, restarted the Tunnel from the NAVA UI, and verified remote MCP health plus workspace discovery.
- Staged-only secret/artifact guard passed for 31 intentional source, test, version, documentation, and planning files; no generated runtime, log, database, screenshot, installer, or credential file is staged.


## 2026-08-24 Secure Tunnel response-budget hardening

- Confirmed the source worktree is clean at pushed commit `80e6937` before this task.
- Correlated the user-visible `ExceptionGroup` with HTTP 413 `request_body_too_large`, stdio child exit, and shared Tunnel shutdown at 19:17:53.
- Confirmed the triggering CSV is 14,786,001 bytes while the Tunnel limit is 10,485,760 bytes.
- Defined the minimal patch: one central MCP response budget with no new dependency, scheduler, or duplicated file-size policy.
- RED confirmed through the real MCP stdio client/server path: a 6 MiB file value (duplicated by MCP text + structured content) closes the connection before a follow-up request.
- GREEN: the central 8 MiB serialized-response guard returns `RESPONSE_TOO_LARGE` and the same stdio process completes the next request.
- Strengthened the fixture to the exact production file size, 14,786,001 bytes; stdio integration and tool-specific recovery guidance pass 6/6 focused tests.
- Released source metadata as NAVA v4.8.6 and documented `RESPONSE_TOO_LARGE` recovery in README and the Thai quick-start guide.
- Full lint, typecheck, and all 19 package builds pass. MCP server passes 153/153, packaging 4/4, and focused Desktop compatibility tests 20/20.
- Backed up installed v4.8.5 to `E:\AI_CACHE\nava-agent-setup\20260824-202700-v4.8.5-before-v4.8.6`, installed hash-verified v4.8.6 runtime artifacts, and relaunched NAVA with the Tunnel connected.
- Live Secure Tunnel regression passed: exact 14.1 MiB read returned bounded `RESPONSE_TOO_LARGE`; the next workspace call plus normal shell/accessibility calls succeeded without `ExceptionGroup` or a Tunnel restart.
- Staged-only artifact/secret guard passed for all 35 intentional source, test, documentation, and planning files; generated installers, ASAR files, logs, databases, and Runtime API key material are not staged.


## 2026-08-24 multi-chat workspace isolation

- Recovered the exact incident from the installed NAVA activity log without modifying runtime state.
- Re-ran the underlying ripgrep enumeration directly; the current tree enumerates 6,099 paths successfully.
- Verified current NAVA `search_files` and indexed `workspace_full_scan` against registered BEELZEBUB EA Lab.
- Confirmed the source worktree is clean at commit `7d33888` before starting this update.
- Selected a minimal TDD scope: partial search diagnostics, absolute full-scan workspace resolution, and concurrent different-workspace reads.
- RED: targeted Vitest produced exactly three expected failures; the separate-workspace concurrency test passed before implementation.
- GREEN slice 1: partial and fatal ripgrep behavior now passes 8/8 adapter tests with bounded actionable diagnostics.
- GREEN slice 2: absolute full scan now selects only the longest containing workspace; combined targeted tests pass 14/14.
- Targeted TypeScript checks pass for `@lnwjud/search` and `@lnwjud/mcp-server` after rebuilding the changed domain package.
- RED root-cause test confirmed an absolute BEELZEBUB path was reduced to the containing `D:\` machine root before ripgrep execution.
- GREEN root-cause slice: SearchService now passes the bounded requested directory to ripgrep and preserves both configured and canonical workspace roots; focused behavior tests pass 19/19.
- Package suites pass: application 62/62, search 14/14, and MCP server 148/148. Root TypeScript build passes.
- Synchronized source/package metadata and user documentation to NAVA v4.8.5.
- Full lint, root typecheck, and all 19-package builds pass with the isolated Node 24 toolchain.
- Desktop focused suites pass 24/24; packaging metadata passes 4/4; public repository hygiene passes 8/8.
- Installed v4.8.5 over a byte-verified 86-file rollback backup and confirmed all six copied runtime artifacts by SHA256.
- Live verification exposed a PowerShell module-autoload failure while decrypting the existing Runtime API key; added RED tests for legacy and v2 secret formats, then implemented direct-DPAPI protection/migration without a new dependency.
- Shared tests pass 15/15 and the full Desktop suite passes 228/228, including the new Runtime-secret regression.
- Re-ran lint, typecheck, and the full 19-package build successfully with Node 24.
- Reinstalled the final app over a second exact rollback backup at `E:\AI_CACHE\nava-agent-setup\20260824-143500-v4.8.5-before-dpapi-fix`.
- Secure Tunnel now starts from the UI; health is `200 live`, readiness is `200 ready`, local MCP listens at `127.0.0.1:18765`, and the UI reports connected from this app.
- Final live parallel test completed Autobots search, BEELZEBUB search, and BEELZEBUB absolute full scan successfully; the activity log records overlapping starts and only `SUCCESS` completions.


## 2026-08-23 title-bar icon follow-up

- Cancelled the previously scheduled Windows shutdown with `shutdown.exe /a`.
- Confirmed from the supplied screenshot that only the small title-bar icon remains visually stale; the NAVA label and version are already current.
- Switched the main and standalone Live Logs title bars from the legacy favicon to the existing NAVA icon and added focused regression assertions.
- Targeted tests passed: public repository hygiene 8/8 and Live Logs layout 7/7.
- Built the renderer, installed the generated `app.asar` after preserving the previous artifact at `E:\AI_CACHE\nava-agent-setup\20260823-030500-before-titlebar-icon-fix\app.asar`, and relaunched NAVA.
- Visually verified the running v4.8.4 title bar now displays the cyan NAVA `N` icon.
- Restarted Secure Tunnel and verified the installed app reports it connected from this NAVA instance.

## 2026-08-23 PDF contrast follow-up

- Inspected the reported PDF screenshot and traced the unreadable commands to the missing `pre code` CSS override.
- Added one scoped `pre code` override; normal inline-code styling remains unchanged.
- Regenerated the 4-page PDF with print backgrounds enabled and visually checked the affected Codex section.
- Replaced both `C:\Users\Endlessly\Desktop\คู่มือ NAVA Agent.pdf` and `D:\Program Files\NAVA Agent\คู่มือ NAVA Agent.pdf`; their SHA256 hashes match the generated source.

## 2026-08-23

- Started the NAVA v4.8.4 usability/account-migration update with a fresh SCQA brief and acceptance gates.
- Verified current official Secure MCP Tunnel requirements and organization/workspace association behavior.
- Generated UI guidance and selected only the applicable accessible dark-dashboard/form rules; no visual redesign or new package is planned.
- Added the native expandable account-migration workflow, safe key-replacement feedback, visible-brand cleanup, NAVA update metadata, v4.8.4 version sync, and the Thai quick-start source guide.
- Account migration UI tests passed 2/2; focused i18n/settings/profile tests passed 13/13; packaging metadata tests passed 4/4; public repository hygiene passed 8/8 after intentionally tracking the ignored docs file.
- Built and installed NAVA v4.8.4 over the preserved v4.8.3 installation backup at `E:\AI_CACHE\nava-agent-setup\20260823-021027-v4.8.3-before-v4.8.4`.
- Verified the installed executable metadata and SHA256 `788E13067C526314BE9DBE688112C98BC5E90EA8DC23759C3CFB49F28C052399`.
- Verified the live UI shows `v4.8.4`, `MCP Gateway ออนไลน์`, `Agent พร้อมทำงาน`, and the non-error message for an unpublished GitHub Release.
- Verified `ตั้งค่า > Secure Tunnel` shows the DPAPI-protected stored-key state, replacement field, Setup Wizard, and account-migration checklist without exposing the existing key.
- Started the real Secure Tunnel and verified `healthz=200 live`, `readyz=200 ready`, and `Tunnel เชื่อมต่อแล้ว (จากแอพนี้)`.
- Generated and visually checked `C:\Users\Endlessly\Desktop\คู่มือ NAVA Agent.pdf`; copied the same PDF into the installed application directory.
- Updated the NAVA Obsidian runbook/status/troubleshooting pages. The vault linter completed with only pre-existing index heuristic notices.
- Lock-sensitive suites passed serially after stopping the live runtime: tunnel lock 20/20, controller 29/29, session resilience 9/9, persistence 5/5.

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
- Audited the broader quota objective after the Work-surface pass. Official OpenAI guidance says custom MCP apps are used by selecting them in a new ChatGPT chat; it does not promise unlimited usage.
- Switched a fresh conversation to `Chat`, opened the Add menu, found NAVA Agent, and selected it. The UI remained in `Chat` with a NAVA Agent composer pill. The final read-only send is pending fresh user confirmation.
- After explicit confirmation, submitted the read-only `workspace_list` prompt while `Chat` remained checked and NAVA Agent remained attached.
- The regular Chat conversation `ตรวจสอบ Workspace` returned all four expected workspaces in a couple of seconds and has no `Work` badge.
- Correlated the Chat response with a new tunnel forwarded-command event at `2026-08-23T01:15:34.2819305+07:00`. Chat-surface/web-quota fallback passed, with ordinary Chat plan limits still applicable.
# 2026-08-25 NAVA v4.9.0 deployment

- Synchronized all source/package metadata and release notes to v4.9.0.
- Passed lint, typecheck, release/packaging/public-hygiene checks, and the complete 19-package build.
- Packaged `nava-agent-Setup-4.9.0.exe` after preparing an isolated Windows Electron Builder cache; preserved the optional missing Windows OCR warning without treating it as a release failure.
- Backed up the complete v4.8.7 install, application data, Tunnel profile, and database before copying the hash-verified v4.9.0 unpacked runtime into `D:\Program Files\NAVA Agent`.
- Relaunched only NAVA-owned processes and verified the installed v4.9.0 GUI, local MCP listener, 213 advertised tools, all six new tools, bounded diagnostics, and preserved workspace state.
- Started the real Secure Tunnel and verified its owner lock, control-plane metadata, installed stdio MCP process, `200 live`, `200 ready`, and connected state in the NAVA UI.
- Staged exactly 28 task-owned release/documentation files; the staged gate found zero large blobs, artifact paths, or secret-pattern paths and `git diff --check` passed.
- Deployment gates are complete; commit/push and post-push clean-state verification are the final recorded operations.
