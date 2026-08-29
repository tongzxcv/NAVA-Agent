# NAVA Command Room Phase 1 implementation

## SCQA

- **Situation:** The proposed local-first Command Room architecture and ADR-0001 are committed. NAVA v4.11 already has SQLite WAL, additive migrations, continuity checkpoints, durable tasks, audit/activity, workspace authority, and expiring writer leases.
- **Complication:** No room/message/agent/task persistence or executable room broker exists yet. The current planned swarm is not an executor, manual lease/checkpoint envelopes are error-prone, and Phase 1 must not depend on browser wake-up, new cloud infrastructure, or the installed runtime being restarted.
- **Question:** What is the smallest implementation that proves one Main and reusable Leads can join, exchange bounded messages, assign/claim/update tasks, recover state after restart, and preserve all existing permission/lease boundaries?
- **Answer:** Add one transactional core migration and one deep broker service, expose the fixed eight MCP contracts behind a disabled-by-default feature flag, add one concise bundled skill, and build through vertical RED→GREEN slices using public interfaces.

## Acceptance criteria

- [x] Current branch/worktree, package boundaries, tool registry, test conventions, and bundled-skill path are verified before source edits.
- [x] Migration `005_command_room_core` is additive, transactional, backed up by the existing migration flow, and preserves all prior data.
- [x] Public broker behavior supports room create/status, slot join/rejoin, bounded inbox/cursor/ack, idempotent send, task assignment/claim/transitions, presence, and manual resource status without browser automation.
- [x] Exactly eight stable `command_room_*` tools are registered only when the feature flag is enabled; default behavior and primitive tools remain unchanged.
- [x] Invalid inputs return actionable validation through existing schema/result contracts; no raw prompts, credentials, or unbounded output are persisted.
- [x] Workspace mutations still require the existing writer lease; a leased workspace checkpoint uses the same lease wrapper.
- [x] Bundled `nava-command-room` skill covers Main/Lead boot, inbox, task, checkpoint, chat-full takeover, and release behavior without extra README/scripts.
- [x] Focused storage/application/MCP/skill tests pass, followed by affected package typecheck/lint/build gates.
- [x] No Chrome extension, Command Room UI, provider quota switching, resource scheduler execution, installed-runtime replacement, EA/MT5/VPS change, or active-project interruption is introduced.
- [x] Task-owned changes pass secret/artifact and staged-diff checks and are committed without unrelated files.

## Phases

- [completed] Verify live Git state, catch up planning, inspect current public interfaces/tests, and freeze the Phase 1 tracer bullets.
- [completed] RED→GREEN storage migration and repository slice.
- [completed] RED→GREEN broker room/join/message/task/presence behavior.
- [completed] RED→GREEN fixed eight-tool registration, feature flag, and leased-checkpoint contract.
- [completed] Create and validate the bundled nava-command-room skill.
- [completed] Run focused/full affected verification, review scope, scan, commit, checkpoint, and release lease.

## Safety boundaries

- Do not install, package, restart, or reconfigure the currently installed NAVA runtime in Phase 1.
- Do not build the Chrome extension or Desktop Command Room page.
- Do not touch EA, MT5, VPS, Tunnel credentials/profile, registered workspaces, or another project writer.
- Keep the feature disabled by default and additive; existing tool counts must be unchanged when disabled.
- Reuse existing workspace leases, permission checks, audit/activity, continuity, and durable task IDs rather than cloning them.
- Store bounded summaries/JSON only; never persist raw prompts, secrets, cookies, credentials, private keys, or large tool outputs.
- Use one room broker implementation and no new dependency, framework, process, database, or second lock system.

## TDD tracer bullets

1. Opening SQLite applies migration 005 and a room created through the repository survives reopen.
2. Broker creates a room, joins MAIN/LEAD slots, sends one idempotent bounded message, and advances inbox cursor.
3. Main assigns a task; one Lead claims it; stale expectedVersion and unauthorized transitions fail.
4. Feature flag off advertises no room tools; on advertises exactly eight and one manual create/join/inbox flow succeeds through ToolRegistry.
5. Bundled skill passes structural validation and names only tools/contracts that the runtime exposes.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Initial source-seam inspection returned more output than the tool budget and was truncated | 1 | Split all follow-up reads by package/file and never repeat the oversized query. |
| First broker RED run also reported temp SQLite `EBUSY` after the expected missing `CommandRoomBroker` failure | 1 | The GREEN implementation reaches the normal close path; the rerun passes and temp cleanup is clean. |
| The original Phase 1 writer lease expired during the user pause; one already-wrapped no-conflict mutation completed after expiry because no competing lease existed | 1 | Verified the workspace had no active writer and acquired a new 60-minute lease before any further source mutation. |
| First parallel `rg` invocation quoted every token as a PowerShell expression and failed before reading files | 1 | Use a plain PowerShell command string or native argument syntax in the corrected read-only calls. |
| First feature-flag patch preparation assumed uniform CRLF around one service line and stopped before mutation | 1 | Re-read the bounded seam, matched either newline style, and applied the same leased patch atomically. |
| Skill validator failed under the system and bundled Python runtimes because PyYAML was absent | 2 | Used the existing Python 3.11 runtime with PyYAML 6.0.3; the official validator passed without installing a package. |
| The MCP package test script could not find bare corepack from the inherited PATH | 1 | Dependencies were already built; running the complete package Vitest suite through the pinned portable corepack passed 176/176. |
| First Desktop build inherited Node 25 in a child script and correctly rejected it | 1 | Prepended the pinned Node 24.19.0 runtime to PATH; the full Desktop production build passed. |
| Final workflow review showed MAIN self-rebind was blocked although chat-full takeover required it | 1 | Added a failing MAIN takeover test, allowed rebind of any valid room slot, and reran focused/typecheck/lint gates successfully. |

---

# NAVA Command Room architecture design (Main 1 + Project Lead 5)

## SCQA

- **Situation:** NAVA v4.11.0 already has SQLite persistence, project continuity, durable tasks, bounded activity logs, workspace authority, and expiring writer leases.
- **Complication:** The public multi-agent capability is still planned. NAVA does not yet have a room/message broker, fail-closed chat identity, worker wake-up bridge, shared resource queue, or a user-facing Main/Lead dashboard. The user works across EA projects in both normal chats and ChatGPT Project chats.
- **Question:** What architecture best supports one Main coordinator and five reusable Project Leads without file collisions, duplicate work, stale context, quota waste, or MT5/VPS resource contention?
- **Answer:** Inspect the current runtime, source contracts, persisted usage, workspace/task/lease state, and UI seams; then produce a proposed architecture and rollout ADR only. Do not update the installed runtime in this design task.

## Acceptance criteria

- [x] Current NAVA orchestration, continuity, storage, permission, UI, and extension gaps are evidenced from source/runtime.
- [x] Actual multi-project usage is summarized without exposing prompts, secrets, or large raw logs.
- [x] The design supports Main 1 + five reusable Leads across normal ChatGPT chats, Project chats, and an optional Codex participant.
- [x] Roles, state machines, message/task contracts, SQLite schema, identity binding, workspace leases, resource scheduling, recovery, and audit behavior are specified.
- [x] Chrome extension behavior is event-driven and fail-closed; periodic model polling is not treated as reliable wake-up.
- [x] Default concurrency is tailored to EA/MT5/VPS work and can be changed without hard-coding project names.
- [x] UI/dashboard, settings, migration, phased rollout, tests, observability, rollback, and non-goals are documented.
- [x] No installed NAVA, Tunnel, EA, MT5, VPS, workspace setting, or active project writer is interrupted.
- [x] Documentation changes pass focused checks and are committed without unrelated files.

## Phases

- [completed] Inspect current NAVA runtime, source seams, persisted activity, workspaces, tasks, and coordination state.
- [completed] Derive the user-specific operating model and failure/resource constraints.
- [completed] Draft the full Command Room architecture and proposed ADR.
- [completed] Review the design against current contracts, security boundaries, and implementation size.
- [completed] Verify documentation, commit only task-owned files, and release the design lease.

## Safety boundaries

- Design only: do not implement, package, install, restart, or reconfigure NAVA in this task.
- Do not open, stop, or modify active EA/MT5/VPS work.
- Do not read or store raw chat prompts, credentials, API keys, private keys, or unbounded logs.
- Preserve existing checkpoint, workspace, permission, audit, and Tunnel data contracts through additive migrations.
- A coordination lease controls collisions; it never grants authorization or bypasses destructive-operation confirmation.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| The first 48-hour activity aggregation returned zero rows because the filter used the wrong timestamp handling and `tool` instead of `toolName` | 1 | Inspected metadata keys only, normalized UTC `DateTime`, reran successfully across both rotated JSONL files, and exposed no payload content. |
| One broad IPC search named non-existent `packages/contracts` and `packages/shared` targets | 1 | Used the real `packages/ipc-contracts` package and existing `packages/shared`; the partial search still returned valid matches and was not repeated. |
| First documentation check found two Markdown hard-break spaces plus one extra blank line at EOF in each planning file | 1 | Normalized trailing whitespace/final newlines; rerun passed with zero formatting failures and zero broken links. |
| Pre-stage diff review exposed a duplicate Review phase row created by incremental plan updates | 1 | Collapsed it to one completed Review phase and one in-progress Verify/commit phase before staging. |
| NAVA rejected `git commit --amend --no-edit` because history rewrites require explicit user confirmation | 1 | Preserved the design commit and will create a separate non-rewriting closure commit for the final planning state. |
| Direct session_checkpoint with workspaceId was rejected while this task held that workspace lease | 1 | Routed session_checkpoint through workspace_lease_call with the same lease; it succeeded and the design/test matrix now requires this typed envelope. |
| First refinement-check orchestration string had a JavaScript quoting error before any command ran | 1 | Rebuilt the command with plain strings and reran; no file or runtime action occurred in the failed attempt. |
| The next newline check assumed Windows CRLF while task files intentionally contain LF | 1 | Changed the validator to accept exactly one LF final newline; all refinement checks then passed. |
| Refinement staging without `--force` was rejected because the allowlist-style .gitignore still covers the tracked docs/adr parent | 1 | Use exact-path `git add --force` for only the five refined files, then inspect the cached name list and diff. |

---

# NAVA EA forensics and ML analysis capability

## SCQA

- **Situation:** NAVA already provides bounded filesystem, search, Git, shell, WSE, workspace diagnostics, and remote SSH capabilities, while the machine also has established MT5/EA validation rules and an Obsidian EA knowledge base.
- **Complication:** The requested reverse-engineering, trading-logic extraction, and ML/AI analysis workflow is not yet a single evidence-driven capability. A generic "analyze EA" tool would duplicate existing tools, risk overclaiming what can be inferred from EX5 binaries, and encourage overfit or leakage.
- **Question:** What is the smallest auditable skill/tool set that helps analyze source, black-box behavior, and ML evidence without changing trading logic or claiming profitability?
- **Answer:** Inspect the two supplied authenticated chat histories and current NAVA tool/skill contracts, define explicit source/black-box/ML modes and evidence levels, then add one orchestration skill plus only the deterministic local analysis primitives that are genuinely missing.

## Acceptance criteria

- [x] The two supplied ChatGPT conversations are summarized into concrete EA-analysis requirements without copying secrets or private account data.
- [x] Existing NAVA and global EA skills/tools are inventoried so the new capability does not duplicate search, shell, Git, backtest, or knowledge-base functions.
- [x] Source-analysis, black-box inference, and ML-audit modes clearly distinguish observed facts, inferred rules, confidence, and unknowns.
- [x] EX5 analysis remains lawful clean-room/static-metadata or behavior-based work; no license, access-control, account, or broker protection bypass is added.
- [x] ML checks cover at least leakage, temporal split, feature provenance, class imbalance, calibration, drift, and out-of-sample evidence without promising profitability.
- [x] New code/skill passes focused tests, validation, lint/typecheck/build as applicable, documentation, and secret/artifact checks.
- [x] Task-owned changes are committed; the installed NAVA runtime is not replaced until the combined update is separately approved.

## Phases

- [completed] Claim the two exact external Chrome tabs, read them without reload or input, and inventory current EA/NAVA capabilities.
- [completed] Freeze the minimal capability contract and evidence/safety boundaries.
- [completed] Implement the skill-first solution; no duplicate MCP tool was justified.
- [completed] Update user documentation and the EA knowledge base; run validation/build gates.
- [completed] Scan and commit task-owned changes, leaving deployment for the later combined NAVA update.

## Safety boundaries

- Do not claim source recovery from EX5 or infer unavailable proprietary logic as fact.
- Do not bypass licenses, authentication, account binding, broker controls, or third-party protections.
- Do not enable live trading, deploy to a VPS, alter production EAs, or auto-promote an ML model.
- Keep raw EA code, reports, credentials, and private chat content out of Git and bounded in analysis outputs.
- Preserve existing NAVA WSE, SSH, Tunnel, permissions, workspaces, and rollback paths.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Initial three-file planning patch assumed identical prior section titles | 1 | Read each file header and prepend against its actual title. |
| The first pass misclassified `source=extension` tab mentions as stale in-app-browser references | 1 | Match the supplied extension instance plus exact provider tab ID, title, and URL; both live Chrome tabs were then claimed read-only without reloading them. |
| The bundled skill validator could not start because this Python lacks PyYAML | 1 | Do not install a dependency for two Markdown files; inspect the validator contract and run an equivalent structural validation with the existing Node workspace dependencies. |
| PowerShell structural-validator string parsed `$skillFile:` as a scoped variable | 1 | Delimit the variable as `${skillFile}` and rerun the same checks; no skill file was changed. |
| Skill sync encountered an existing destination after the first root was copied | 1 | The Codex roots may alias the same storage. Inspect root targets and resume with hash-aware idempotent copy: skip identical files, stop on drift, copy only missing destinations. |
| Default PATH exposes unsupported Node 25.8.2 and no Corepack | 1 | Use the repository's previously verified portable Node 24/Corepack toolchain under `E:\AI_CACHE\tools`; do not change machine-wide Node. |
| Staged diff check found one extra blank line at EOF in seven new documentation files | 1 | Remove only the redundant final blank lines, resync owned skill copies, restage, and rerun the staged gate. |
| The new Obsidian concept page also had one redundant blank line at EOF | 1 | Remove the single blank line, restage only the new page, and commit it separately from the dirty parent worktree. |
| The first hand-built cached KB hunks inherited PowerShell CRLF as trailing whitespace | 1 | Unstage only those hunks, apply an LF patch file, verify `git diff --cached --check`, then commit exactly index and log additions. |
| A PowerShell hash-report loop piped directly after nested `foreach` blocks and parsed as an empty pipe element | 1 | Store the loop output in an array before formatting; no files were changed. |
| The first cached-only KB log patch had an incorrect hunk count and Git rejected it as corrupt | 1 | Leave the concept staging intact and use a one-line zero-context insertion against the verified index line; no unrelated log changes entered the index. |
| Piping the zero-context patch through Windows PowerShell added a CR byte that `git diff --cached --check` reported as trailing whitespace | 1 | Unstage only the log path and apply the same verified one-line hunk from an LF patch created with `apply_patch`. |

---

# NAVA secure SSH support

## Goal

Add a safe, profile-based SSH capability for VPS command execution and file transfer, then build, install, and verify the updated NAVA runtime without exposing credentials or disturbing unrelated processes.

## Acceptance criteria

- [x] NAVA can test an SSH profile, execute a bounded remote command, and upload/download a file.
- [x] Host-key verification is enabled by default; passwords and private-key contents are never accepted or logged.
- [x] Existing permission, audit, timeout, cancellation, and response-size controls remain in force.
- [x] Focused tests, lint, typecheck, build, package/runtime verification, and secret/artifact checks pass.
- [x] Existing NAVA/Tunnel settings and data are backed up and preserved during installation.
- [x] Task-owned changes are committed and pushed to the NAVA repository.

## Phases

- [completed] Inspect existing capability/tool/settings patterns and define the minimum SSH contract.
- [completed] Implement the SSH backend, tool registration, tests, and user-facing profile guidance.
- [completed] Run focused and full source verification.
- [completed] Back up, package, install, and live-test NAVA plus the local MCP runtime.
- [completed] Scan, commit, and push task-owned changes.

## Safety boundaries

- Never place a VPS password, private-key content, Runtime API key, host address, or username in source, tests, logs, or Git.
- Use native OpenSSH only; do not add an SSH dependency or bypass host-key checking.
- Do not terminate Codex, MT5, or unrelated processes. Restart only NAVA-owned processes during deployment.
- Preserve the live database, workspaces, permissions, Tunnel profile, Runtime API key, and rollback material.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| A single patch tried to delete and re-add each existing planning file | 1 | Preserve prior planning history and prepend the new active task instead. |
| Two Windows `rg` commands used wildcard path operands and returned OS error 123 | 1 | Search directories with `--glob` or enumerate package manifests; do not reuse wildcard path operands. |
| The first SSH transfer test rejected an in-root upload on Windows | 1 | Canonicalize configured roots with `realpath()` before containment checks so path-sensitive Windows aliases compare correctly. |
| Focused MCP tests found the deterministic tool-order fixture missing `remote_ssh` | 1 | Add the new public tool to the exact-order and schema contract assertions. |
| MCP package typecheck initially resolved the stale capabilities declaration before the dependency build | 1 | Build `@lnwjud/capabilities` first, then MCP and Desktop typechecks pass. |
| Full lint rejected four unnecessary quote escapes in SSH command-formatting template literals | 1 | Remove only the redundant escapes; command output remains byte-for-byte equivalent. |
| Full Desktop tests found an old 207-tool acceptance count after the runtime had already reached 219 before this change | 1 | Synchronize the production stdio/Desktop acceptance and E2E catalog to the current 220 default tools, including leases, diagnostics, and SSH. |
| Silent NSIS returned exit 0 but did not replace the custom `D:\Program Files` installation | 1 | Use the already verified `win-unpacked` runtime and hash-check direct scoped replacement, preserving the full pre-update backup. |
| The first external live-smoke script used a Windows drive path as an ESM specifier | 1 | Use an explicit `file:///C:/...` module URL; do not repeat the unsupported `C:/...` import. |
| Headless Edge did not write directly to the Thai PDF filename | 1 | Generate to an ASCII artifact name, visually verify it, then copy the exact verified bytes to both Thai destination paths. |

---

# NAVA WSE evidence and human-promotion update

## SCQA

- **Situation:** NAVA v4.9.0 already exposes bounded context economy/ranking plus telemetry, benchmark, regression, and session/context tools.
- **Complication:** The current WSE surface does not yet retain a real experience loop, several reporting tools are preview/static, and no deterministic offline strategy score can be reviewed and explicitly promoted by a human.
- **Question:** What is the smallest additive implementation that makes WSE evidence-backed without allowing self-modifying or silent strategy changes?
- **Answer:** Reuse the existing activity/audit, storage, and upgrade-tool seams to record bounded experiences, compute deterministic evaluations and offline scores, and require explicit human promotion before any strategy becomes active.

## Acceptance criteria

- [x] Completed tool activity can be summarized into bounded, redacted WSE experience records without storing secrets or raw oversized payloads.
- [x] WSE metrics and evaluation reports are derived from real recorded activity, not empty/static preview data.
- [x] Candidate strategies receive deterministic offline scores with documented inputs and reason codes.
- [x] Promotion is explicit, auditable, reversible, and never automatic; existing behavior remains the default until promotion.
- [x] Focused tests, lint, typecheck, full build, packaging/runtime checks, and staged secret/artifact checks pass.
- [x] Installed NAVA is backed up, upgraded safely, and verified with local MCP plus Secure Tunnel before task-owned changes are committed and pushed.

## Phases

- [completed] Inspect current WSE/context/activity/storage contracts and select the minimum persistence/runtime seams.
- [completed] Implement bounded experiences and real metrics/evaluation with focused tests.
- [completed] Implement deterministic offline scoring and explicit human promotion/rollback.
- [completed] Update docs/tool contracts and run focused/full verification.
- [completed] Back up, install, live-test, scan, commit, and push.

## Safety boundaries

- Do not add provider/model selection in this update; ChatGPT/Codex remains responsible for model choice.
- Do not store prompts, tool payloads, file contents, credentials, Runtime API keys, or unbounded logs in WSE records.
- Do not auto-promote, self-modify, or silently change routing/permission/destructive-operation behavior.
- Preserve DPAPI secrets, Tunnel profile, workspaces, permissions, database, rollback material, and unrelated running processes.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| A Windows `rg` command used a wildcard path for test files and returned `The filename, directory name, or volume label syntax is incorrect` | 1 | Search the source directory directly with `--glob` or enumerate exact files; do not repeat the wildcard path. |
| The first focused Vitest command requested a package-local `vitest.config.ts` that does not exist | 1 | Run the package's existing Vitest command without that config override. |
| MCP typecheck rejected casting a generic evaluation record to a benchmark snapshot | 1 | Give deterministic evaluation its own explicit interface and construct the snapshot field-by-field. |
| Full MCP suite had three expected advertised-tool count assertions at 213 after adding six WSE tools | 1 | Update only the stdio/HTTP catalog assertions to the new default count of 219; behavioral tests were otherwise green. |
| Local PDF QA command assumed Poppler tools (`pdfinfo`, `pdftotext`, `pdftoppm`) that are not installed | 1 | Use the available local Python PDF library or Edge rendering; do not install a new dependency for QA. |
| Default Electron Builder cache again failed to create two macOS symlinks in `winCodeSign-2.6.0` under current Windows privileges | 1 | Reuse the previously verified Windows-only Electron Builder cache under `E:\AI_CACHE\electron-builder-cache\nava-v4.9.0`; the complete `win-unpacked` runtime was already produced before the signing step. |
| A release preflight passed unsupported `-ExpectedVersion` to the parameterless `verify-release.ps1` | 1 | Use the script's actual contract when needed; version/artifact integrity is verified directly and the already-run focused release gates remain authoritative. |

---

# NAVA v4.9.0 user-guide refresh

## Goal

Update the Thai quick-start source and the Desktop PDF so they match the installed NAVA v4.9.0 runtime, explain the new multi-chat coordination and diagnostic tools in beginner-friendly language, and preserve readable print contrast.

## Acceptance criteria

- [x] Markdown frontmatter/title and operating instructions identify v4.9.0.
- [x] The guide explains safe multi-chat reads/writes, workspace leases, and diagnostic bundles without requiring raw MCP syntax.
- [x] A newly generated PDF passes text/page inspection and visual contrast checks.
- [x] The verified PDF replaces the Desktop and installed guide copies with matching SHA256 hashes.
- [x] Task-owned source/planning changes pass the secret/artifact gate, are committed, and are pushed.

## Phases

- [completed] Inspect the current source, stylesheet, PDF, and v4.9.0 behavior.
- [completed] Update the minimum guide sections and version references.
- [completed] Generate and visually inspect a new PDF.
- [completed] Replace both guide copies, verify hashes, scan, commit, and push.

## Safety boundaries

- Do not alter the running NAVA, Tunnel, Runtime API key, profile, workspaces, or permissions.
- Keep the existing print stylesheet and its explicit dark-code-block contrast fix.
- Never include a real secret, account identifier, or Tunnel ID in the guide.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| The dedicated PDF writer reported `No devices available` for the connected Remote Desktop account | 1 | Use the previously verified local Windows fallback: native Markdown-to-HTML conversion plus Edge headless printing with an isolated profile. |
| The first Edge `--headless=new` invocation returned before creating the PDF | 1 | Inspect the isolated run artifacts, then retry with the established Edge `--headless`/wait invocation rather than repeating the same command. |
| NAVA PDF inspection first required `workspaceId`, then returned `INTERNAL_ERROR` for the registered E: workspace | 2 | Keep the generated PDF and use local browser rendering plus available local PDF libraries/tools for inspection; do not retry the same unavailable provider. |
| Edge headless PDF screenshot produced a blank viewer canvas | 1 | Open the generated PDF in the normal local Edge window and inspect it page by page with Computer Use screenshots. |
| The first normal Edge visual profile opened policy-installed extension welcome tabs over the PDF window | 1 | Ignore the untrusted pages, stop only the isolated profile created for QA, and relaunch the PDF with extensions and first-run pages disabled. |
| The clean Edge profile displayed an account-sync prompt over the PDF | 1 | Do not interact with the login/privacy prompt; stop only this QA profile and relaunch the local PDF in an isolated Guest/InPrivate window. |
| Edge's PDF page-number control rejected UIA `set_value` with `Requested property was not in the CacheRequest` | 1 | Reobserved the unchanged window and will use the viewer's documented `Ctrl+Alt+G` keyboard navigation instead. |
| The first post-copy hash loop piped directly after `foreach`, causing `An empty pipe element is not allowed` | 1 | Store the loop results in an array before formatting; the earlier copy already verified all three hashes matched. |

---

# NAVA v4.9.0 deployment

## SCQA

- **Situation:** Commit `388545a` contains the verified workspace-lease, diagnostic, skill, and recipe changes while installed NAVA v4.8.7 remains active.
- **Complication:** The source still carries v4.8.7 metadata and deployment must preserve the live database, Runtime API key, Tunnel profile, workspaces, permissions, and a byte-verifiable rollback copy.
- **Question:** How can the prepared source become the installed NAVA release without risking unrelated processes or user state?
- **Answer:** Synchronize only release metadata to v4.9.0, rerun release checks, package, back up the installed application and database, install the verified artifact, restart only NAVA/Tunnel, and prove local MCP plus the new tools work.

## Acceptance criteria

- [x] Source/package metadata and release notes identify v4.9.0.
- [x] Lint, typecheck, tests, build, packaging, and release checks pass.
- [x] Existing install and database have rollback backups before replacement.
- [x] Installed EXE/ASAR match the packaged v4.9.0 artifacts.
- [x] NAVA, local MCP, Secure Tunnel, workspaces, and new tools are verified live.
- [x] Task-owned release changes are scanned, committed, and pushed; worktree is clean.

## Phases

- [completed] Inspect release/install state and synchronize v4.9.0 metadata.
- [completed] Run source and packaging verification.
- [completed] Back up and install v4.9.0 without changing user configuration.
- [completed] Verify live runtime, Tunnel, workspace state, and new tools.
- [completed] Scan, commit, push, and record rollback evidence.

## Safety boundaries

- Stop/restart only NAVA Agent and its owned Tunnel process; do not terminate Codex, MT5, or unrelated Node processes.
- Preserve `%APPDATA%\tunnel-client`, Runtime API key, profile YAML, workspaces, permissions, and live SQLite data.
- Copy rollback material before replacing installed files; never delete the existing installation or user data.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| electron-builder could not extract two macOS symlinks from `winCodeSign-2.6.0.7z`: `A required privilege is not held by the client` | 1 | Built an isolated Windows-only cache from the successfully extracted files and reran packaging; no admin or source dependency change was needed. |
| `rg` wildcard paths under `node_modules` were invalid on Windows | 1 | Enumerated the exact cache directories before inspection instead of passing wildcard directory names. |
| `Copy-Item -LiteralPath` treated `*` literally while preparing the builder cache | 1 | Repeated the copy with explicit `Get-ChildItem` input and verified 83 files before packaging. |
| The first live SDK verifier imported `@modelcontextprotocol/client` from a root that does not expose it | 1 | Imported the existing package-local SDK entry from `packages/mcp-server/node_modules`; the real HTTP MCP session then passed. |
| Legacy `/healthz` and `/readyz` checks returned 404 in v4.9.0 | 1 | Verified the listener and all six new tools through the MCP SDK, which is the supported runtime protocol for this build. |
| The first PowerShell Tunnel health loop piped directly after `foreach`, producing `An empty pipe element is not allowed` | 1 | Collected the loop results into an array first; `/healthz` and `/readyz` then returned `200 live` and `200 ready`. |
| Whole-tree artifact scanning reported ignored installers, packaged binaries, images, and binary false positives | 1 | Applied the commit gate to the 28 staged task-owned text files only; zero large blobs, artifact paths, or secret-pattern paths were present. |

---

# NAVA v4.9 source preparation (do not install yet)

## SCQA

- **Situation:** NAVA v4.8.7 is installed and in active use; source already exposes 213 configurable tools, durable tasks, recipes, recovery, audit, and skill discovery.
- **Complication:** Multi-chat writes lack an explicit workspace lease, incident evidence is spread across several tools, and account/release/MT5/Obsidian workflows are not packaged for one-step discovery.
- **Question:** How can the missing safeguards and workflows be prepared without interrupting or updating the live installation?
- **Answer:** Add a small persistent workspace-lease module, a redacted diagnostic bundle tool, three focused NAVA skills, and deterministic recipes in source only; verify and commit without packaging/installing/restarting NAVA or Tunnel.

## Acceptance criteria

- [x] Concurrent reads remain allowed; conflicting workspace writes can be claimed, inspected, renewed, and released with stale-lease recovery.
- [x] A read-only diagnostic bundle summarizes version, health, activity, tasks, recovery, and bounded/redacted logs without secrets.
- [x] Skills cover multi-chat coordination, incident diagnosis, and account/Tunnel switching without duplicating generic skills.
- [x] Recipes cover safe Git publish, release preparation, MT5 seven-terminal preparation, Obsidian update, and Tunnel reconnect verification.
- [x] Focused tests plus lint/typecheck/build pass using the repository toolchain.
- [x] Changes are secret/artifact scanned and committed only in source; installed NAVA/Tunnel remain untouched.

## Phases

- [completed] Inspect persistence, tool schemas, recipe/skill patterns, and write-operation seams.
- [completed] Implement workspace leases and diagnostic bundle with focused tests.
- [completed] Add focused skills and deterministic recipes with validation.
- [completed] Run focused/full verification and secret/artifact guard.
- [completed] Commit source changes and hand off as ready-to-install, without deployment.

## Safety boundaries

- Do not modify `D:\Program Files\NAVA Agent`, `%APPDATA%\tunnel-client`, Runtime API keys, tunnel profiles, workspaces, or the live SQLite database.
- Do not stop/restart NAVA, Tunnel, Codex, MT5, or unrelated processes.
- Do not package or install this source update until the user explicitly says they are ready.
- Preserve existing permissions, destructive confirmation, path guards, and transport behavior.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| `Get-ChildItem -Filter` rejected an array of planning filenames | 1 | Switched to `rg --files` and read the three discovered files explicitly. |
| Expected `packages/domain/src/ports.ts` did not exist | 1 | Use `rg --files packages/domain/src` to locate the actual split port modules before reading them. |
| Default PATH had Node 25 and no `corepack` | 1 | Use the previously verified portable Node 24.19.0/Corepack under `E:\AI_CACHE\tools\lnwjud` for all repository checks. |
| First leased-write test returned `INTERNAL_ERROR` | 1 | Corrected the test double to match the real four-argument `FileService.writeFile(actor, workspaceId, request, signal)` signature; production code was not changed. |
| Skill validator failed with `ModuleNotFoundError: No module named 'yaml'` | 1 | Ran the required skill-sync audit and a deterministic frontmatter/name/placeholder fallback; all three project skills passed structure checks. |
| First structural-validation PowerShell command had an empty-pipe parser error | 1 | Split the skill-sync audit and structural checks into separate commands; both then completed. |
| Offline lockfile refresh lacked cached registry metadata for `@eslint/js` | 1 | Added only the deterministic local workspace-link entry for `@lnwjud/audit`; no package resolution or install was needed. |
| Full MCP suite had three stale advertised-tool-count assertions (`207`) | 1 | Updated only the stdio/HTTP compatibility counts to the new default catalog size (`213`); all behavioral tests had already passed. |
| Public-repository hygiene test expected the old `213 configurable tools` README wording | 1 | Updated the assertion to require `219 configurable tools` and `213 are advertised by default`; all 8 checks then passed. |
| Whole-tree secret/artifact scan reported generated installers, bundled binaries, and dependency fixtures | 1 | Confirmed the reports are ignored build/dependency output, then applied the commit gate to task-owned staged source files only. |

---

# NAVA Desktop updater EPIPE hardening

## Goal

Stop repeated Electron main-process dialogs when the packaged updater logs after its inherited stdout/stderr pipe has closed.

## Acceptance criteria

- [x] Packaged Desktop logging cannot throw an uncaught `EPIPE`/`ECONNRESET`.
- [x] Auto-updater uses a safe logger instead of the inherited console stream.
- [x] Existing stdio peer-close behavior remains intact.
- [x] Installed NAVA checks for updates without a JavaScript error dialog.
- [x] Tunnel and local MCP recover after the scoped app restart.
- [x] Task-owned files are verified, committed, and pushed.

## Phases

- [completed] Stabilize the installed app and capture a deterministic regression.
- [completed] Apply the smallest Desktop-only stream/logger fix.
- [completed] Run focused/full verification and build the installed artifact.
- [completed] Back up, install, live-test updater/Tunnel, scan, commit, and push.

## Safety boundaries

- Restart only `D:\Program Files\NAVA Agent\NAVA Agent.exe`; do not terminate unrelated Node/Codex/MT5 processes.
- Preserve the Runtime API key, Tunnel profile, workspaces, permissions, and database.
- Do not weaken stdio transport shutdown semantics.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Inline Node SQLite query had PowerShell quoting syntax error | 1 | Switched approach instead of repeating the same command. |
| `better-sqlite3` was not resolvable from the storage package | 1 | Used built-in `node:sqlite` read-only access; no persisted updater overrides were present. |
| Relaunching the packaged GUI through `explorer.exe` still produced repeated `write EPIPE` events | 1 | The GUI console socket itself is unusable; temporarily disable scheduled update checks after a scoped database backup, then install the code fix. |
| Initial implementation patch used an incorrect nearby import context in `main.ts` | 1 | Inspect the exact import block and apply the same minimal change against current source. |
| NSIS packaging again failed because electron-builder cannot create winCodeSign macOS symlinks without Windows link privilege | 1 | Use the completed `win-unpacked` runtime produced before signing, verify its ASAR/version hashes, and install only scoped artifacts as in the prior release. |
| First Computer Use accessibility click reported an unknown outcome, then the refreshed tree showed no state change | 1 | Re-observed the window before any retry as required by the UI-control safety workflow. |
| Refreshed accessibility click lacked coordinate geometry | 1 | Captured a current screenshot and used its screenshot ID for one bounded coordinate click. |
| Repository-wide artifact scan again descended into ignored build/dependency trees and produced known binary false positives | 1 | Stopped the read-only scan and run the guard against the explicit staged source/test/doc set only. |

---

# NAVA Secure Tunnel response-budget hardening

## SCQA

- **Situation:** NAVA v4.8.5 supports concurrent workspaces, while Secure Tunnel rejects request or response bodies above 10 MiB.
- **Complication:** A 14.1 MiB `read_file` response received HTTP 413 and the tunnel-client then stopped its shared stdio child, surfacing `ExceptionGroup` in unrelated chats/tools.
- **Question:** How can NAVA keep the shared stdio session alive without silently discarding large results or weakening permissions?
- **Answer:** Enforce a conservative response budget at the central MCP response boundary and replace oversized results with a small actionable paging response before transport serialization.

## Acceptance criteria

- [x] No serialized stdio tool response can exceed the configured safe budget below the 10 MiB Tunnel limit.
- [x] Oversized responses become a bounded structured error with tool-specific paging/reduction guidance.
- [x] A 14.1 MiB `read_file` request fails safely before its contents are written to the transport.
- [x] The same stdio process accepts and completes the next request after an oversized response attempt.
- [x] Normal `shell`, `read_file`, `accessibility`, and concurrent-workspace behavior remains unchanged.
- [x] Installed NAVA and Secure Tunnel pass live recovery/regression checks.
- [x] Only task-owned source/tests/docs/planning files are committed and pushed.

## Phases

- [completed] Locate the central stdio serialization seam and existing response-limit mechanisms.
- [completed] RED then GREEN: central response budget and next-request survival.
- [completed] Add tool-specific paging/reduction guidance without duplicating filesystem policy.
- [completed] Run focused/full tests, lint, typecheck, build, and packaging checks.
- [completed] Back up, install, live-test Tunnel, scan artifacts/secrets, commit, and push.

## Safety boundaries

- Do not truncate source/file content silently; return a small explicit error and continuation guidance.
- Preserve local permissions, unrestricted mode, workspace isolation, and current Runtime API key/profile.
- Keep the response cap below 10 MiB with JSON/base64 framing headroom.
- Do not stop the installed app/Tunnel until source verification passes.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| RED stdio test returned `SdkError: Connection closed` for a ~12 MiB serialized `read_file` response | 1 | Expected reproduction; central pre-serialization budget now returns a bounded error and keeps the session alive. |
| Electron Builder NSIS step cannot create winCodeSign macOS symlinks under the current Windows privilege | 1 | Reuse the verified `win-unpacked` output produced before signing, apply repository `rcedit`, and install only hash-matched runtime artifacts. |
| One-off installed-runtime check could not resolve `@modelcontextprotocol/client` from the repository root | 1 | Resolve the package from the MCP server workspace instead of changing dependencies or repeating the same root import. |
| Installed-runtime composite check produced unexpectedly excessive captured output | 1 | Split the verification into one bounded oversized-read call followed by one small request, and never print tool payloads. |
| Bounded result summarizer used unavailable `TextEncoder` in the orchestration isolate | 1 | Rerun with string-length metadata only; the NAVA calls themselves completed and no payload was printed. |
| Repository-wide secret scan descended into ignored dependencies/build output and produced noisy false positives | 1 | Stopped the read-only scan after representative output; verify only the explicit staged files before commit. |

---

# NAVA multi-chat workspace isolation update

## Goal

Allow concurrent read operations against different registered projects, return useful partial search results instead of generic `INTERNAL_ERROR`, and resolve absolute full-scan paths to their owning workspace without weakening workspace boundaries.

## Acceptance criteria

- [x] Two read calls against different workspaces complete concurrently without cross-workspace blocking.
- [x] A recoverable ripgrep enumeration failure with partial output returns the paths, `truncated: true`, and a bounded warning.
- [x] A fatal search failure with no useful output remains a structured error with safe diagnostics.
- [x] `workspace_full_scan` accepts an absolute path inside a registered workspace and scans only that workspace.
- [x] Existing permission, path-boundary, and tunnel tests remain green.
- [x] Installed NAVA passes live reads against Autobots and BEELZEBUB EA Lab after backup and in-place update.
- [x] Only task-owned source, tests, planning files, and intentional docs are committed and pushed.

## Phases

- [completed] Preserve the incident evidence and build a deterministic failing test.
- [completed] Implement the minimum search diagnostics/partial-result behavior.
- [completed] Implement absolute full-scan workspace resolution and concurrent-workspace regression coverage.
- [completed] Run targeted tests, typecheck, build, packaging/runtime checks, and secret scan.
- [completed] Back up the installed artifact, install, verify live runtime, commit, and push.

## Safety boundaries

- Do not change or stop the installed NAVA/tunnel until source verification passes.
- Do not serialize independent workspaces globally.
- Preserve strict workspace boundaries and fail closed for paths outside registered roots.
- Keep diagnostics bounded and never expose secrets or raw environment data.

## Incident evidence

- `search_files` on `D:\EA\BEELZEBUB EA_Lab` returned `INTERNAL_ERROR` after 2.673 seconds at `2026-08-23T19:16:28.427Z`.
- The immediate `workspace_full_scan` fallback returned `INTERNAL_ERROR` because BEELZEBUB was not registered yet and the absolute path was not resolved to an owning workspace.
- BEELZEBUB was registered later as `c7fda5af-6e3e-4045-a7c0-51bc98bbc9cb`; current indexed search/full scan succeeds with 5,999 indexed files.
- No second NAVA tool call overlapped the failing 2.673-second interval, so that incident does not prove a multi-chat transport collision.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Initial backup used a wildcard with `Copy-Item -LiteralPath` and copied no children | 1 | Recreated the backup with explicit `Get-ChildItem` input and verified 86 files plus byte totals. |
| Root build could not find `corepack` from the inherited PATH | 1 | Prepended the isolated Node 24 directory and reran the complete 19-package build successfully. |
| Electron Builder cannot create macOS signing-cache symlinks without Windows link privilege | 2 | Used the generated `win-unpacked` runtime, applied verified Windows metadata with the repository's existing `rcedit`, and installed only hash-checked artifacts. |
| First installed v4.8.5 Tunnel start exposed `Microsoft.PowerShell.Security` autoload failure | 1 | Replaced new Runtime secret writes with direct Windows DPAPI and added module-free migration for the existing legacy secret. |

---

# Previous task: NAVA v4.8.4 usability and account migration update

## Follow-up: replace remaining title-bar icon

- [completed] Cancel the previously scheduled Windows shutdown.
- [completed] Trace the gold legacy title-bar icon to its source and replace it with the existing NAVA icon asset.
- [completed] Build, install, and visually verify the corrected NAVA title bar.
- [completed] Scan, commit, and push only task-owned changes.
- [in_progress] Shut down Windows after every write and verification step completes.

## Follow-up: repair PDF contrast and shut down

- [completed] Correct fenced-code contrast in the guide stylesheet.
- [completed] Regenerate and visually verify both PDF copies.
- [completed] Commit and push the documentation fix.
- [in_progress] Shut down Windows after all writes and verification complete.

## Goal

Ship and install a safe NAVA patch that removes remaining user-visible legacy branding, adds an in-app account/Tunnel migration workflow, and provides a beginner-friendly Thai guide without losing the current encrypted Runtime API key, tunnel profile, workspaces, or rollback path.

## SCQA

- **Situation:** NAVA v4.8.3 is installed and its local MCP plus ChatGPT Secure MCP Tunnel path has already passed end-to-end validation.
- **Complication:** Some user-facing text still says `lnwjud`, account replacement is not explained or easy to perform, and the existing instructions are fragmented.
- **Question:** What is the smallest safe update that makes NAVA easier to operate now and lets the owner move to another OpenAI account later?
- **Answer:** Release NAVA v4.8.4 with visible-brand cleanup, a Settings workflow that can securely replace the Runtime API key using the existing DPAPI-backed storage, a clear account migration checklist, and a concise Thai quick-start guide.

## Acceptance criteria

- [ ] App and installer report NAVA v4.8.4; no user-facing command/manifest text presents the product as lnwjud.
- [ ] Existing Runtime API key and tunnel profile survive an in-place upgrade.
- [ ] Settings can replace the Runtime API key without revealing the stored key or writing it to logs.
- [ ] Account migration guidance distinguishes same organization/workspace from a new organization/workspace.
- [ ] Current tunnel still reaches `ready` after install, and local MCP remains available.
- [ ] Relevant tests, typecheck/build, packaged-app check, and secret scan pass.
- [ ] Thai quick-start and troubleshooting guide is committed with the source and summarized in the Obsidian vault.
- [ ] Only task-owned files are staged, committed, and pushed to the NAVA remote.

## Phases

- [completed] Inspect the existing Settings/runtime-secret flow and visible branding surface.
- [completed] Implement the minimum v4.8.4 UI, account migration, and branding patch.
- [completed] Add/update tests and the Thai quick-start guide.
- [completed] Build, back up, install, and verify NAVA v4.8.4 end to end.
- [completed] Update Obsidian evidence, scan secrets, commit, and push task-owned changes.

## Safety boundaries

- Preserve DPAPI secret storage and never print, prefill, or commit a Runtime API key.
- Preserve the existing tunnel profile, SQLite settings, registered workspaces, permission profiles, and installer rollback copy.
- Keep internal `lnwjud` identifiers where changing them would break compatibility; only remove user-visible legacy branding.
- Do not weaken tunnel ownership checks or full-access safety controls.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| UI design-system search returned a noisy landing-page match | 1 | Use only its applicable dark-dashboard accessibility rules and preserve NAVA's existing visual system. |
| Public Desktop denied PDF creation for the current user | 1 | Keep the shared app shortcut unchanged and place the guide on the signed-in user's Desktop instead. |
| First manual esbuild invocation stripped quotes around `node:module` | 1 | Rebuilt with an argument array that preserves the exact ESM banner, then repackaged. |
| Full Vitest run collided with the live NAVA/tunnel global lock and timed out | 2 | Stopped the installed runtime and reran each lock-sensitive file serially; 63/63 passed. |
| Chrome headless returned without creating the PDF | 1 | Switched to Edge headless with an isolated profile; the 4-page PDF was generated successfully. |
| `corepack` was not available on the default PATH for targeted icon tests | 1 | Use the bundled Node 24 runtime and its Corepack executable, as in the verified v4.8.4 build workflow. |
| Fallback `pnpm` attempted a dependency reinstall and aborted without a TTY | 1 | Bypass package-manager bootstrapping and invoke the already-installed local Vitest binary directly. |
| Expected root `vite.cmd` shim was absent | 1 | Resolve the installed Vite package entry point and invoke it with the bundled Node runtime instead of relying on a missing shim. |
| Electron Builder could not extract macOS signing symlinks without Windows link privileges | 1 | The Windows unpacked app and `app.asar` were already produced before signing; install only the verified renderer-bearing `app.asar`, which is the sole runtime artifact affected by this two-line UI fix. |
| PowerShell rejected a direct `foreach` pipeline in the ASAR comparison helper | 1 | Use `rg -a -F` for the exact embedded legacy-reference check and keep the verification read-only. |
| First multi-file planning update had a malformed patch hunk | 1 | Corrected the patch boundaries and reapplied the same documentation-only update. |
| Targeted typecheck initially used stale domain build output | 1 | Rebuilt `@lnwjud/domain`; then fixed the newly expanded `AppErrorCode` annotation and narrowed workspace IDs before rerunning. |
| First SearchService test rerun raised `isAbsoluteFsPath is not defined` | 1 | Imported the existing native path classifier from `workspace-locator.ts`; no new helper added. |
| Root typecheck required the new `SEARCH_FAILED` code in the Desktop MCP result allowlist | 1 | Added the code to the exhaustive `MCP_FAILURE_RESULT_CODES` map. |
# 2026-08-26 Rolling continuity checkpoints

## SCQA

- **Situation:** NAVA already provides project tools, writer leases, a basic persisted `session_checkpoint`, and `session_handoff` from a repository tracker.
- **Complication:** ChatGPT does not expose a dependable remaining-context meter. A long task can finish after the chat is already full, while the current checkpoint is global, summary-only, and not reliably selected by project in a new chat.
- **Question:** How can a new chat resume the correct project safely without copying the old transcript or dirtying the project repository?
- **Answer:** Extend the existing session tools into bounded project-scoped rolling checkpoints, advertise the checkpoint/resume policy in MCP server instructions, add a discoverable `nava-continuity` skill, and verify persistence through a fresh runtime instance plus a real MCP transport.

## Scope and boundaries

- Reuse `session_checkpoint`, `session_resume`, existing activity evidence, and workspace leases; do not add a parallel checkpoint service or dependency.
- Keep state in NAVA's existing runtime state outside project repositories.
- Persist only bounded summaries and evidence references; never retain prompts, credentials, secret values, or raw large logs.
- Preserve backward compatibility for existing summary-only checkpoints.
- Do not alter EA source, MT5 runtime, Tunnel credentials, or unrelated workspaces.

## Plan

- [x] Add failing public-behavior tests for project-scoped latest-checkpoint resume and MCP continuity instructions.
- [x] Implement bounded structured rolling checkpoints and project-specific resume with recent-activity fallback.
- [x] Add and synchronize the `nava-continuity` skill.
- [x] Run focused and integration verification, then exercise save/resume through a real MCP client connection.
- [x] Run sync, secret/artifact, diff, and Git gates; commit only task-owned files.

---

# 2026-08-27 Continuity writer-lease discovery repair

## Goal

Prevent a resumed NAVA chat from stopping when the coordinator skill is missing
from global discovery even though the installed MCP runtime exposes workspace
lease tools.

## Plan

- [x] Confirm the missing global skill and verify the live lease-tool inventory.
- [x] Add a direct lease-tool fallback to `nava-continuity` and install
  `nava-multi-chat-coordinator` across every shared skill root.
- [x] Validate both skills, run sync/router/live-MCP checks, then scan and commit
  only task-owned repository files.

## Boundaries

- Do not change the NAVA runtime, installer, Tunnel profile, credentials, EA
  source, or Live workspace.
- Preserve lease permission and human-confirmation requirements.
- Do not bypass an active writer lease.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| `Copy-Item -LiteralPath` treated `*` as a literal filename | 1 | Switch to explicit file-level copies; empty destination directories contain no skill content. |
| Default and bundled Python lacked the validator's `yaml` module; the first UTF-8 read also used the Thai Windows code page | 2 | Reuse the existing validator dependency cache through `PYTHONPATH` and set `PYTHONUTF8=1`; both skills then passed. |

---

# 2026-08-27 Lease-call schema recovery update

## Goal

Make intermittent `workspace_lease_call` mistakes self-correcting and make stale
ChatGPT connector/tool discovery visible without weakening strict validation or
workspace writer-lease safety.

## Plan

- [x] Add regression tests for actionable schema errors and the live tool-catalog Doctor check.
- [x] Implement the minimum runtime descriptions/diagnostics and exact skill examples.
- [x] Run focused tests, typecheck/build, skill sync, and package verification.
- [x] Wait for active external workspace leases to clear, preserve runtime state, install, and verify the live MCP/Tunnel.
- [x] Run the final staged secret/artifact gate and commit only task-owned files; do not push unless requested.

## Boundaries

- Keep `workspace_lease_call` strict; do not accept aliases or flatten child arguments.
- Do not expose argument values, credentials, prompts, or raw payloads in errors/logs.
- Do not interrupt the active `BEELZEBUB-R82` workspace lease or unrelated MT5 work.
- Preserve settings, workspaces, SQLite state, Runtime API key, Tunnel profile, and rollback path.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Initial multi-file test patch used the wrong workspace-lease test suite title | 1 | Read the exact test header and reapplied the same test-only change against `describe('workspace lease tools')`. |
| STDIO integration initially loaded stale built MCP output and missed the new server instructions | 1 | Rebuilt `@lnwjud/mcp-server`, then reran the same integration test successfully (3/3). |
| First full build hit a transient `EBUSY` copying the bundled Node runtime | 1 | Confirmed no checkout-owned process remained and reran only the Desktop build; it passed and bundled Node 24.19.0. |
| NSIS packaging could not create macOS compatibility symlinks inside `winCodeSign-2.6.0` without Windows link privilege | 1 | Keep the fully built `win-unpacked` candidate and use the established hash-verified in-place runtime installation; no signing requirement is weakened. |
| First compact lease-status probe omitted spaces between PowerShell parameters | 1 | Rewrote the same read-only probe with explicit named arguments; it confirmed the external lease was still active. |
| First cache-completeness query had an empty PowerShell pipeline element | 1 | Rewrote it with an explicit result array; confirmed the packaging failure is the known symlink privilege limitation. |
| First live MCP probe omitted the dual Accept header, then omitted `notifications/initialized`, then attempted to parse SSE as plain JSON | 3 | Corrected the verifier to use the MCP HTTP handshake and SSE `data:` payload; the installed runtime then passed the intended checks. |
| Tunnel health port was down after the controlled Desktop restart | 1 | Started the existing configured Tunnel from NAVA UI and verified `healthz=live`, `readyz=ready`, and a Desktop-owned tunnel process. |
| Electron accessibility exposed the Start Tunnel button without clickable geometry | 1 | Refreshed a screenshot-backed observation and clicked the verified NAVA window coordinate once. |

---

# 2026-08-27 Multi-project handoff resilience preparation

## Goal

Prepare a source-only NAVA update so `session_handoff` works across concurrent
BEELZEBUB, RATCHET, and AUTOBOTS chats without requiring every project to keep
its tracker at one hard-coded path, and make global activity logs easier to
attribute to the correct workspace. Do not update the installed runtime yet.

## Plan

- [completed] Add public-behavior regression tests for tracker fallback, checkpoint fallback, and no-evidence warning behavior.
- [completed] Implement the minimum handoff fallback and workspace-labelled activity records.
- [completed] Run focused tests, typecheck/build gates, and inspect the scoped diff.
- [completed] Run staged secret/artifact checks and commit only task-owned source/planning files; do not install or push.

## Boundaries

- Do not restart, stop, or replace the installed NAVA v4.10.3 runtime or Secure Tunnel.
- Do not interrupt active BEELZEBUB, RATCHET, AUTOBOTS, VPS, or MT5 work.
- Preserve strict workspace IDs, writer leases, permission checks, and path boundaries.
- Do not invent a ChatGPT conversation identifier that the MCP transport does not expose.

---

# 2026-08-27 Apply multi-project handoff resilience

## Goal

Deploy the already verified source update to the installed NAVA runtime and
prove the installed local MCP path and owned Tunnel remain healthy, while
preserving user data and keeping the external Tunnel-client failure separate
from source-level fixes.

## Plan

- [completed] Build and package the current source with the verified Node 24 toolchain.
- [completed] Back up the installed runtime and preserve app data, workspaces, and Tunnel state.
- [completed] Install only the task-owned runtime artifacts and restart only NAVA-owned processes.
- [completed] Verify installed MCP tools, workspace-labelled activity, health endpoints, and Tunnel state.
- [completed] Record evidence, run the final scoped guard, commit planning/deployment notes, and leave push for an explicit request.

## Boundaries

- Do not touch BEELZEBUB, RATCHET, AUTOBOTS, VPS, MT5, Live, or unrelated processes.
- Do not reset/clean the parent `D:\EA` repository or stage unrelated changes.
- Preserve Runtime API key, Tunnel profile, SQLite data, workspace registrations, permissions, and rollback material.
- Do not claim the external `tunnel-client` control-plane `502/client_internal`
  issue is fixed unless a real Chat/Tunnel request proves it after deployment.
# Active Task: NAVA v4.11 Reliability — five-part update

## Current execution note

The repository seams are verified. The implementation will preserve the existing permission engine and workspace writer lease, add only bounded metadata, and keep remote tunnel health explicitly `unknown` when it cannot be observed locally.

## SCQA

- **Situation:** NAVA v4.10.3 has the required primitives, leases, continuity, tool discovery, bounded transport, and tunnel reconnect, but the current seams still fail in real multi-chat use.
- **Complication:** Project keys are only lowercased, the server advertises a very wide catalog, local `/healthz` does not prove Chat connectivity, activity logs append indefinitely, and multi-project authority is difficult to see.
- **Question:** What is the smallest additive implementation that makes all five reliability improvements observable, testable, and backward-compatible without touching EA/MT5 behavior?
- **Answer:** Add canonical continuity identity and milestone recovery, a stable essential-tool discovery surface, layered tunnel health, bounded log/output retention, and explicit workspace authority summaries. Preserve primitive tools, permissions, leases, and existing paths.

## Acceptance criteria

- [x] All five requested reliability improvements are implemented through existing seams where possible.
- [x] Existing primitive tools, permission gates, workspace roots, leases, and continuity data remain backward-compatible.
- [x] Checkpoint aliases recover the same project and expose a concrete next action after chat rollover.
- [x] Tool discovery and health diagnostics expose missing/stale capability states without hiding callable primitives.
- [x] Logs and high-volume outputs are bounded without losing continuation metadata or latest error evidence.
- [x] Multi-project writer ownership is inspectable and mutations remain lease/permission controlled.
- [x] Focused tests, lint, typecheck, build, package/release checks, and installed-runtime verification pass where available; standard signed NSIS packaging remains blocked only by the Windows symbolic-link privilege required by electron-builder's winCodeSign cache.
- [ ] Only task-owned files are staged and committed; no EA/MT5 or unrelated workspace changes are included.

## Phases

- [completed] Inspect current repo, checkpoint, lease, architecture, and test contracts.
- [completed] Implement continuity identity/recovery and essential tool discovery.
- [completed] Implement layered tunnel health and bounded logs/outputs.
- [completed] Implement workspace authority visibility and update contracts/docs/tests.
- [completed] Run final verification, commit task-owned changes, and release the writer lease.

## Safety boundaries

- Do not modify EA/MT5 source, live orders, tester data, or any `D:\EA` project.
- Preserve DPAPI/API keys, tunnel profile, SQLite/workspaces, permissions, and rollback material.
- Do not remove primitive tools or silently weaken path, permission, destructive-action, or writer-lease checks.
- Do not add external dependencies unless an existing platform/runtime solution cannot satisfy the requirement.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| None in this active phase | 0 | Continue with focused inspection before mutation. |

# Active Task: NAVA Command Room Phase 1.5 acceptance and Phase 2

## SCQA

- **Situation:** NAVA Agent 4.11.0 is installed with Command Room Phase 1 enabled. Direct local MCP verification previously listed 229 tools, including all eight command-room tools, and the Tunnel reported `live` / `ready`.
- **Complication:** This Codex connector session still has a stale schema with no `command_room_*` wrappers, and Phase 1 has not yet proved two independent clients, persistence across restart, or safe writer coordination end to end.
- **Question:** What is the smallest evidence-backed path from the installed Phase 1 backend to the user's Main 1 + Project Lead 5 daily workflow?
- **Answer:** First run an isolated two-session MCP acceptance harness against the installed runtime. Verify messaging, task state, presence, resource ownership, persistence, and restart recovery. Repair only reproduced defects. Start the minimum Phase 2 UI/role preset only after every Phase 1.5 gate passes.

## Acceptance criteria

- [x] Two independent MCP sessions list all eight command-room tools.
- [x] Main and Lead identities can join one isolated test room and exchange bounded messages without cross-room leakage.
- [x] Task, presence, and resource/writer coordination behave deterministically under concurrent requests.
- [x] Command-room state survives an owned NAVA restart and remains readable afterward.
- [x] Existing workspace leases, permissions, continuity, MCP health, and Tunnel health remain intact.
- [x] No production defect was reproduced; the dependency-free installed-runtime harness is the repeatable regression check.
- [x] Phase 2 Main 1 + Project Lead 5 preset/UI scope is implemented only after Phase 1.5 passes.
- [x] Relevant tests/build pass, task-owned changes are secret/artifact scanned and committed, and no push occurs unless requested.

## Boundaries

- Do not modify EA/MT5 projects, live trading state, VPS workloads, Runtime API keys, Tunnel credentials, or unrelated workspaces.
- Do not restart NAVA until active durable tasks, external leases, and shared activity are checked.
- Use the C: workspace writer lease for every source/planning mutation.
- Keep the acceptance room isolated and remove or archive only task-owned test state when the command-room API explicitly supports it.
- No new dependency or framework unless an existing platform/runtime seam cannot satisfy a reproduced requirement.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Planning-file inventory PowerShell used an invalid empty pipeline after `foreach` | 1 | Rewrote it with an explicit result array; all three existing planning files were found. |
| First leased shell call repeated `workspaceId` inside child arguments and the current shell schema rejected it | 1 | Retried through the same outer writer lease without the unknown child field; the acceptance harness then passed. |
| A second PowerShell tool-path query repeated the invalid `foreach | ConvertTo-Json` shape | 1 | Stopped using that shape and used an explicit `$rows` array; located the workspace pnpm shim and Node executable. |
| The pnpm shim attempted an install and aborted a modules purge because the leased shell has no TTY | 1 | Do not retry pnpm installation; invoke the already-installed Vitest entrypoint directly with Node. |
| Pre-commit `git diff --check` found one extra blank line at `task_plan.md` EOF | 1 | Normalize the planning file to exactly one trailing newline before staging. |
| New acceptance harness failed ESLint on Node globals and one unused Lead session value | 1 | Use `globalThis.fetch`, write through `process.stdout`, and do not retain the unused session token; rerun lint and acceptance. |
| Final direct `session_checkpoint` call was rejected while this task owned the workspace lease | 1 | Released the lease, reacquired a short finalization lease, and route the checkpoint through `workspace_lease_call`. |
| Direct `git` status/diff calls were rejected while this task owned the workspace lease | 1 | Re-ran the same read-only Git commands through `workspace_lease_call`. |
| Vitest attempt through `cmd.exe` treated the quoted pnpm path as a literal command name | 1 | Switched to PowerShell call-operator invocation. |
| Restart verifier ESLint initially treated `setTimeout` as an undefined browser global | 1 | Use `globalThis.setTimeout`; syntax and ESLint then passed. |
| Direct Tunnel launch lacked NAVA's in-memory Runtime API key environment | 1 | Do not expose or reload the key; start Tunnel through the verified NAVA UI button and confirm `healthz=live` / `readyz=ready`. |
| First post-click PowerShell JSON summary serialized WebResponse objects incorrectly | 1 | Re-query only bounded string content and owning PID; Tunnel was already live/ready. |
| Desktop production build inherited Node 25.8.2 and stopped at the strict launcher gate | 1 | Reused the installed private Node 24.19.0 runtime to generate the launcher; source build output was otherwise complete. |
| First Phase 2 package command resolved `apps/desktop/electron-builder.yml` twice | 1 | Corrected the config path relative to the Desktop working directory. |
| Second package command assumed a hoisted electron-builder CLI that pnpm does not create | 1 | Resolved the exact pnpm package path before launching a fresh Node 24 package task. |
| First install preflight found a Tunnel-owned `conhost.exe` child outside the strict allowlist | 1 | Stopped before mutation, verified PID/path/parent, and allowed only that exact console-host path. |
| Second install preflight found the configured Tunnel-owned `codex app-server` chain outside the strict allowlist | 1 | Stopped before mutation, verified `cmd -> node -> codex.exe app-server`, and allowed only those exact paths/command markers. |
# Active Task: NAVA Command Room Phase 2B preparation — writer/resource coordination

## Current state

Phase 1.5 persistence and the Phase 2 Desktop Main 1 + Lead 5 view are installed and verified. The accepted architecture still defines Phase 2 as Desktop UI **plus** writer/resource coordination. The current broker rejects WRITE tasks and reports PHASE_1_MANUAL, so Phase 2 is not architecture-complete yet.

## SCQA

- **Situation:** NAVA already has one authoritative expiring writer lease per workspace, a versioned Command Room task state machine, durable checkpoints, SQLite WAL, and a working local-admin Desktop page.
- **Complication:** Command Room does not inject the existing workspace lease service, migration 006 is absent, shared resources have no persisted capacity/lease state, and the current MCP contract allows only resource status.
- **Question:** What is the smallest safe step that completes the accepted Phase 2 gate before any browser extension work?
- **Answer:** Implement a Phase 2B vertical slice that reuses the existing workspace lease as the sole file-writer authority, adds migration 006 for separate shared-resource leases, enables bounded WRITE task coordination without executing tools on behalf of agents, and renders truthful lease/resource status in the existing Desktop page.

## Acceptance criteria

- [x] Add transactional migration 006_command_room_resources with pre-migration backup and reopen/restart persistence proof.
- [x] Seed only the accepted resource catalog: seven explicit MT5 terminal paths, cpu-heavy-project capacity 2, vps-nava-writer, managed-browser-writer, and gpu-heavy.
- [x] Inject the existing workspace lease port into CommandRoomBroker; do not create a second writer lock or duplicate lease table.
- [x] Allow WRITE assignment only with a registered workspaceId; acquisition returns an actionable conflict and never grants filesystem authorization.
- [x] Bind workspace lease ownership to room/slot/task; renew only while the same task is RUNNING; release on submit, fail, cancel, park, leave, expiry, or verified stale recovery.
- [x] Extend the existing command_room_resource tool with bounded request, renew, and release actions while keeping the fixed eight-tool surface.
- [x] Enforce resource capacity atomically with idempotency, expiry cleanup, priority/FIFO evidence, and no automatic mutation retry.
- [x] Preserve workspace_lease_call, permission profiles, human confirmations, path roots, destructive-action blocks, and audit redaction unchanged.
- [x] Extend the Desktop overview/cards with source-of-truth workspace/resource lease status and actionable conflict text; never display opaque lease credentials after their required one-time response.
- [ ] Pass same-workspace collision, different-workspace writers, seven-terminal uniqueness, VPS/browser/GPU capacity, restart recovery, stale lease cleanup, and bounded rendering tests. Source/SQLite sub-gates pass; installed multi-session restart + visual bounded-rendering proof remains.
- [ ] Run a task-owned installed pilot with Main + 3 Leads and at most 2 writers on different workspaces; do not use EA Live, production VPS mutation, or real MT5 orders.
- [x] Scan and commit only task-owned files. Package/install/push only after separate user authorization.

## Implementation slices

- [x] **Tracer 1 — storage/resource truth:** RED tests for migration 006, atomic capacity, expiry, idempotent replay, and restart persistence; then the minimum repository implementation.
- [x] **Tracer 2 — writer task lifecycle:** share the existing workspace lease instance with the broker, enable guarded WRITE tasks, and prove acquire/renew/release/conflict transitions.
- [x] **Tracer 3 — MCP and Desktop truth:** expand only the existing resource union and overview DTOs; render lease/resource state with no new framework.
- [ ] **Tracer 4 — concurrency/recovery:** isolated broker/SQLite proof passes; independent installed MCP sessions plus controlled restart remain pending.
- [ ] **Release gate:** build/package/backup/install and visually verify only after all source and isolated-runtime gates pass.

## Planned source seams

- packages/domain/src/command-room.ts
- packages/storage/src/database.ts
- packages/storage/src/command-room-repository.ts
- packages/storage/src/command-room-repository.integration.test.ts
- packages/application/src/command-room-broker.ts
- packages/mcp-server/src/tools/command-room-tools.ts
- apps/cli/src/runtime/stdio-mcp-runtime.ts
- apps/cli/src/runtime/command-room.integration.test.ts
- apps/desktop/src/main/desktop-services.ts
- existing Desktop IPC/preload/renderer Command Room files
- a dependency-free installed-runtime Phase 2B acceptance script under scripts/

## Source gate status — 2026-08-29

- **PASS:** TypeScript 6 build, focused ESLint, Command Room integration 10/10, storage backup/WAL/resource regression 8/8, packaging regression 4/4, and git diff --check.
- Source version is 4.11.1. WRITE assignment now rejects an unregistered workspace before task creation.
- Migration 006 uses the existing pre-migration backup flow; resource state survives close/reopen, and the durable request queue preserves idempotency plus priority/aging/FIFO ordering.
- The extra command_room_resource_requests queue table is justified and recorded in ADR-0001; no automatic mutation retry was added.
- Installed NAVA remains 4.11.0. No package, install, NAVA restart, Tunnel restart, push, EA Live action, VPS mutation, or MT5 order was performed in this source gate.
- The installed Phase 2B verifier is prepared at scripts/verify-command-room-phase2b.mjs and remains blocked on the separately authorized release/pilot gate.

## Design guardrails

- Phase 2B coordinates ownership only; it does not execute shell, MT5, VPS, browser, Git, or filesystem mutations for an agent.
- Writer lease remains collision control, not authorization.
- Prefer deriving resource wait order from existing versioned tasks/events. Add another queue table only if a RED concurrency test proves the frozen migration-006 tables cannot provide deterministic fairness; update ADR-0001 before such a schema expansion.
- Do not start Phase 3 extension identity/wake, migration 007, Codex provider automation, cloud services, or automatic quota switching in this phase.
- Do not update the installed NAVA runtime while the user is actively using it; source preparation and installation are separate gates.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| Existing progress called the Desktop vertical slice “Phase 2 complete,” while ADR-0001 defines Phase 2 as UI plus writer/resource coordination | 1 | Name the next implementation Phase 2B and close the original Phase 2 acceptance gate before Phase 3. |
