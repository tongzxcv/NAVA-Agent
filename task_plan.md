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
