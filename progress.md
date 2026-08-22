# Progress

## 2026-08-22

- Started read-only configuration audit.
- Confirmed shortcut and running process use the D: installation.
- Read-only SQLite inspection found three settings keys and four registered workspaces.
- Confirmed the desktop MCP listener is active at 127.0.0.1:18765.
- Safe values: Thai UI, full permission profile, selected workspace D:\EA\THANATOS.
- Unrestricted mode resolves to ON by default because the setting and environment override are absent.
- Secure MCP Tunnel is not configured: profile directory, client, and key state are absent.
- Codex is configured to the active local MCP endpoint; packaged stdio launchers are present.
- Audit complete; no settings or application files were changed.

## Full-access setup run

- User explicitly requested full system access and a ready-to-use installation.
- Next: persist explicit unrestricted/full settings, restart, then verify local MCP and tunnel prerequisites.

## Setup completed

- Backups: E:\\AI_CACHE\\lnwjud\\nava-agent-setup\\20260822-full-access\\lnwjud.sqlite.before-full-access and lnwjud.sqlite.before-tunnel-path.
- Persisted full permission and explicit unrestricted mode.
- Installed and verified official tunnel-client v0.0.12 Windows x64.
- Persisted the tunnel-client executable path in NAVA settings.
- Restarted NAVA; the active app path is now the root `NAVA Agent.exe` and local MCP is listening.
- Created a working user Desktop shortcut because Public Desktop is not writable by the current token.
- Local full-access runtime is ready.
- Remote Secure MCP Tunnel cannot be started without the user's tunnel ID and Runtime API key; no secret was created or exposed.
- Final verification passed: database settings, listener ownership, shortcut target, tunnel-client version, and Codex endpoint.

## Branding correction

- Root cause: the Windows package declared `productName: NAVA Agent` but omitted `executableName`, so Electron Builder emitted `lnwjud.exe` from the package name.
- Added `executableName: NAVA Agent` and changed user-facing Electron/update-dialog names to `NAVA Agent`.
- Packaging test passed: 3 tests.
- Rebuilt the x64 unpacked package, verified its `app.asar` contains the renderer and NAVA app name, and installed it at `D:\\Program Files\\NAVA Agent`.
- Runtime verification passed: main PID owns listener `127.0.0.1:18765`, `permission_profile=full`, `unrestricted_mode=true`, SQLite integrity `ok`, and no old `lnwjud.exe` process is running.
- The previous nested package remains on disk as a rollback copy; no Public Desktop ACL change was made.

## Taskbar identity correction

- Root cause: Windows still received the legacy `com.lnwjud.desktop` AppUserModelId, so its taskbar icon identity could remain associated with the old lnwjud icon cache.
- Changed the package `appId` and runtime `app.setAppUserModelId` to `com.nava.agent.desktop`.
- Rebuilt, packaged, installed, and restarted the active NAVA Agent process; the new package contains the NAVA icon and new identity.
- The first corrected copy was verified to have the Electron default icon because a wildcard was passed as a literal path; the package was copied again with explicit child items after applying the cached `rcedit-x64.exe` resource edit.
- Final installed executable verification passed: NAVA `N` icon, ProductName `NAVA Agent`, OriginalFilename `NAVA Agent.exe`, FileVersion `4.5.0.0`, main PID owns the MCP listener, and no old executable is running.
- The visible release label is still `v4.5.0` from the repository source. A new version number is intentionally not guessed.
