# Findings

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
