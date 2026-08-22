# Findings

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
- ChatGPT Web is logged in and the existing Work conversation shows `NAVA Agent` as an attached source. A new read-only prompt still requires action-time confirmation before sending.
- Installed EXE SHA256 is `8E1B1A59FC1AC960648887652A3413CCCDA1EF57B1C0A7084FB175B252931485`.

## Constraints

- Preserve existing DPAPI secret, YAML profile, SQLite settings, registered workspaces, full-access profile, and rollback path.
- Do not print or commit credentials.
- Do not weaken ownership checks or reclaim an unverifiable live owner.
- Treat a fresh ChatGPT Web tool call plus a new forwarded-command log entry as the final end-to-end gate.
