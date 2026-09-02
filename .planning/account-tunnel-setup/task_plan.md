# New-account NAVA Tunnel Setup

## SCQA

- Situation: NAVA v4.12.1 calls `tunnel-client init` with the packaged Windows stdio launcher.
- Complication: the launcher reaches init with backslashes and tunnel-client preflight normalizes it to `D:Program...`, so the new profile is not created.
- Question: what is the smallest safe fix that preserves existing tunnel behavior?
- Answer: pass a POSIX-normalized launcher to init, retain the existing YAML rewrite, test the boundary, package/install, then verify the new tunnel and ChatGPT app.

## Acceptance criteria

- [x] `tunnel-client init` receives a slash-normalized absolute launcher path on Windows.
- [x] Existing YAML rewrite and tunnel lifecycle behavior remain unchanged.
- [x] Focused tests, typecheck, build/package, and runtime verification pass.
- [x] New-account tunnel ID is present and connected; the Secret key is never printed or committed.
- [x] No EA, Command Room session/lease/epoch, or unrelated dirty worktree is touched.

## Phases

- [completed] Diagnose and patch the init-path boundary.
- [completed] Run focused verification and package the desktop runtime.
- [completed] Install safely and verify NAVA/tunnel process health.
- [completed] Add the NAVA custom app in ChatGPT and verify tool discovery.

## Errors encountered

| Error | Resolution |
|---|---|
| `mcp-command preflight failed: ... D:Programlnwjud-mcp-stdio.cmd was not found` | Normalize the `--mcp-command` argument before invoking `tunnel-client init`; post-init YAML rewrite is too late. |
| Package script detected Node `25.8.2` | Run the pinned Node 24 runtime first in PATH; the project intentionally rejects Node 25 for packaged stdio. |
| NSIS packaging could not extract `winCodeSign` symlinks (`A required privilege is not held by the client`) | Use electron-builder `win-unpacked` packaging for the local install; signing is not required to validate the runtime fix. |

## Final handoff

- Tunnel `tunnel_6a97c6052c388191b4fa0525df725ae3` is associated with the new ChatGPT workspace.
- ChatGPT custom app `NAVA Agent` was created in development mode and connected with no auth; the connector discovered the NAVA tool catalog.
- The runtime API key is stored only through NAVA's encrypted Windows DPAPI setting and is not written to source, planning files, logs, or this handoff.
- Installed unpacked runtime is `D:\Program\NAVA Agent.exe`; the second packaged destination remains `D:\Program Files\NAVA Agent`.
- Current verification: `/healthz=200 live`, `/readyz=200 ready`, one tunnel-client child, and the poller recovered after transient network warnings.
