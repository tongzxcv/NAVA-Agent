# Findings

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
