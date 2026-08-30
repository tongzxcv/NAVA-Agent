# NAVA Phase Progress

## 2026-08-29 — v4.11.4 Phase 2B release / Phase 3 preparation

- Phase 2B baseline commit before release docs: `beb496f`.
- Phase 3 preparation commit: `04f6e52`.
- Windows installer packaging task: `bcf988ab-6d03-4d3c-b2b0-f7a0cc3dd417`.
- First packaging task failed because electron-builder could not create winCodeSign cache symlinks without elevated privilege; no source changes were made.
- Unsigned installer retry task: `11ffd24e-1ae3-4ac0-8680-1214f57272f4`.
- Retry completed successfully with executable sign/edit disabled for packaging; installer `nava-agent-Setup-4.11.4.exe` was produced and is intentionally unsigned.
- Installer SHA-256: `91CE8E4CFF7F7457D8DAC0F7405B29C8189695A5EFE247444B0C454FB23FE030`.
- Release validation: public-repo hygiene 8/8 passed; desktop packaging 4/4 passed; release gate 5/5 passed.
- Next phase plan: `docs/architecture/NAVA_COMMAND_ROOM_PHASE3_PLAN_TH.md`.
- Phase 3 target: v4.12.0; do not bump until implementation starts.
- GitHub release upload task: `e951bdcb-e050-4e92-8a00-c8578cce1aaf`.
- GitHub release published successfully: https://github.com/tongzxcv/NAVA-Agent/releases/tag/v4.11.4

## 2026-08-30 — Phase 3 source-only implementation started

- Work moved to `feature/command-room-phase3`; installed NAVA v4.11.4 remains the active MCP runtime.
- Hardened `NAVA_COMMAND_ROOM_PHASE3_PLAN_TH.md` with a transport-neutral boundary, narrow Extension Bridge, random installation identity, hashed one-time pairing challenges, explicit `DELIVERED / SUBMITTED / TASK_CLAIMED` separation, wake allowlist, coalescing/budget/circuit-breaker requirements, composer/SPA fail-closed checks, and a strict no-install/restart rule while v4.11.4 is in use.
- Source version metadata was synchronized to `v4.12.0`; this did not install, restart, replace, or modify the running v4.11.4 application/runtime.
- Added migration `007_command_room_bindings` with `command_room_bindings` and `command_room_wake_deliveries`, active-binding/conversation uniqueness, three-attempt wake budget, and restart lookup indexes.
- Added `SqliteCommandRoomBindingRepository` for challenge creation, hashed challenge confirmation, epoch authority, revoke/replace, idempotent wake enqueue, explicit wake delivery/submission transitions, attempt limits, dead-letter/manual fallback, and recoverable wake lookup.
- Added application `CommandRoomExtensionService` that generates raw one-time challenges only for the caller, sends only SHA-256 challenge hashes to storage, bounds pairing TTL, validates opaque installation/conversation material, and queues only allowlisted wake reasons against the exact active epoch.
- Phase 3 targeted tests currently pass: storage migration/repository + Phase 2B command-room/resource regressions = 9/9; application pairing/wake service = 4/4.
- TypeScript build checks pass for domain/storage/application and the full root `tsc --build` succeeds.
- Source guard tests also pass: public-repo hygiene 8/8, desktop packaging contract 4/4, release gate 5/5. No installer was built.
- No installer/package job has been run; no NAVA Desktop/tunnel/stdio process has been restarted; production SQLite has not been migrated.
- Next source task: add persistent wake coalescing/hourly budget/circuit-breaker state and then define the authenticated loopback Extension Bridge contract before any Desktop/extension UI work.


## 2026-08-30 — Runtime reliability hardening before Phase 3 UI

- Production-log review found the recurrent failure mode: durable workers continue, but synchronous `shell:wait` / MCP request boundaries frequently terminate the caller around 60 seconds, creating the false impression that the research job stopped.
- Added source-only `shell operation=workflow`: one durable task can own up to 32 validated sequential executable stages and persists per-stage `queued/running/completed/failed` state in `task.json`.
- Added a V056-shaped acceptance regression with six stages (`prereg`, `feature-cache`, `adapter-fit`, `july-validation`, `economic`, `parity`). A replacement backend recovers the task and observes all six stages complete without resubmission, proving the post-prereg turn-loss case is covered.
- Synchronous wait ceiling is now 10 seconds; MCP `tasks/result` waits at most 8 seconds before directing the caller back to status polling. The process/workflow deadline remains independent and can still be minutes or hours.
- `shell list` is now bounded/paged (`limit`, `offset`, optional `state`) so years of durable task history cannot overflow the MCP response. MCP Tasks pagination now delegates to that bounded surface.
- `live_logs_query` now prefers rotating persistent `mcp-activity.log(.1/.2)` evidence and supports bounded filters for `toolName`, `resultCode`, `callId`, `workspaceId`, `phase`, and `since`; in-memory activity remains the fallback.
- Tool descriptions now tell agents to submit multi-stage research/MT5/ML or uncertain >~30s work as a durable workflow/background job before the first heavy stage, rather than waiting until a five-minute threshold.
- Focused reliability verification: shell backend + MCP Tasks + upgrade runtime = 50/50 tests passed. Full capabilities + MCP-server regression = 48 files / 261 tests passed. Root TypeScript `tsc --build` passed. Release/public hygiene/desktop packaging guards = 17/17 passed.
- Full capabilities + MCP-server source regression ran as durable task `a318d067-eba2-4936-a12a-a2e298f8dc36` and passed: 48 files / 261 tests. This also proved the intended background-task verification pattern without a long synchronous wait.
- Installed v4.11.4 remains untouched. No package/install/restart/tunnel restart/production DB migration/push was performed by this reliability slice.

## 2026-08-30 — v4.12.0 installed reliability pilot

- User opened an install/restart window after confirming NAVA was idle. A consistent SQLite backup was created before migration at `E:\AI_CACHE\nava-agent-setup\20260830-024827-before-v4120.sqlite` (SHA-256 `58E0038266B5212E41AD80A19A9FD6752298CC35C410807637C2A6B7324A7D44`).
- Final v4.12.0 installer was packaged with bundled Node 24.19.0. Installer SHA-256: `3AEABBD4756EC9A05E898047E2F49DF124503814636DDC9CD5E69608744A8E21`; Authenticode status remains `NotSigned` for this development pilot.
- The historical NSIS install target resolved to `D:\Program`; that staged payload was not treated as the active runtime. The verified final `win-unpacked` payload was synchronized into the actual active directory `D:\Program Files\NAVA Agent` while Desktop/stdio/tunnel were stopped, then NAVA was restarted.
- Active payload hashes match the final build: MCP bundle `F6F94325E3EB5A3970ADB4C04ED77DD1953163E0B638C40D6A84DBFBAFAB01F6`, app.asar `23989B6EDDF4D5B12BD91C9B50ACA57F509F0FF158AA6769ED8D6BD5C0730D01`, bundled Node `3602F2BB1A10F2CBAB4C36886218A33C1AB3DB87290E73B033C46C77147D0237`.
- Startup applied migration `007_command_room_bindings`; both `command_room_bindings` and `command_room_wake_deliveries` are present. Existing Command Room data survived the migration.
- Installed-runtime probes passed: synchronous foreground work returns `RUNNING + task_id` at the 10s request budget and later completes; a two-stage durable workflow completed both stages; `live_logs_query` returned `source=persistent-mcp`.
- A real 1,413-task history exposed one remaining bottleneck: bounded `shell list` initially took ~17.7s because every historical stdout/stderr file was still loaded. Source fix `3a7ebe1` made list metadata-only; after final reinstall the same limit=2 completed-task query returned in ~580ms with no output blobs.
- Final source verification after the list optimization: root TypeScript build passed; capabilities + MCP-server regression = 48 files / 261 tests passed; release/public hygiene/desktop packaging guards = 17/17 passed.
- NAVA Desktop and the lnwjud tunnel reconnected successfully after restart. Public GitHub release/tag remains v4.11.4; this is a local v4.12.0 Phase 3/reliability pilot, not a v4.12.0 public release.

## 2026-08-30 — Phase 3 wake policy + Windows release CI hardening

- Commit `37bb73b` fixes the Windows GitHub Actions E2E teardown race: dashboard cleanup waits for `taskkill`, retries Chromium profile removal on transient locks, and the security E2E now uses an isolated `LNWJUD_DATA_PATH` instead of touching the real local profile. CI/release actions were advanced to the Node-24 generation.
- The exact three E2Es that failed in the v4.11.4 GitHub release run now pass sequentially locally: dashboard, real MCP client flow, and renderer Node-global isolation = 3/3.
- Commit `1a65fda` adds persistent wake coalescing, per-binding/per-room hourly budgets, and a circuit breaker that opens after repeated SUBMITTED wakes without a later agent heartbeat. Explicit `USER_WAKE` can bypass the circuit but still obeys hourly budgets.
- Coalescing keeps any pending QUEUED/ATTEMPTING/DELIVERED wake singular and applies the 60s cooldown to SUBMITTED wakes, preventing duplicate pending deliveries after stalls.
- Verification after both commits: TypeScript build passed; focused Phase 3/release tests 23/23 passed; application + storage + Desktop + packaging/release regression 69 files / 342 tests passed; changed-source ESLint passed.
- Public GitHub latest remains v4.11.4. This slice is prepared for the next local v4.12.0 installed pilot while Phase 3 Extension Bridge/Desktop/browser-extension work remains unfinished.

## 2026-08-30 — v4.12.0 wake-policy installed pilot

- User authorized the next upgrade window after NAVA became idle. A fresh consistent SQLite backup was created with the Node 24 `node:sqlite` backup API at `E:\AI_CACHE\nava-agent-setup\20260830-072052-before-v4120-wake-policy.sqlite` (SHA-256 `1B26022816ADD522B586A8655A012567467C946DDD5DE3FD44301DE6192B7C20`).
- Current v4.12.0 installer/package build completed as durable task `1f68b1d6-8d56-41e8-8ab1-ad26bcee3657`. Installer SHA-256: `9E9FFE2E00EF56164285B0AE11317EC7B220E9FD689CF6C2D35B7E684848E1BA`; Authenticode remains `NotSigned` for the local development pilot.
- Verified final payload was synchronized into the actual active runtime `D:\Program Files\NAVA Agent` while Desktop/stdio/tunnel were stopped. Active hashes: MCP `F6F94325E3EB5A3970ADB4C04ED77DD1953163E0B638C40D6A84DBFBAFAB01F6`, app.asar `70623EFFB5AF46FFB045AD6DA8D552E2DECE98DA543A254A75898F666B052C1A`, Node `3602F2BB1A10F2CBAB4C36886218A33C1AB3DB87290E73B033C46C77147D0237`.
- Restart validation passed: one NAVA root and one lnwjud tunnel are running; migration 007 and both binding/wake tables remain present; `NAVA EA LAB — ALL-RW` remains ACTIVE with its existing agent bindings/data intact.
- Installed-runtime reliability probes passed: a 20s foreground process returned `RUNNING + task_id` at the ~10s synchronous boundary and later completed; a two-stage durable workflow completed both stages; bounded completed-task list limit=2 returned in ~424ms; `live_logs_query` reported `source=persistent-mcp`; `search_text` resolved ripgrep successfully.
- Backend health remains ready for shell/accessibility/input/vision/window/system/notification/file-dialog/clipboard/web-fetch/audio/screen-record/office/scheduler. WSL and remote SSH remain unavailable because they are not configured/ready on this machine.
- Public GitHub release remains v4.11.4. No v4.12.0 tag/release was published; browser Extension Bridge/Desktop Pair-Wake UI/wrong-tab end-to-end gates remain the next Phase 3 implementation slice.

- 2026-08-30 v4.12.0 refresh-UI packaging task: cb1d1ea5-47dd-48e7-855d-76d0c0585a89 (durable background); install only after successful package/result gate.
- Replacement packaging task after missing corepack shim: 91033b12-b659-45a7-9bb0-6dfbcd9a26ff (Node 24 durable background).
- Installed pilot refresh completed 2026-08-30 08:53 +07. Backup: E:\AI_CACHE\nava-agent-setup\20260830-084613-before-v4120-refresh.sqlite (SHA256 F6CC5E1648853674426A1A02E8861CBC33B99BC050515AA130AB06254840F2EA). Package task 91033b12-b659-45a7-9bb0-6dfbcd9a26ff passed. Installer SHA256 F259B51D2B4DC603CB5446A0C574EA7FD46B87D0345CD458C8FEA92B4B9BF069. Active runtime is D:\Program; synced both D:\Program and D:\Program Files\NAVA Agent; post-restart MCP/tunnel health passed and active payload hashes match the build.

## 2026-08-30 — Phase 3C Windows E2E release gate recovery planned

- GitHub Actions run `33289914127` on commit `c9587dc` passes every authoritative stage before Desktop E2E, then times out in dashboard, MCP-client, and security Electron tests.
- The prior cleanup fixes did not restore CI, so no root cause is claimed yet. Highest-priority hypotheses are an unsettled owned Electron process tree between tests and external Desktop startup side effects before renderer/preload readiness.
- Frozen plan: `docs/architecture/NAVA_COMMAND_ROOM_PHASE3C_RELEASE_GATE_PLAN_TH.md`.
- Next action is diagnostic-only 3C.1: bounded phase/startup logs, owned process/port snapshots, failure artifact upload, and isolated per-file GitHub reproduction.
- Phase 3D extension implementation, public v4.12.0 release, and MCP Core changes remain blocked until repeatable GitHub E2E gates pass.

## 2026-08-30 — Phase 3C.1 local diagnostic gate

- All Electron E2Es now emit bounded phase evidence and drain both child output streams; previous tests left stdout piped but unread.
- GitHub CI will upload process/connection/temp-root snapshots and run isolated per-file E2E diagnosis only when the authoritative gate fails.
- Portable Node 24.19.0 focused ESLint passed; isolated security E2E passed 1/1 and local sequential E2E passed 3/3 in 36.9s.
- Roadmap now inserts 3C.5 Dynamic Lead Capacity, 3C.6 Session Authority, and 3C.7 Live State before Phase 3D. Add-slot creates join authority only; a real agent session still requires join/rebind and heartbeat read-back.
- GitHub runner evidence is still required before claiming the Windows E2E root cause or closing Phase 3C.

## 2026-08-30 — Phase 3C.2/3C.3 deterministic Electron startup fix

- GitHub isolated evidence from run `33292059433` disproved orphan cleanup as the primary startup blocker: dashboard and MCP-client reached DevTools/CDP in about 1–2s but never reached renderer-ready before their 90s/180s deadlines; security reached renderer-ready but missed the default 5s preload-contract poll.
- Source inspection found the renderer scheduled `getDashboard()` every second without an in-flight guard while each dashboard query could synchronously probe Codex discovery and `health.check_all` external capabilities. On a slower Windows runner, overlapping expensive refreshes could self-amplify before the first dashboard response completed.
- Renderer refresh is now coalesced to one in-flight request. Under explicit `LNWJUD_E2E_FIXTURE=1`, dashboard startup skips only external Codex/capability probes that are unrelated to the Electron/preload/MCP assertions; production behavior is unchanged. Security preload readiness keeps the real preload contract and uses a bounded 20s poll.
- Added a focused regression proving fixture capability summary returns static metadata without invoking external health probes. Supported Node 24 verification passes: root TypeScript build, changed-source ESLint, Desktop 40 files / 240 tests, acceptance 16/16, and focused fixture test 1/1.
- Local `CI=true` Electron E2E passed three consecutive full rounds = 9/9. Phase markers now reach renderer/MCP/preload readiness in about 2s and each full 3-test round finishes in about 17s.
- GitHub re-verification is the remaining gate. No installed NAVA/Tunnel process was restarted or modified by this source-only fix.


## 2026-08-30 — Phase 3C.5 Dynamic Lead Capacity implementation

- Phase 3C Windows release recovery closed: PR #1 was merged and `main` CI run `33294728864` passed the full Authoritative Release Verification gate after two consecutive green verification attempts.
- Started Phase 3C.5 from the merged `main` baseline on branch `feature/command-room-dynamic-leads`; installed NAVA/Tunnel remains untouched.
- `command_room_admin` now supports `action=add_lead` for authenticated MAIN sessions. Existing rooms expand only to the next contiguous slot and stop at `LEAD-5`; non-MAIN, stale room versions, gaps, archived rooms, and over-capacity requests fail closed.
- Storage adds the new Lead row, room-version increment, and `ADD_LEAD` admin event in one `BEGIN IMMEDIATE` transaction. Idempotent replay returns the already-created slot but never returns the raw one-time join code again. No migration is required because migration 005 already permits additional `(room_id, slot_key)` rows.
- New slots start `AVAILABLE`, `connectionEpoch=0`, with only a hashed one-time join code. No `agentSessionId` exists until a real `command_room_join` consumes the code at epoch 1.
- Desktop IPC adds a trusted `addCommandRoomLead` operation and the Command Room UI now exposes **Add Lead** for non-archived rooms below five Leads. The one-time boot prompt is shown only in transient renderer state; overview remains secret-free.
- Local source verification: root TypeScript build and ESLint passed; focused storage/broker/MCP/Desktop IPC/UI + session-resilience + release-hygiene gates = 41/41 passed. A direct unprepared root Vitest sweep also exposed only harness/precondition failures (missing packaged runtime bundles, tunnel helper contract context, and one concurrency timeout); the authoritative GitHub release workflow remains the final gate because it builds those artifacts in the required order.
