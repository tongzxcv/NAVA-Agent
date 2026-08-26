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
