# NAVA Command Room Phase 1 findings

## Frozen scope from the accepted design

- Implement only the local manual broker, core persistence, fixed eight MCP tools, feature flag, bundled skill, and focused tests.
- Main is read-only by default; Lead slots are reusable; browser wake-up and Desktop room UI are later phases.
- Existing `workspace_leases` remains the only file-writer lock. Phase 1 does not implement shared MT5/VPS resource execution.
- Manual normal chats and Project chats use the same room identity; ChatGPT Project membership is optional display metadata.
- Installed NAVA remains untouched during source implementation and tests.
- Live Git verification starts from clean source commit `b841893`; only the three Phase 1 planning files are currently modified.
- Planning catch-up reported no unsynchronized prior-session work.
- Prior NAVA continuity evidence requires bounded/redacted state, atomic persistence, verificationRequired on resume, and installed-runtime proof only if a later deployment is explicitly authorized.
- The implementation must directly address the observed invalid wrapper pattern by keeping schemas stable and actionable.

## Implemented and verified result

- Migration `005_command_room_core`, the SQLite repository, and one application broker now persist rooms, hashed one-time joins/sessions, immutable messages, receipts/cursors, optimistic read-only tasks, presence, and admin lifecycle state.
- The exact eight `command_room_*` tools are hidden by default and add exactly eight entries only when `command_room_enabled=true`; default 221/227 Doctor and catalog counts are unchanged.
- CLI stdio and Desktop HTTP runtimes share the same local SQLite broker. No Command Room UI or installed-runtime deployment was added.
- Schema-bound invalid input reports the offending field without echoing values. Broker payloads are bounded and do not accept raw prompts, credentials, cookies, API keys, private keys, or unbounded tool output.
- Chat-full takeover now covers LEAD and MAIN slots: rebind revokes the old session, advances the required connection epoch, and issues a new one-time code.
- The bundled `nava-command-room` skill documents MAIN/LEAD boot, inbox acknowledgement, read-only task flow, leased checkpoint wrapping, takeover, parking, and Phase 1 non-goals.
- Verification passed: official skill validation, skill sync audit, router index rebuild, root typecheck/lint, affected package tests, Desktop tests, synchronized default tool catalog, CLI build, and Node 24 Desktop production build.
- Repository-wide artifact scanning found only pre-existing/ignored build, installer, image, and example candidates; no task-owned changed path is among them and none will be staged.

## Verified storage seam

- `@lnwjud/storage` uses Node `DatabaseSync`, WAL, a 5-second busy timeout, foreign keys, pre-migration backup, and transactional additive migrations 001–004 in `database.ts`.
- Repository style is a concrete SQLite class returning the shared `Result` contract; Phase 1 should add one concrete command-room repository, not a one-implementation interface or dependency.
- Migration 005 belongs in the existing constructor flow, the repository should be exported from `src/index.ts`, and integration tests should follow the temporary-database/reopen pattern.
- The current storage package has no command-room files; the first tracer test can be added without touching UI/runtime installation.

## Verified MCP and feature-flag seam

- `ToolRegistry` owns the advertised tool array and already gates Codex tools through a boolean option; Command Room can follow this exact additive pattern with `commandRoomEnabled === true`.
- Runtime settings are persisted through `USER_SETTING_KEYS`; `DEFAULT_CODEX_TOOLS_ENABLED = false` proves the disabled-by-default convention. Add one command-room key/default and thread it through CLI/Desktop runtime options, without adding environment-only behavior.
- `createStdioMcpRuntime` already owns the one SQLite database and constructs services; it is the correct place to construct one shared repository/broker and expose it through `McpApplicationServices`.
- Current doctor minimum is 221 tools when Codex delegation is disabled and 227 when enabled. Phase 1 must preserve those counts when Command Room is off and add exactly eight when on.
- Registry tests already validate gated tool sets, public schemas, permissions, activity, lease enforcement, and automatic checkpoints; Phase 1 should extend those public tests rather than bypassing the registry.

## Frozen Phase 1 public shape

- Keep the accepted six core tables in migration 005: rooms, agents, immutable messages, receipts/cursors, tasks, and task events. Add only the credential hashes/creation idempotency fields required for safe manual join and replay.
- Application owns one `CommandRoomBroker` over a narrow repository port; storage owns one concrete SQLite implementation; MCP depends only on the broker public methods.
- Manual identity uses one-time slot join codes stored only as hashes and opaque agent-session IDs stored only as hashes. Raw prompts, credentials, cookies, API keys, and large output are never accepted.
- Inbox uses explicit `read` and `ack` actions, limit at most 50, immutable messages, delivery receipts, and a monotonic per-agent cursor.
- Phase 1 task mutations are read-only work only. Assign/claim/start/wait/submit/approve/reject/fail/cancel use optimistic task versions and idempotency keys; filesystem writer/resource scheduling stays Phase 2.
- `command_room_resource` is present but status-only and explicitly reports manual Phase 1. `command_room_admin` covers create/pause/resume/archive/rebind; browser binding/wake stays unavailable.
- Every broker response carries `manifestVersion`, `roomVersion`, and `serverTime`; summaries and task payloads are bounded before persistence.
- Repository-owned bundled skills live under `.agents/skills`; `nava-command-room` will be scaffolded with the required skill-creator script and validated structurally.

## Questions for source inspection

- Which package should own the minimal public repository and broker interfaces without introducing a one-implementation abstraction?
- Where is the default tool list assembled, and what existing flag pattern can hide all eight tools without changing disabled counts?
- Which result/error helpers and permission classifications should room state transitions reuse?
- Where do current bundled skills live and how are they packaged/tested?
- What is the smallest public integration test that proves persistence and ToolRegistry behavior end to end?

---

# NAVA Command Room design findings

## Initial runtime observations

- Installed/source target is NAVA v4.11.0 at commit `fedb194`; the repository was clean before this design task.
- NAVA currently reports 13 registered workspaces. The important independent EA roots include Autobots, BEELZEBUB EA Lab, GREED, RATCHET EA_Lab, THANATOS, plus separate MT5/tester-data roots.
- One live writer lease belongs to BEELZEBUB; no design inspection touched that workspace or lease.
- The managed runtime task list is currently empty. The session-history call returned no checkpoints in its unfiltered default response, so persisted continuity must not be assumed from that call alone.
- The public `agent_swarm_run` entry is catalogued as planned rather than implemented.
- The Command Room design task holds a short lease on the registered Local Disk C workspace only to coordinate repository documentation writes.

## Source inventory observations

- `packages/storage` already separates SQLite database access into workspace, writer-lease, encrypted checkpoint, settings, audit, and backup repositories. There is no room, participant, message, inbox cursor, orchestration task, or shared-resource repository yet.
- Existing migrations stop at initial/settings/workspaces, audit, and checkpoints. Command Room state should therefore use additive migrations and dedicated repositories rather than extending the generic settings blob.
- `UpgradeRuntimeService` persists bounded tasks/delegates/checkpoints and can produce collision-aware parallel plans, but it is not an Agent executor or chat broker.
- `agent_swarm_run` is explicitly `availability: planned`; presenting it as a working swarm would be incorrect.
- The Desktop renderer already has reusable navigation, dashboard, work-log, live-log, project, settings, and IPC patterns suitable for a Command Room page.
- No current Chrome extension, conversation-ID bridge, caller-attribution contract, or worker wake-up path exists in this repository.
- `codex_run` exists as an optional local Codex CLI delegate. It should remain opt-in because it uses Codex resources rather than ChatGPT chat quota.

## Persistence and runtime contract observations

- SQLite runs in WAL mode with a 5-second busy timeout, foreign keys enabled, transactional migrations, and a pre-migration backup. This is suitable for a local room broker with several concurrent readers and short writes.
- Migration `004_workspace_leases` enforces one active lease row per workspace. Command Room should reuse it for file mutation ownership rather than invent another writer lock.
- Existing `checkpoints` SQLite rows are file checkpoint metadata. Session continuity is separately bounded to 128 entries and persisted atomically in the runtime/continuity JSON state.
- Existing runtime tasks/delegates contain ID, kind, digest, state, and optional result, but do not encode room, agent, assignment, dependency, heartbeat, delivery acknowledgement, or a provider execution handle.
- `parallel_delegate` currently returns a deterministic plan only. It detects possible writes by payload text and does not schedule or execute agents.
- Room, participant, message, task, inbox cursor, and resource-allocation data should be durable SQLite tables under additive migrations beginning after `004`; runtime JSON remains appropriate only for backward-compatible session continuity/WSE state.
- The existing workspace lease repository already returns actionable owner/expiry conflicts and deletes expired leases transactionally; Command Room messages should surface those conflicts rather than bypass them.
- Live closure testing proved that session_checkpoint with a leased workspace is rejected unless it is invoked through workspace_lease_call using the owning lease. The Command Room skill/contract must carry this lease context automatically.

## Desktop/UI and IPC observations

- The renderer uses a typed screen union and reusable AppShell/page patterns. Command Room can be added as one first-class Desktop page without creating a second application.
- Main-process IPC already validates workspace, dashboard, settings, process, MCP, Tunnel, Doctor, log, and update calls; Command Room should follow the same typed preload and handler boundary.
- The preload exposes a validated `window.lnwjud` API. Room operations should be added through this boundary rather than exposing SQLite or browser-control primitives directly to the renderer.
- Existing Projects, Work Log, Live Logs, and Control Center views can provide workspace selection, audit evidence, health state, and bounded diagnostics to a new room dashboard.
- No current provider conversation identity, extension pairing, exact-tab wake-up, or per-chat caller attribution was found. Sensitive join/wake operations therefore require a new fail-closed identity bridge.
- The first aggregate query over rotated activity JSONL returned zero records despite known live activity. This is treated as a query defect, not evidence of no usage; the next pass will inspect only bounded field names/timestamps and aggregate counts.

## Bounded 48-hour usage evidence

- The two rotated activity files contain 10,725 distinct calls in the 48-hour UTC window, with 10,724 completions and one started call without a matching completion at query time.
- 10,326 completions were `SUCCESS` (96.3%); 398 were non-success (3.7%). This is active multi-session production-like use, not an occasional single-chat workload.
- Highest-volume completed tools were `shell` 4,785, `workspace_lease_call` 1,474, `tool_batch` 1,107, `session_checkpoint` 674, `write_file` 323, and `read_file` 258.
- Continuity is materially used: 674 checkpoint completions and 124 resume completions. Command Room must integrate these contracts instead of replacing them.
- The strongest correctable client-contract signal is `workspace_lease_call / INVALID_INPUT` at 60 events. Typed assignment/write envelopes and UI-generated calls should remove most hand-authored wrapper mistakes.
- Other common non-success groups were `search_text / SEARCH_FAILED` 60, `shell / PERMISSION_REQUIRED` 55, `accessibility / INTERNAL_ERROR` 26, and `dom_cdp / PERMISSION_REQUIRED` 18.
- `shell` p95 was about 40.3 seconds, while `tool_batch` p95 was about 17.0 seconds. Room heartbeat and stalled-agent thresholds must tolerate legitimate long calls and use durable task state rather than aggressive retries.
- Peak observed hourly throughput was 729 completed calls. The broker therefore needs bounded inbox reads, acknowledgements, idempotency, WAL-friendly short transactions, backpressure, and dead-letter handling.
- This aggregation used only call ID, tool name, phase, result code, duration, and timestamp. It did not read prompts, arguments, outputs, paths, credentials, or chat content.

## Documentation and migration seams

- Existing architecture documentation is under `docs/architecture`; there is no current ADR directory or numbering convention, so this task should add a small `docs/adr` index plus ADR 0001.
- Storage migrations are explicit and end at `004_workspace_leases`. Command Room can start with `005_command_room_core` and keep each later capability additive.
- The current worktree contains only the three task planning files changed by this inspection. No source/runtime/user project file is dirty from this task.
- Desktop has one central renderer screen union, main IPC registration block, and preload bridge. The implementation plan can name these seams exactly and avoid speculative application restructuring.

## Exact contract and repository constraints

- The typed IPC contract lives in `packages/ipc-contracts/src/index.ts`; Command Room contracts belong there, with parsers in preload/main and application services behind IPC.
- Existing `UserSettings` holds global operational preferences. Small global defaults such as maximum active Leads may extend it, but durable rooms, agents, tasks, messages, receipts, and resource ownership must not.
- Existing `WorkLogEntry`, `InFlightWorkItem`, Tunnel health, and push-channel patterns provide reusable bounded status shapes. Room-specific events need their own push channel and cursor rather than reusing unbounded Live Logs.
- New design and ADR files are ignored by the repository's allowlist-style `.gitignore`. They must be intentionally force-staged or explicitly allowlisted; no unrelated ignored docs should be added.
- Durable shell/WSL tasks are already exposed through MCP Tasks read/result/cancel/list, but task creation still begins through tools and clients poll. Command Room should reference durable task IDs instead of cloning process output into messages.

## User-specific operating decision

- Use one durable room with Main plus five reusable slots, not one room per project and not five permanently named project agents.
- Normal operation activates three Leads: two writers on different workspaces and one read-only research/review Lead. Two slots remain sleeping for a new project, independent review, or chat-full replacement.
- Main is read-only by default and mediates assignment/result traffic; direct Lead-to-Lead delivery is disabled to prevent loops and unclear ownership.
- File collisions remain governed only by existing workspace leases. Separate expiring resource leases govern MT5 terminal paths, project-level CPU-heavy capacity, VPS mutation, managed-browser input, and GPU-heavy work.
- ChatGPT Project membership is display metadata, not identity or routing. A normal chat and a Project chat join the same room contract.
- Manual join/inbox mode is the reliable first release. Optional Chrome extension pairing provides exact-chat wake-up but is not task storage or permission authority.
- Eight fixed MCP tools balance context size with typed contracts; INVALID_INPUT responses must include expectedShape and manifestVersion.
- Codex participation is opt-in and visibly labeled because it consumes Codex resources; NAVA never substitutes quota automatically.

## Architecture review findings

- The design follows the current package boundaries: domain types, application services, storage repositories, MCP transport, typed IPC, and renderer page. It does not require a second executable, framework, database, or cloud service.
- The eight-tool surface is additive and keeps primitive tools available. Room coordination never becomes a proxy that bypasses existing tool validation or permission policy.
- Manual mode is deliberately first because it proves the broker, continuity, and collision model without depending on fragile browser DOM automation.
- Chrome pairing is deferred, encrypted, opt-in, visible, and fail-closed. It can fail without losing room/task/checkpoint state.
- The plan reuses workspace lease 004 as the only writer lock and adds resource leases only for non-file shared resources, avoiding overlapping lock systems.
- The default 3 active / 2 writers / 2 heavy tasks is a policy value, not hard-coded project behavior, and matches the observed EA/MT5/VPS workload.
- Feature flags, phased gates, backup-before-migration, and installed-runtime verification preserve current NAVA settings, workspaces, Tunnel profile, and running project work.
- The design is intentionally larger than an MVP document, but implementation is sliced so Phase 1 remains a small local broker/manual workflow; extension and extra providers are not prerequisites.

## Resolved design questions

- Storage ownership: dedicated repositories in packages/storage under additive migrations 005–007; generic settings stores only small global defaults.
- Reuse boundary: existing session continuity, MCP Tasks, ActivityTracker/audit, Desktop Live Logs, workspace authority, and workspace lease remain sources of truth and are referenced rather than copied.
- Chat identity: room slot identity uses one-time join, agentSessionId, and connectionEpoch; optional extension pairing strengthens exact conversation binding but never grants filesystem authority.
- Wake boundary: manual notification/copy prompt works without extension; exact event wake and replace-chat assistance require the optional extension.
- Concurrency: five reusable slots, three active Leads, two writers on different workspaces, two cross-project heavy jobs, and explicit capacity leases for MT5/VPS/browser/GPU.

---

# 2026-08-25 NAVA EA forensics and ML capability

- Active source is `C:\Users\Endlessly\NAVA-Tunnel-Fix` on `fix/nava-tunnel-probe-timeout` at `a1002a5`; existing custom work includes WSE and secure SSH.
- Current NAVA already has broad generic primitives, so the new EA feature should orchestrate them instead of wrapping duplicate file/search/shell/Git functions.
- The durable EA knowledge base already requires evidence-first promotion, calibrated money units, isolated research, and no profitability claim without native backtest/forward evidence.
- Initial capability split: source logic extraction, behavior/black-box inference, and ML evidence audit. Each output must separate observation, inference, confidence, contradiction, and unknown.
- Deployment is intentionally deferred so the later upstream update can be merged with this feature without overwriting NAVA-specific WSE/SSH work.
- Both supplied links are live external-Chrome tab mentions (`source=extension`), not stale in-app-browser references. Exact extension-instance, provider-tab, title, and URL matching succeeded without navigation or reload.
- Autobots V0.31 demonstrates the required research contract: keep Live unchanged, freeze discovery, preregister each candidate, reject weak candidates, then start a fresh shadow/forward sample with explicit 30/50/100-case review gates before any promotion.
- BEELZEBUB demonstrates the required change-forensics contract: declare an explicit UI-only scope, preserve trade-critical functions, prove input/session equivalence, compile cleanly, package new presets when identifiers change, and label native tester/runtime evidence as pending when it was not run.
- The two chats are active on separate projects. Their evidence should remain project-scoped; no result, threshold, preset, or readiness verdict transfers between Autobots and BEELZEBUB.
- Repository metadata is NAVA `4.10.1`; current acceptance catalog expects 226 configurable tools and 220 advertised by default.
- The repo currently bundles three NAVA workflow skills: account switching, incident diagnosis, and multi-chat coordination. No EA-specific bundled skill exists.
- No EA-specific MCP tool is present. Existing filesystem/search/shell/Git/WSE primitives already cover acquisition and execution; the missing value is deterministic EA evidence extraction and domain orchestration.
- NAVA already discovers `%USERPROFILE%\.agents\skills` globally and exposes those files through `skills_list`/`skills_read`, independent of the active EA workspace.
- A global EA-forensics skill can therefore become usable immediately without changing the MCP protocol or increasing the tool catalog. This is the smallest path and avoids duplicating generic read/search/shell/Git tools.
- Existing recipe coverage already includes seven-terminal MT5 validation and Obsidian project updates; the new skill should route into those capabilities instead of building another runner.
- Existing `ea-research-lab` already owns hypothesis matrices, calibrated MT5 runs, evidence gates, artifact storage, and promote/reject verdicts. It does not cover logic reconstruction or ML dataset/model validity.
- Global search found no dedicated reverse-engineering, black-box EA, data-leakage, feature-provenance, or walk-forward ML skill.
- The clean split is two skills rather than one catch-all: `ea-forensics` for white/gray/black-box logic reconstruction, and `ea-ml-research` for datasets/features/models/walk-forward evidence.
- Live NAVA `skills_list` confirms both `.agents\skills` and `.claude\skills` are enabled. Current EA skills are duplicated across those roots, so the new skills must be synchronized to avoid provider drift.
- No extra NAVA runtime tool is required for discovery or execution: `skills_list`, `skills_read`, shell/search/file/Git tools, the seven-terminal recipe, and Obsidian recipe already form the execution surface.
- Both new skill folders pass the equivalent frontmatter/name/reference validation. The official validator's checks were reproduced exactly except YAML parsing uses the simple one-line frontmatter contract already supported by NAVA.
- Neither new skill name existed in any shared root before installation, so synchronization will not overwrite user content.
- On this machine, writing the E-drive Codex skill root also materializes the same skill and hashes under `C:\Users\Endlessly\.codex\skills`; treat those two paths as mirrored storage even though the root metadata does not expose a simple link target.
- Skill routing index rebuilt successfully with 230 skills. `ea-forensics` and `ea-ml-research` both score 83 for their intended queries and are returned as relevant matches.
- Live installed NAVA discovers both skills from Claude and Agents roots without restart. `skills_read` successfully returns the main forensics instructions and the ML validation reference.
- The EA knowledge base lives inside the very dirty parent `D:\EA` Git worktree. `wiki/index.md` and `wiki/log.md` already contain substantial unrelated unstaged edits, so any KB commit must stage only the new concept page and exact task-owned hunks.
- KB lint does not flag the new concept page. It reports eight pre-existing index candidates in other project/NAVA pages; these are non-blocking and outside this task.
- All three files in each skill match SHA256 across all five configured skill roots. Task-scoped secret/artifact scans returned no candidates or secret patterns.
- The Thai guide is intentionally under the repository's ignored `docs/*` tree, so it must be force-staged explicitly like prior intentional NAVA documentation; no other ignored file should be added.
- The Obsidian concept page was committed separately, then exact index/log additions were staged through the Git index without including 603 lines of unrelated existing user edits.
- No NAVA executable, MCP catalog, Tunnel configuration, workspace, EA source, MT5 runtime, or installed application file changed in this task.

---

# NAVA secure SSH findings

- Repository starts clean on `fix/nava-tunnel-probe-timeout`, tracking `nava/fix/nava-tunnel-probe-timeout`.
- Previous diagnosis proved local OpenSSH tools exist and the VPS exposes TCP 22; the failure path was RDP GUI launch/control, not reachability.
- Native `ssh`, `scp`, and `sftp` are the smallest reliable implementation and avoid GUI automation.
- The SSH capability must accept only a private-key path or the user's existing SSH agent/config; passwords and key contents stay outside MCP requests.
- `%USERPROFILE%\.ssh` currently contains `known_hosts` but no `config`, and no SSH agent is running. The runtime can be installed now, but authenticated live VPS access still needs one OpenSSH profile plus a key or agent supplied by the user.
- Reuse `ShellCapabilityBackend` as the process runner so SSH inherits bounded output, timeout, cancellation, background tasks, and durable task recovery.
- Use one `remote_ssh` MCP tool with an OpenSSH Host alias. `ssh.exe` handles status/test/run and `scp.exe` handles upload/download; local file paths remain inside registered capability roots.
- Commands use executable plus argv and an explicit `posix` or `powershell` remote shell. NAVA will not accept passwords, private-key contents, or a host-key bypass.
- Packaged and installed v4.10.1 advertises 220 default MCP tools, including `remote_ssh`; a live `status` request reports native OpenSSH ready with strict host-key checking.
- The complete v4.10.0 installation, user data, and Tunnel profile are backed up at `E:\AI_CACHE\nava-agent-setup\20260825-162300-v4.10.0-before-v4.10.1-ssh`.
- The updated Thai PDF has readable dark text and high-contrast command blocks; identical verified bytes are installed on the Desktop and in the NAVA application directory.
- Secure Tunnel started after a delayed UI response: both `/healthz` and `/readyz` return HTTP 200, so local Codex MCP and ChatGPT Web Tunnel paths are healthy.

---

# Findings

## 2026-08-25 WSE evidence and human promotion

- Scope is limited to the previously proposed WSE sequence: real metrics, bounded Experience, deterministic evaluation, offline strategy scoring, and explicit human promotion.
- Provider/model selection is intentionally excluded; ChatGPT Free can select GPT-5.6 Luna at the client layer and NAVA remains model-agnostic for this release.
- Current known baseline: context economy/dedup is real and bounded, while live-log/benchmark/regression surfaces need verification because earlier inspection found empty or preview/static behavior.
- Source verification confirms `live_logs_query` always returns an empty array, `telemetry_dashboard` hard-codes all activity counters to zero, `benchmark_run` returns only a command preview, and `regression_report` returns a static scenario list.
- `UpgradeRuntimeService` already has one bounded JSON runtime-state persistence seam and a deterministic search/ranking catalog, so WSE can remain additive without a new package or separate database subsystem.
- `ActivityTracker`, the audit repository, and Desktop service composition already capture real MCP lifecycle evidence; WSE should consume a bounded summary at this existing seam rather than duplicate raw logging.
- The current context-economy implementation must remain content-free in persistence; WSE records should store only classifications, durations, outcome codes, hashes/IDs, and bounded counters.
- The current public ActivityTracker interface exposes only in-flight calls and a revision; adding one bounded recent-event reader is sufficient to power real Live Logs, telemetry, and explicit Experience capture.
- `UpgradeRuntimeService` is instantiated once per ToolRegistry and already persists bounded session/task/worktree state to the configured runtime-state path. WSE state can use that file without a new migration or dependency.
- Promoted strategy behavior will be limited to deterministic tool-search ranking adjustments; permissions, destructive confirmation, context visibility, and direct tool availability remain unchanged.
- The existing `tool_search`/`tool_dynamic_filter` path has one deterministic `scoreToolEntry` seam. A promoted profile can add a small evidence-derived tie-breaker there while leaving the semantic base score and all permission metadata intact.
- Three intentionally fixed profiles are sufficient: `baseline`, `reliability-first`, and `latency-first`. Arbitrary user-supplied weights are excluded to avoid turning WSE into an unbounded policy/config system.
- Benchmark snapshots can reuse the same deterministic Experience evaluation; regression should compare the newest two persisted snapshots and otherwise report `insufficient_evidence` instead of claiming no regressions.
- WSE adds six public tools at phase 47: capture/list/evaluate, score/status, and promote-or-rollback. Existing benchmark/regression tools are upgraded in place rather than duplicated.
- Installed v4.10.0 advertises 219 default tools and exposes all six WSE tools through the real local MCP endpoint.
- Secure Tunnel startup is healthy at `127.0.0.1:8080`: `/healthz` returns `200 live`, `/readyz` returns `200 ready`, metadata resolves to `NAVA Web Fallback`, and the installed stdio child is running.
- The promoted WSE profile remains `baseline` after installation. No automatic promotion, provider selection, permission expansion, or destructive-operation change is active.


## 2026-08-25 v4.9.0 deployment

- The prepared source is clean at commit `388545a`; only the release metadata/planning commit remains before packaging.
- Installed v4.8.7 was previously proven at PID 8080 with EXE SHA256 `0F7FA63052212560FB03DC44DE7D5D71321FE333840C5A408BE43628B346511B` and must be backed up before replacement.
- `scripts/set-version.mjs` is the repository's existing single source of truth for root/app/package versions, shared constants, packaging assertions, and README release references.
- Packaging and installation must preserve the existing `%APPDATA%\tunnel-client` profile/key and the application SQLite database; these are state, not release artifacts.
- `electron-builder.yml` has long produced `nava-agent-Setup-${version}.exe`, while `scripts/verify-release.ps1` still expected the legacy `lnwjud-Setup-*` name; the smoke gate must use the real artifact name.
- The first v4.9.0 packaging attempt built the complete app and `win-unpacked` tree, then failed because electron-builder's bundled 7-Zip used `-snld` on two Darwin library symlinks inside `winCodeSign-2.6.0`; this is a Windows privilege/cache extraction issue, not a source or compile failure.


## 2026-08-25 v4.9 source preparation

- Installed NAVA is v4.8.7 and must remain running and unchanged during this task.
- The v4.8.7 baseline advertised 213 configurable tools (207 by default). This source-only change adds six tools, producing 219 configurable tools with 213 advertised by default because six Codex delegation tools remain opt-in.
- Existing global skill roots already contain EA, MT5, Obsidian, Git hygiene, diagnosis, retry, and release-related guidance; new skills must be NAVA-specific orchestration rather than copies.
- Tool additions are justified only for enforceable state or evidence collection that existing prompt guidance cannot guarantee.
- Workspace leases should permit shared reads, serialize conflicting mutations, persist across MCP runtime replacement, and reclaim only leases with expired heartbeats.
- Diagnostic collection must be read-only, bounded, and use the existing audit redactor rather than introduce another secret filter.
- Account switching, safe publish, release preparation, MT5 preparation, Obsidian updates, and Tunnel verification should reuse existing tools through skills/recipes rather than add primitive capabilities.
- Upgrade tools are generated from `UPGRADE_TOOL_CATALOG` and executed through one `UpgradeRuntimeService`; this is the smallest existing seam for new discoverable tools and recipes.
- `ToolRegistry` centrally knows each tool's permission and receives raw input plus trace context, making it the correct seam to reject a mutation that conflicts with an active workspace lease.
- Current trace context contains request trace IDs but no guaranteed stable chat/client identity; lease ownership therefore needs an explicit caller-supplied `owner` and opaque `leaseId`, while backward-compatible writes remain allowed only when no active conflicting lease exists.
- SQLite already uses WAL, a 5-second busy timeout, migration backups, and numbered migrations. A lease migration/repository can reuse that persistence safely without a new dependency.
- Existing `Redactor` recursively removes credential-like keys and bearer/secret text and should be reused by diagnostic output.
- Stale lease cleanup occurs only in writer operations; `workspace_lease_status`, mutation checks, and diagnostic collection remain physically read-only while ignoring expired rows.


## 2026-08-25 Desktop updater EPIPE

- Crash diagnostics recorded `main-uncaught-exception` / `write EPIPE` at `2026-08-24T17:27:19.852Z` for installed v4.8.6.
- The native dialog stack ends in `console.info` called by `NsisUpdater.checkForUpdates`; this is updater logging, not an MCP tool failure.
- The Desktop main process started at 20:27 local time with parent PID 26428, and that parent no longer exists. The inherited output pipe can therefore reject later writes.
- Desktop mode has no stdout/stderr error handler. The existing handler is installed only by `bootstrapMcpStdio`, so it does not protect the packaged GUI updater.
- The updater uses the dependency's default console logger. A safe updater logger plus Desktop stream error guards is the smallest complete fix.
- Secure Tunnel health and `workspace_list` still succeed while the native error dialog is visible; no data corruption is indicated.
- Relaunch through a confirmed `explorer.exe` parent still generated repeated EPIPE crash records, falsifying the launcher-only hypothesis. The packaged Desktop must not depend on console streams at all.
- The minimal permanent change is two-layered: disable electron-updater's default console logger and absorb only `EPIPE`/`ECONNRESET` on GUI stdout/stderr. Unexpected output errors still throw, and MCP stdio keeps its existing peer-close shutdown path.
- Installed v4.8.7 completed the automatic startup update check and displayed the unpublished-release status without increasing the crash log beyond 19 prior v4.8.6 events.
- After the scoped GUI restart, the Tunnel required one explicit start. The UI then reported `Tunnel เชื่อมต่อแล้ว (จากแอพนี้)`, and remote MCP health/workspace discovery succeeded.


## 2026-08-24 Secure Tunnel response-budget hardening

- Production incident: `read_file` returned `D:\EA\Autobots\research\V031_ENTRY_EDGE_PHASE1_SCANS_FULL.csv` (14,786,001 bytes / 14.1 MiB) through Secure Tunnel.
- The control plane rejected the response with HTTP 413 because the Tunnel request/response limit is 10,485,760 bytes.
- Immediately afterward, tunnel-client failed to read another MCP response, the shared stdio command exited, and unrelated `shell`/`accessibility` calls surfaced `ExceptionGroup`.
- Local NAVA remained healthy; after Tunnel restart, `shell`, `read_file`, and accessibility status all succeeded. This isolates the fault to oversized Tunnel response handling, not tool implementations or workspace permissions.
- The required fix belongs at the shared MCP response boundary so every tool and both transports receive the same protection.
- The repository already caps paged reads and shell output inputs at 8 MiB, but whole `read_file` can still return up to the filesystem reader's larger limit; there is no proven aggregate guard at stdio serialization yet.
- Relevant seams are `packages/mcp-server/src/stdio.ts`, `server.ts`, `tool-registry.ts`, `result-mapper.ts`, and the application/filesystem file readers.
- Every MCP tool result passes through one public handler in `createMcpServer`; enforcing the serialized budget there protects stdio and HTTP without modifying 200+ individual tools.
- `mapResult` includes values in both text content and `structuredContent`, so a 4–5 MiB value can serialize above the 10 MiB wire limit. The guard must measure the complete `CallToolResult`, not source file size alone.
- Minimal design after inspection: one central 8 MiB serialized-response guard with tool-specific recovery text. A separate early file-size policy would duplicate this logic and could block legitimate local/non-MCP trusted reads, so it is intentionally skipped.
- The installed v4.8.6 runtime reproduced the exact 14,786,001-byte read through Secure Tunnel as a 131-character `RESPONSE_TOO_LARGE` error; the next `workspace_list`, bounded `shell`, and accessibility status calls all succeeded through the same connector.


## 2026-08-24 multi-chat workspace isolation

- The reported failure is present in `mcp-activity.log`: `search_files` failed after 2.673 seconds and `workspace_full_scan` failed immediately for the BEELZEBUB absolute path.
- No other NAVA tool call overlapped the failed `search_files` interval. The next Autobots call started 7 ms after it completed.
- BEELZEBUB was not a registered project workspace at failure time; it was registered about 46 minutes later.
- Current live calls using the registered BEELZEBUB workspace ID succeed: bounded `search_files` returns paths and indexed `workspace_full_scan` reports 5,999 files.
- `RipgrepAdapter` discards stdout whenever ripgrep exits above 1 and maps the result to generic `INTERNAL_ERROR`; `result-mapper.ts` further hides the internal message as `Operation failed`.
- `workspace_full_scan` resolves workspace IDs first but does not map an absolute requested path to the longest containing registered workspace.
- Existing MCP serving already tracks multiple in-flight calls and has no global all-tool mutex. The minimum fix belongs in search/result handling and context path resolution, not in a new scheduler.
- Root cause: `SearchService` used an absolute path only to choose the containing workspace, then always passed the workspace root to ripgrep. Before BEELZEBUB was registered, `D:\EA\BEELZEBUB EA_Lab` therefore caused a scan of all `D:\`.
- The first packaged v4.8.5 runtime exposed a second independent issue: legacy Runtime-key decryption depended on auto-loading `Microsoft.PowerShell.Security`, which failed inside the installed Electron process.
- Windows `ConvertFrom-SecureString` legacy output is a hexadecimal CurrentUser DPAPI blob containing UTF-16 text. It can be migrated safely with direct `ProtectedData.Unprotect` and does not require the PowerShell Security module.
- New Runtime-key writes now use the existing direct DPAPI v2 format; existing legacy ciphertext remains readable and the plaintext key is never logged or rewritten during startup.
- Final live evidence: the UI reports v4.8.5, local MCP online, and `Tunnel เชื่อมต่อแล้ว (จากแอพนี้)`; `/healthz` and `/readyz` both return HTTP 200.
- Final concurrent Autobots and BEELZEBUB reads completed successfully, and the absolute BEELZEBUB full scan selected exactly one workspace with 5,999 indexed files.


## 2026-08-23 title-bar icon follow-up

- The user screenshot shows the NAVA name and v4.8.4 badge are correct, but the small title-bar icon is still the old gold legacy mark.
- The shutdown scheduled after the PDF fix was cancelled before repository or installation work resumed.
- Both custom title bars referenced the legacy `favicon.ico`; the current NAVA artwork already exists as `public/nava-icon.png`, so no new asset or dependency is needed.
- Live visual verification shows the title-bar mark is now the cyan NAVA `N` icon; the NAVA Agent name and v4.8.4 badge remain correct.
- The installed `app.asar` matches the newly built artifact SHA256 `D402BB9AFC43FF89A9FFF19C3150251355BCD6A3832EAB11B1BF83854092D130`.
- After relaunch, local MCP remained online and Secure Tunnel returned to `Tunnel เชื่อมต่อแล้ว (จากแอพนี้)`.

## 2026-08-23 PDF contrast follow-up

- The screenshot proves fenced code blocks render a dark `pre` background while the nested `code` element keeps the light inline-code background and inherited white text.
- The smallest correct fix is a specific `pre code` rule with transparent background and inherited foreground color; inline code outside fenced blocks should remain unchanged.
- The regenerated PDF is a valid 4-page PDF (152,203 bytes). Both installed copies match SHA256 `7E68D823D342B8421B171E9C26CC4A64F6185890D0E2B0D7A7BE2B26E1ED97E0`.
- Visual QA of the rendered source confirms the affected Codex command blocks now use a uniform dark background with readable light text.

# 2026-08-25 NAVA v4.9.0 guide refresh

- The installed Desktop guide is still the four-page v4.8.7 PDF from 2026-08-23, while the installed application is v4.9.0.
- The repository source of truth is `docs/NAVA_QUICK_START_TH.md`; its frontmatter, title, and workflow currently omit workspace leases and `diagnostic_bundle_create`.
- `docs/nava-guide.css` already contains the verified `pre code` override that keeps command text light on a dark background; retain this stylesheet unchanged unless visual QA finds a new defect.
- Edge created the local candidate PDF asynchronously after the launcher returned; the candidate is 203,315 bytes. NAVA's optional PDF provider is unavailable for this E: artifact, so validation must use local rendering.
- Edge accessibility confirms the candidate contains six pages and exposes the v4.9.0 title, lease guidance, diagnostics, recovery steps, and final paths as text. The first screenshot was obscured by extension welcome tabs from the isolated QA profile, not by PDF content.
- The visible first PDF page behind Edge's account-sync prompt already confirms the title, Thai body text, gold/teal headings, warning box, table, and dark command block render with readable contrast. The prompt itself must not be automated.
- Guest-mode visual QA passed all six pages. Thai text, tables, inline code, warning blocks, dark command blocks, URLs, v4.9.0 multi-chat guidance, account migration, troubleshooting, and final paths are visible without clipping or white-on-white text.
- The candidate, Desktop copy, and installed copy are valid `%PDF-` files with identical SHA256 `213DCA4F53A8806ACC132CF5EC3AD545F2726AB702E949E7ACB32AC74887F145`.

# 2026-08-25 NAVA v4.9.0 deployment

- The verified source release contains 219 configurable tools; 213 are advertised by default and the six Codex delegation tools remain opt-in.
- Windows packaging succeeds with an isolated reusable Electron Builder cache; the installer SHA256 is `7D9ADD572401ED962958554995DCF771B10BD63DB6EA91CF976A897AE39F960B`.
- The full v4.8.7 application, user data, Tunnel profile, and SQLite database were backed up under `E:\AI_CACHE\nava-agent-setup\20260825-022515-v4.8.7-before-v4.9.0` before replacement.
- The installed executable reports v4.9.0 and matches the packaged SHA256 `EB3220A792724B6FA17727A59748425C2D33BC97A5A0B19156F2B6B51CB64736`; installed `app.asar` matches `23851FF2405FB81C70C7FDD4CFED07F50EF8712213B02187724655A1BEFD76A0`.
- A real HTTP MCP SDK session discovered 213 advertised tools and successfully called the bounded read-only `diagnostic_bundle_create` tool at version 4.9.0 with zero reported issues; all six new lease/diagnostic tools were present.
- NAVA reclaimed the stale v4.8.7 Tunnel lock safely. The current lock identifies the v4.9.0 Electron PID, the Tunnel fetched metadata for `NAVA Web Fallback`, and its stdio MCP child is running from the installed application.
- Tunnel `/healthz` returns `200 live`, `/readyz` returns `200 ready`, and the NAVA accessibility tree reports `Tunnel เชื่อมต่อแล้ว (จากแอพนี้)` with eight registered workspaces.

## 2026-08-23 v4.8.4 update

- Official Secure MCP Tunnel guidance requires a `tunnel_id`, a Runtime API key, and local MCP reachability.
- Platform tunnel permissions and ChatGPT developer-mode access are separate.
- A tunnel may be associated with multiple Platform organizations or ChatGPT workspaces while retaining the same `tunnel_id`; a new account in a different organization/workspace may require adding that association or creating a new tunnel/key.
- The Runtime API key authenticates `tunnel-client` to the OpenAI control plane, so NAVA must let the owner replace it without exposing the stored value.
- UI direction: preserve the existing OLED dark dashboard, add explicit labels and visible focus states, and avoid a modal so keyboard focus management remains simple.
- Release target is a minimal v4.8.4 patch with no new runtime dependency.
- The backend already allowed encrypted key replacement; the defect was misleading `save once` copy, no restart guidance, and no account/workspace migration checklist.
- User-visible legacy strings also remained in the connection fallback, manifest, log labels, startup/quit preferences, and live-log titlebars. Internal package/profile filenames remain unchanged for compatibility.
- The upstream v4.8.3 README had already moved to 213 configurable tools, while one package description and two tests still expected 212; v4.8.4 synchronizes those metadata assertions.
- A missing `releases.atom` for the new NAVA GitHub repository is an unpublished-release state, not an application failure; v4.8.4 reports it as available-for-use without a warning badge.
- The packaged account migration UI is runtime-verified and keeps the stored key write-only from the renderer's perspective.

## Confirmed

- Base: `origin/main@0092c70`, package v4.8.3.
- Installed process: `D:\Program Files\NAVA Agent\NAVA Agent.exe`, metadata v4.8.3.0.
- Local MCP listener is alive at `127.0.0.1:18765`.
- Tunnel profile and DPAPI runtime secret exist; no plaintext key pattern was found in YAML.
- Historical tunnel log proves successful metadata fetch, stdio startup, and forwarded commands.
- Last tunnel stop followed stdio EOF/Windows exit `0x40010004`.
- Current Desktop restart fails with `Could not verify this process for the tunnel lock: probe_timeout` while no lock file exists.
- v4.8.3 already uses `Get-Process -Id`, 1.75 second timeout, and two attempts. Safety is fail-closed.
- Current UI observation now reports `Tunnel หยุดอยู่` rather than the earlier retained error; the Start Tunnel button is enabled and no lock file exists.
- Ten live PID probes completed in 0.86-1.25 s with Windows PowerShell and 0.35-0.46 s with pwsh; the timeout is intermittent/load-sensitive and did not reproduce while the machine was idle.
- A fresh UI Start Tunnel action reproduced the exact `Could not verify this process for the tunnel lock: probe_timeout` failure, so the feedback loop is valid.
- Secure Tunnel changes transport only; it does not create free or unlimited ChatGPT/Codex/API usage.
- The fix widens only current-process ownership probes to 5 seconds x 2; ordinary existing-owner probes retain the 1.75 seconds x 2 fail-closed budget.
- The lock safety suite passes 20/20 when isolated to one worker; existing duplicate-owner, stale-owner, unverifiable-owner, and release-race protections remain intact.
- The first installed build removed the original self-owner `probe_timeout`, then exposed a separate fail-closed 3-second CIM timeout while checking for an already-running profile process.
- The external process check remains fail-closed; its host-load budget is widened to 10 seconds so a slow negative result does not falsely block startup.
- Polling CIM every four seconds caused measurable PowerShell/WMI contention. NAVA now uses native `tasklist.exe` first and invokes CIM only when a `tunnel-client.exe` candidate exists.
- Tunnel-client parses the YAML `command` value as a command line. A YAML-quoted path is insufficient when it contains spaces; the executable token itself must retain quotes.
- Installed NAVA v4.8.3 now owns one tunnel-client process and a valid tunnel lock; `/healthz` returns `200 live` and `/readyz` returns `200 ready`.
- Fresh tunnel startup fetched metadata for `NAVA Web Fallback` and started `"D:/Program Files/NAVA Agent/lnwjud-mcp-stdio.cmd"` successfully.
- NAVA UI reports `Tunnel เชื่อมต่อแล้ว (จากแอปนี้)`; local MCP remains available at `127.0.0.1:18765`.
- ChatGPT Web Work conversation has `NAVA Agent` attached and completed a fresh read-only `workspace_list` request in 6 seconds.
- ChatGPT Web returned exactly four workspaces: `Local Disk C:`, `Local Disk D:`, `Local Disk E:`, and `THANATOS`.
- The tunnel log recorded a fresh `dispatcher forwarded command to MCP server` event at `2026-08-23T01:07:26.6132244+07:00`, proving the ChatGPT Web -> OpenAI Tunnel -> local NAVA MCP route.
- The successful 01:07 request ran in the ChatGPT `Work` surface, so it proves transport but not the user's separate Chat/web-quota fallback requirement.
- A new ChatGPT conversation can switch to the `Chat` surface, whose Add menu lists `NAVA Agent — Local Windows Agent via Secure MCP Tunnel`.
- Selecting `NAVA Agent` keeps the `Chat` radio checked and adds a NAVA selection pill to the composer; Chat-surface attachment is supported on this account.
- The approved Chat-surface prompt completed in a couple of seconds and returned the expected four workspaces: `Local Disk C:`, `Local Disk D:`, `Local Disk E:`, and `THANATOS`.
- The resulting conversation `ตรวจสอบ Workspace` has no `Work` badge, and the tunnel log recorded a fresh forwarded event at `2026-08-23T01:15:34.2819305+07:00`.
- Official OpenAI guidance states that Codex and ChatGPT Work share the agentic usage/credit pool, while regular Chat is a separate experience and regular Chat usage is not included in Codex usage reporting. Therefore this verified Chat-surface route is the intended fallback when the Codex/Work pool is unavailable, subject to the user's normal Chat limits.
- Neither NAVA nor Secure MCP Tunnel provides free or unlimited model usage; Chat plan limits, fair-use controls, and app availability still apply.
- Installed NAVA v4.8.4 EXE SHA256 is `788E13067C526314BE9DBE688112C98BC5E90EA8DC23759C3CFB49F28C052399`.
- NAVA v4.8.4 installer SHA256 is `8627E7194B92C6D64748920096F0F2F5E1C5557A5426AAC3A08C80EB8C1F5A4A`.
- The installed runtime and real Tunnel passed before the lock suite; lock-sensitive tests must run with NAVA stopped because production and test fixtures intentionally share the same machine-wide mutex.

## Constraints

- Preserve existing DPAPI secret, YAML profile, SQLite settings, registered workspaces, full-access profile, and rollback path.
- Do not print or commit credentials.
- Do not weaken ownership checks or reclaim an unverifiable live owner.
- The fresh ChatGPT Web tool call and matching forwarded-command log entry satisfy the final end-to-end gate.
- The separate Chat/web-quota fallback is runtime-proven by the checked Chat surface, attached NAVA pill, valid four-workspace response, and matching fresh forwarded log event.
# 2026-08-26 Rolling continuity checkpoint findings

- NAVA already has two distinct checkpoint concepts: encrypted file rollback checkpoints and lightweight development-session checkpoints. The requested feature belongs to the latter and must not overload file rollback.
- `session_checkpoint` currently persists only `id`, `createdAt`, a shortened summary, and an input digest in the shared runtime JSON. `session_resume` returns the same global list without project selection.
- `session_handoff` is evidence-backed but depends on a repository file (`docs/PHASE_PROGRESS.md`) and is described as a near-end action, so it cannot solve a chat that fills unexpectedly.
- MCP SDK 2.0 exposes server `instructions`; ChatGPT-compatible clients can receive a concise rolling-checkpoint policy at connection initialization.
- Existing writer leases already solve same-workspace mutation collisions. Continuity should reference that skill instead of introducing another lock.
- The minimum viable design is backward-compatible structured project checkpoints plus server instructions and one skill. No new MCP tool or package is needed.
- The installed v4.10.2 runtime proves the state is durable rather than process memory: checkpoint ID `0e223440-66e0-4352-bace-bdbe32d11c5d` survived replacement of both `tunnel-client.exe` and `lnwjud-node.exe`.
- A replacement chat needs only a stable project key. The runtime returns `recovered=true` and `verificationRequired=true`; the skill then requires Git/workspace/Obsidian verification before mutation.

---

# 2026-08-27 Continuity writer-lease discovery findings

- `nava-multi-chat-coordinator` was tracked only inside the NAVA repository and
  absent from all five shared skill roots, while `nava-continuity` required it.
- The installed NAVA v4.10.2 MCP endpoint advertises
  `workspace_lease_status`, `workspace_lease_acquire`,
  `workspace_lease_renew`, `workspace_lease_call`, and
  `workspace_lease_release`; the runtime capability was not missing.
- The smallest durable repair is global skill synchronization plus a direct-tool
  fallback in `nava-continuity`; no runtime rebuild is required.
- Both skill entrypoints pass the official quick validator. All five roots match
  their repository source by SHA-256, and the sync doctor reports no drift.
- The live NAVA MCP process lists the coordinator from both Claude and Agents
  roots and reads the updated continuity fallback through `skills_read`.

---

# 2026-08-27 Lease-call schema recovery findings

- The screenshot event is reproducible in the activity log: eight
  `workspace_lease_call` requests at `2026-08-27T02:16:10Z` failed schema
  validation in 0-1 ms, while later calls at 02:19-02:20Z succeeded.
- Redacted target summaries prove callers tried malformed outer fields such as
  `operation: "shell"` or `name: "shell"`; one corrected wrapper then failed
  because the child arguments omitted `workspaceId` before later calls passed.
- Live NAVA v4.10.2 advertises exactly 220 tools, which matches the source and
  integration-test default. The lease, skill, session, log, and diagnostic tools
  are present; reports of missing tools are chat/connector discovery state, not a
  missing installed runtime capability.
- The current generic Zod boundary discards issue paths and returns only
  `Tool input is invalid`, preventing a model from correcting the malformed call
  without trial-and-error retries.
- An external chat currently owns the `BEELZEBUB EA Lab` writer lease as
  `BEELZEBUB-R82`; source work is safe, but the installed runtime must not be
  restarted until that lease is released or expires.
- The external lease cleared before installation. The controlled restart preserved the unrelated durable Vite worker (`lnwjud-node.exe` PID 45676).
- Installed runtime/UI now reports v4.10.3. MCP initialize advertises 220 default tools and includes exact lease-wrapper plus connector-refresh guidance.
- A malformed live `workspace_lease_call` now names `leaseId`, missing `tool`, and unknown `operation`, does not echo the supplied value, and does not poison the session; `workspace_list` succeeds immediately afterward.
- NAVA Doctor passes the new required `mcp-tools` check with `220 MCP tools advertised; lease/session/skill tools ready`.
- The real Secure Tunnel is live and ready after a Desktop-owned start. Runtime state, registered workspaces, DPAPI secret, YAML profile, and the active durable worker were preserved.
- Rollback snapshot is `E:\AI_CACHE\nava-agent-setup\20260827-094750-v4.10.2-before-v4.10.3-schema-recovery`; installed `app.asar` SHA-256 is `DC65D130AFA7FAF86C796D2993B4894D778553E8BCAF2DE939D58D028D1F3801`.

---

# 2026-08-27 Multi-project handoff resilience findings

- RATCHET is registered as workspace `4e3179bb-748d-45eb-9764-f777919edf96` and is the selected Desktop workspace; the earlier diagnosis that it was unregistered was incorrect.
- The activity log is global and interleaves concurrent chats. The two observed `session_handoff` failures explicitly targeted BEELZEBUB workspace `c7fda5af-6e3e-4045-a7c0-51bc98bbc9cb`; neighboring RATCHET and AUTOBOTS shell calls do not prove cross-workspace routing.
- Tracker layouts differ: AUTOBOTS uses `docs/PHASE_PROGRESS.md`, RATCHET uses root `PHASE_PROGRESS.md`, and BEELZEBUB currently has neither.
- `session_handoff` currently reads only `docs/PHASE_PROGRESS.md` unless a caller supplies `trackerPath`, and returns `FILE_NOT_FOUND` before it can use Git, durable tasks, or persisted rolling checkpoints.
- NAVA can safely label activity by registered workspace because calls already carry `workspaceId`; a true ChatGPT conversation label is unavailable unless the client supplies one.
- Existing session-tool tests exercise the public tool definition and can cover fallback behavior without exposing private helpers.
- The minimum tracker behavior is explicit-path strictness, then automatic `docs/PHASE_PROGRESS.md` -> root `PHASE_PROGRESS.md` fallback only when `trackerPath` is omitted. Explicit caller paths must not silently redirect.
- Desktop MCP activity already receives `workspaceId`; the remaining question is where to resolve a bounded display label once without adding lookup work to every renderer refresh.
- Rolling checkpoints live in `UpgradeRuntimeService`, while `session_handoff` is a separate core tool. Reusing checkpoint data requires exposing a narrow read port or passing the existing upgrade service into the session-tool context; duplicating persistence reads is rejected.
- Activity events are emitted by the MCP `ActivityTracker` before Desktop audit/log sinks. Workspace labels should therefore be attached centrally at begin-time through an optional resolver, preserving the existing raw `workspaceId` and avoiding renderer-only inference.
- `UpgradeRuntimeService` is already the single continuity persistence boundary and can be reused read-only by `session_handoff`; no second checkpoint parser or state store is needed.
- A safe fallback must select only checkpoints whose persisted `workspaceId` equals the handoff workspace. It must not surface another project's checkpoint when global logs/checkpoint history are interleaved.
- ActivityTracker's `begin` path is already asynchronous, so an optional bounded workspace-label resolver can enrich both started and completed records without changing tool execution semantics. The implementation should cache registered names to avoid a SQLite lookup per event.
- `session_context` returns the persisted checkpoint array after `UpgradeRuntimeService.loadState()`, so handoff can select the latest matching `workspaceId` without adding a new public tool or reading JSON directly.
- Live Logs currently derive their visible MCP text from parsed log records. Persisting `workspaceLabel` alone is insufficient; the parser/IPC correlation must carry it and the renderer should prefix a compact `[workspace]` label.
- The smallest durable Live Logs change is to persist `workspaceLabel` in each activity event and have the existing `formatWorkLogLine` prepend it. This avoids new renderer components or filters and leaves the raw `workspaceId` available for exact diagnostics.
- Explicit tracker paths should remain strict; only omitted `trackerPath` enables automatic layout discovery. This preserves caller intent and path-boundary errors.
- Desktop runtime construction is synchronous, so workspace-name lookup cannot be preloaded with an await. An optional async resolver on `ActivityTracker.begin` is the clean existing seam; a small in-memory cache in Desktop avoids repeated repository reads and can populate lazily for newly registered workspaces.
- The activity file is the canonical source tailed by Live Logs. Adding `workspaceLabel` to the NDJSON event and prefixing it in `parseMcpActivityLine` keeps historical logs attributable after restart without changing renderer contracts.
- Existing `LogHub` tests already tail real MCP NDJSON under fake timers, providing a public observable seam for `[workspace]` label rendering.
- No new IPC field is required for the first release: the label can remain part of the MCP log text while exact `workspaceId` remains in the underlying NDJSON/audit record.

---
## 2026-08-27 Connector evidence while preparing source update

- The installed NAVA process and tunnel-client are currently present. Recent local activity includes successful MCP calls, so the source changes below are not being hot-installed into the active runtime.
- Historical tunnel evidence contains transient DNS/connection failures and HTTP 502 `client_internal` upstream failures; the reported `UNKNOWN / ExceptionGroup` is therefore a transport/upstream incident, not evidence that a particular EA workspace is wrong.
- The source repository does not contain the remote tunnel-client implementation or the Python `ExceptionGroup` stack, so that external transport failure cannot be fixed from this NAVA source tree without a live connector/runtime update.
- The prepared source fix improves recovery after a chat rollover and makes project attribution explicit in MCP activity/Live Logs; it does not claim to repair the currently running tunnel until installed and monitored later.

---

## 2026-08-27 Installed verification after final handoff fix

- A large BEELZEBUB handoff previously exceeded the response budget because it returned the full dirty Git status. The installed runtime now caps `changed_files` and `git_status` at 200 entries and reports exact totals/truncation warnings; the live handoff completed successfully with `git_status_total=18767`.
- Direct STDIO activity now resolves the registered workspace display name once per event path, so the canonical NDJSON log records both `workspaceId` and `workspaceLabel`; a live `session_handoff` recorded `workspaceLabel=BEELZEBUB EA Lab` for both start and completion.
- Final source verification passed: focused runtime/session/activity/log tests 34/34, TypeScript build, and changed-file ESLint.
- The final packaged artifacts were installed by hash comparison into `D:\Program Files\NAVA Agent`; the installed stdio bundle hash is `07F332755BE7238DA0DABA33F30880288969248A3920863C7A16E8AED54500F1`.
- Final live checks passed after restart: Tunnel `/healthz=200`, `/readyz=200`, NAVA health available for shell/accessibility/vision and other local backends, workspace discovery returned 12 entries, and Live Logs reported healthy MCP/tunnel/process sources with correlation IDs.
- WSL and remote SSH remain unavailable for their own environmental reasons (`wsl_status_failed`, remote backend not configured); they are not NAVA transport failures.
- The historical external Tunnel-client `502 client_internal` / Python `ExceptionGroup` remains outside this source repository. Current local and connector checks pass, but this deployment does not prove a permanent control-plane repair.
# 2026-08-28 NAVA v4.11 reliability five-part update

## Source verification

- Continuity currently matches project keys by lowercase only; workspace display names and IDs are not aliases, so a new chat can miss a checkpoint when the caller changes spacing or uses a workspace ID.
- The tool router exposes a broad catalog but its primitive search surface omits session and lease controls; a connector can therefore report an incomplete tool surface without a stable recovery path.
- `mcp_health` currently reports generic local availability and does not distinguish the local MCP child from the tunnel control plane or connector schema freshness.
- The persistent activity sink appends indefinitely; the in-memory tracker is bounded but the file used by Live Logs is not rotated.
- Tunnel status has only one lifecycle message and the existing incident health probe is local-only; the dashboard needs a bounded layered diagnosis that cannot claim remote control-plane proof.
- The current writer lease API is present and must remain the mutation seam for all source edits. No EA/MT5 path is in scope.

- Verified current repo `C:\Users\Endlessly\NAVA-Tunnel-Fix` is clean at `0fef288` (`fix: bound handoffs and label stdio activity`).
- NAVA checkpoint `nava-agent` recovered successfully from `d4be4473-3420-4234-aa48-78a27746ffaa`; verification is required before mutation. Workspace root is registered as `C:` with ID `2ed35b8c-bacb-4b38-af53-0a24c7acb360`.
- No active lease existed; acquired task lease `8f2377fe-8668-4675-bb85-880a362e0cd2` for the five-part update.
- `checkpointProjectKey()` and stored-key matching currently lowercase only; `BEELZEBUB EA` and `beelzebub-ea` can fail to match.
- `ToolRegistry` registers the full catalog in one `tools/list`; current integration/E2E tests assert 220 advertised tools, while generated contract text has drifted to 226 and must be reconciled by the actual build.
- `server.ts` already has an 8 MiB transport guard and continuation hints for some tools, but it rejects oversized results after execution; activity file sink is append-only with no rotation/retention.
- `tunnel-controller.ts` probes local `/healthz` and restarts on child exit; this does not distinguish a live local process from a stale remote control plane or connector schema.
- Exact lease tools are present and direct acquire/release succeeds in the current connector; the historical missing-capability symptom is discovery/manifest state, not absence of the lease implementation.
- Planned implementation must reuse existing Zod/tool registry, permission, lease, activity, and tunnel seams; no new dependency is justified yet.

## 2026-08-28 v4.11 verification and deployment

- Implemented all five reliability improvements through existing runtime seams: automatic project-key-aware checkpoints, essential-tool/manifest discovery, layered tunnel health, bounded rotating activity logs, and read-only workspace authority visibility.
- Source checks passed: `typecheck`, `lint`, production `build`, generated tool-catalog synchronization, 49 focused tests, 18 integration/acceptance tests, and 17 packaging/release tests.
- The runtime contract is now v4.11.0 with 227 configurable tools and 221 advertised by default; `workspace_authority` is available in the advertised set.
- Standard signed NSIS packaging could not extract electron-builder's winCodeSign archive because this Windows account lacks symbolic-link privilege. A temporary unsigned-config package completed successfully and was used for local installation; no source config for unsigned packaging was retained.
- Installed v4.11.0 hashes match the package for the executable, `resources/app.asar`, MCP stdio bundle, and bundled Node runtime. Existing NAVA data and Tunnel profile were backed up and preserved.
- A real local HTTP MCP client connected to the installed app, listed 221 tools, called `mcp_health`, and called `workspace_authority` (12 registered workspaces). Tunnel `/healthz` and `/readyz` both returned HTTP 200 after restart.
- The local child cannot prove the external ChatGPT connector/control-plane state; v4.11 reports those layers as `unknown` with `verificationRequired=true` rather than falsely claiming end-to-end health. The final check in ChatGPT still requires connector refresh and one real `workspace_list` call.

# 2026-08-29 Command Room Phase 1.5 initial findings

- The latest continuity checkpoint `0693f45b-2421-4c13-b83e-fa8bc6cf1e08` matches the current source repository and installed Phase 1 deployment record.
- Git is clean on `fix/nava-tunnel-probe-timeout` and is 14 commits ahead of its configured remote tracking branch.
- The installed runtime previously proved 229 local MCP tools and all eight command-room tools, but this already-open Codex connector schema exposes no `command_room_*` wrapper. Direct MCP sessions are therefore the correct local acceptance seam; ChatGPT still needs connector refresh/new-chat proof afterward.
- The current source workspace had no competing writer lease. Lease `1c7a5ebd-d320-42c4-aaaf-9ff45773ff84` is owned by this Phase 1.5 task.
- Phase 2 is gated on two-client messaging, deterministic coordination, persistence, and owned restart recovery; UI work before those proofs would hide backend defects.

- Command Room implementation is already vertically sliced across domain, application broker, SQLite repository/migration, MCP tools, and CLI runtime integration tests. The shortest Phase 1.5 path is to exercise the installed MCP contract; no new framework or service is justified.
- Existing integration coverage already creates a room, joins Main/Lead identities, sends a message, and reads the inbox. Phase 1.5 should extend evidence to independent transport sessions, concurrency, and restart persistence instead of duplicating unit behavior.

- The MCP contract already supports exactly the requested topology: `command_room_admin.create` accepts `leadSlots` from 1 to 5, so Main 1 + Project Lead 5 needs no backend topology expansion.
- Room creation returns one-time join codes; each joined slot receives an opaque `agentSessionId`. Acceptance must keep those values only in process memory and never write them to planning files or logs.
- The contract blocks direct Lead-to-Lead messages, caps inbox reads at 50, uses idempotency keys, and exposes explicit task versions. These existing guards should be tested rather than relaxed.
- Existing ToolRegistry coverage proves one-process behavior only. The missing evidence is two independent Streamable HTTP sessions plus SQLite persistence/restart recovery.

- Current runtime task list is empty, so no durable background task blocks non-restart acceptance work.
- Workspace authority shows an unrelated active BEELZEBUB writer `chatgpt-beelzebub-ready136` until 2026-08-28T20:35:37Z. NAVA restart/persistence testing is therefore deferred until that lease clears; the acceptance flow must not interrupt it.
- Local MCP remains available. Remote control-plane and connector-schema states remain explicitly `unknown`, matching the designed observability boundary.

- Phase 1 intentionally rejects `WRITE` tasks with `PERMISSION_REQUIRED`; only `READ_ONLY` task orchestration is enabled. Phase 1.5 must verify this guard and keep workspace mutation authority in the existing writer-lease tools.
- Command Room manifest version is `1.0.0`; rooms are versioned, receipts are explicit, and agent states include ONLINE/WORKING/WAITING/SLEEPING/OFFLINE. Phase 2 can render these existing records without inventing another state model.

- Installed acceptance can use the existing Streamable HTTP endpoint without building source. Room creation is idempotent; join codes are one-time; archive is MAIN-only and version checked.
- The READ_ONLY task lifecycle is room-version checked on assign and task-version checked afterward. Resource status is deliberately `PHASE_1_MANUAL`; Phase 2 must display this truth rather than imply automatic MT5/VPS/browser scheduling.
- Existing package scripts already provide focused Vitest, typecheck, build, acceptance, and packaging seams. A new dependency is unnecessary.
- Installed-runtime acceptance task `25e304da-d359-4009-9fbe-ff4f0414f71d` passed against NAVA 4.11.0 with 229 tools and all eight command-room tools.
- Two independent Streamable HTTP sessions were distinct. Main/Lead messaging round-tripped, the isolation room received no foreign message, direct Lead-to-Lead delivery returned `PERMISSION_DENIED`, and a WRITE task returned `PERMISSION_REQUIRED`.
- The READ_ONLY lifecycle passed `QUEUED > CLAIMED > RUNNING > REVIEW > COMPLETED`; presence heartbeat and `PHASE_1_MANUAL` resource status also passed. Both task-owned rooms were archived.
- The current workspace pnpm shim is `C:\Users\Endlessly\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd`; Node is `D:\Program Files\nodejs\node.exe`. These existing tools are sufficient for focused verification.
- The acceptance harness and existing command-room integration suite both pass. Current evidence supports Phase 1 transport/task correctness; only owned restart persistence and real refreshed ChatGPT connector discovery remain unproved.
- Phase 2 renderer integration is centralized: `AppShell.tsx` owns navigation, `App.tsx` owns screen state/data loading, and `messages.ts` owns Thai/English labels. A single Command Room page plus existing IPC seams is the minimum UI shape.
- Existing styles and page patterns can be reused. No router, state library, or new design system is justified.
- Desktop already constructs the `CommandRoomBroker` for MCP, but there is no renderer/preload IPC surface for Command Room. Phase 2 should reuse that same broker/repository instance rather than opening another database or calling the local MCP endpoint from the renderer.
- The minimum useful Phase 2 page is local-admin-safe: create the Main 1 + Lead 5 room, reveal one-time join codes/prompts only in the creation response, and show a credential-free room/agent/task overview. Chat agents continue to perform authenticated room mutations through MCP.
- Navigation can add one `commandRoom` screen and bilingual message keys. No client router or shared state package is needed.

## 2026-08-29 Phase 1.5 restart-persistence proof

- Before restart, the task-owned verifier created a Main 1 + Lead 5 room and kept room/auth material only in process memory.
- Exact installed NAVA root PID 5672 and its verified child tree were stopped; the new local MCP listener returned as PID 27412.
- The verifier observed a real offline interval, initialized a fresh MCP transport, authenticated to the same room, read it as ACTIVE, and confirmed the room version was unchanged.
- The verifier archived the task-owned room and exited 0; no test room was left active.
- NAVA's configured Tunnel does not auto-start after this controlled app restart. A direct client launch correctly failed because the Runtime API key is injected by NAVA and was not exposed. Starting from the verified NAVA UI restored `healthz=live` and `readyz=ready` on PID 9504.
- The C: writer lease survived the restart, durable task list remains empty, and `mcp_health` reports local MCP available with remote control-plane truthfully unknown.

## 2026-08-29 Phase 2 implementation seam

- Command Room creation already defaults to five Leads and returns one-time join codes only on the first successful create; duplicate create correctly returns an empty code map.
- The existing broker status path already emits public agent/task records and intentionally omits join/session hashes. The Desktop page needs a trusted local-admin overview because normal status requires an agent session.
- The existing SQLite repository has room lookup plus agent/task lists but no room list. The minimum backend change is one bounded `listRooms(limit)` port and a broker `overview(limit)` method for local Desktop use only; MCP tool exposure remains unchanged.
- Desktop already owns the same `CommandRoomBroker` instance used by MCP. Phase 2 should expose create/overview through existing typed IPC/preload patterns rather than creating a second database or calling local MCP from the renderer.
- Renderer navigation is a closed `Screen` union with centralized labels. Add one Command Room screen and one page component; reuse the existing dark theme, Prompt fonts, cards, buttons, and focus behavior.
- The page will show one-time codes/boot prompts only in the immediate creation result. Reloaded overview remains credential-free.
- Electron-builder remains usable without weakening repository release defaults: the local Phase 2 package uses the established temporary `signAndEditExecutable=false` command-line override and a separate output directory; `electron-builder.yml` remains signed-by-default.
## 2026-08-29 Phase 2 installed findings

- The installed Desktop page is functional through the native typed IPC path; no browser extension, second database, or new runtime dependency was introduced.
- Overview intentionally contains no join codes or session hashes. One-time codes exist only in the immediate create response and the UI tells the user to save them before leaving.
- The current history contains five archived Phase 1.5 acceptance rooms. They render as archived evidence; no production room was created automatically during installation.
- Local MCP and Tunnel were both restored after the controlled install. The already-open Codex connector still has its old callable schema, so new ChatGPT/Codex chats may need connector refresh before `command_room_*` wrappers appear even though the installed HTTP catalog already exposes all eight tools.
# 2026-08-29 Command Room Phase 2B preparation findings

- ADR-0001 and the Thai architecture define Phase 2 as four inseparable parts: migration 006, existing writer-lease integration, a shared-resource scheduler, and Main/Lead Desktop cards.
- The installed Phase 2 slice currently completes only the Desktop creation/overview/card path. It is safe and useful, but it does not satisfy the architecture-level Phase 2 gate.
- Current source evidence is explicit: CommandRoomBroker.task() rejects every WRITE assignment, status() and resource() return PHASE_1_MANUAL, resourceSchema accepts only status, and SqliteDatabase applies migrations only through 005_command_room_core.
- CommandRoomBroker currently receives only SqliteCommandRoomRepository. CLI and Desktop each construct SqliteWorkspaceLeaseRepository separately for MCP services, so Phase 2B should construct one instance and inject the same lease port into both MCP workspace tools and the broker.
- No second writer lock is needed. Existing workspace_leases remains the single source of truth, with an owner label scoped to room, slot, and task.
- Shared-resource leases are separate from file authority. They prevent two projects from using the same MT5 terminal path, VPS writer, managed browser writer, or GPU-heavy slot; they do not grant permission to use those capabilities.
- The fixed eight-tool surface remains valid. command_room_resource can become a discriminated union for status/request/renew/release without adding another MCP tool.
- Phase 2B must return actionable conflict metadata but must not automatically retry a mutation. A resource request may queue/wait; the actual agent decides when to retry after new evidence.
- The accepted UI already has the correct page and cards. The next UI diff should add truthful workspace/resource ownership and conflicts to existing DTOs rather than introduce routing, state management, or a second database connection.
- The next installed pilot should use isolated task-owned rooms and harmless registered workspaces/resources. Real EA Live, real orders, production VPS changes, and unrelated writers remain outside scope.
- Phase 3 browser pairing/wake should remain blocked until Phase 2B proves same-workspace exclusion, different-workspace concurrency, MT5/VPS non-collision, restart reconciliation, and release on terminal task states.
## 2026-08-29 Command Room Phase 2B source findings

- The interrupted prior run had already implemented most of Phase 2B but left it uncommitted; Git plus the phase tracker, not the truncated shared-chat preview, was used as the source of truth.
- A foreign-key failure at writer-lease acquisition is too late for the accepted contract. WRITE tasks must reject an unknown workspace during assignment, so CommandRoomBroker now receives a narrow workspaceExists read dependency backed by the existing workspace repository.
- The existing workspace_leases table remains the sole filesystem writer lock. Command Room only scopes its owner label to room/slot/task and does not create a second lock or authorization layer.
- A durable command_room_resource_requests table is necessary even though the first Phase 2 design sketched only resources and active leases: QUEUED requests, idempotent replay, priority, 5-minute aging, and FIFO order cannot be deterministically reconstructed from active leases after a process restart.
- Resource leases remain coordination rather than capability authority. Request/renew/release do not bypass workspace roots, permission profiles, human confirmations, destructive-action policy, or audit redaction.
- Source evidence now covers same-workspace denial, different-workspace writers, stale writer reconciliation, terminal release, resource capacity/idempotency/expiry, exact MT5 terminal catalog, VPS/browser/GPU capacity, and SQLite reopen persistence. Independent installed MCP sessions, controlled installed restart, and visual bounded-rendering proof remain release-gate evidence.
- The installed verifier scripts/verify-command-room-phase2b.mjs is intentionally source-only for now. It is designed to keep credentials in memory, use task-owned rooms/workspaces, pause for an external controlled NAVA restart, and avoid EA Live, production VPS mutation, and real MT5 orders.
