# NAVA Agent full-access setup

## Goal

Configure the installed NAVA Agent for the user's explicitly requested full-access local runtime, keep the available integrations usable without exposing secrets, and make the installed user-facing branding consistently say NAVA Agent.

## Completed audit phases

- [completed] Inspect executable, shortcut, and running process
- [completed] Inspect data store, workspace, permission, and MCP/tunnel settings with redaction
- [completed] Inspect runtime listener/endpoint
- [completed] Summarize confirmed, pending, and corrective items

## Setup phases

- [completed] Freeze the requested full-access scope and inspect current runtime state
- [completed] Persist full-access settings safely and restart the app
- [completed] Verify local MCP and Codex integration after restart
- [completed] Prepare Secure MCP Tunnel prerequisites and report any user-owned credential step
- [completed] Fix the user-facing Windows executable and Electron app name to NAVA Agent
- [completed] Rebuild, install, and verify the branded package at the D: installation root
- [completed] Replace the Windows app identity so taskbar icon caching cannot reuse the old lnwjud identity
- [pending] Apply a user-selected release version for NAVA Agent
- [completed] Final verification and handoff

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| No existing planning files in the project | 1 | Created task files for this audit |
| Findings patch did not match the file text | 1 | Re-read the files and rebuilt the small audit files with ASCII-only text |
| Second findings patch had a backslash escaping mismatch | 1 | Rebuilt the small audit files using a literal patch |
| PowerShell 5.1 rejected the null-coalescing operator | 1 | Re-ran the environment check with PowerShell 5.1-compatible conditionals |
| Full repository secret/artifact scan timed out on existing build/dist binaries | 1 | Ran a scoped secret-pattern scan on the three audit files that will be staged |
| Second restart lookup did not find the old NAVA Agent process name | 1 | Inspected Win32 process paths and found the active packaged app at D:\\Program Files\\NAVA Agent\\lnwjud\\lnwjud.exe |
| Public Desktop shortcut save was denied by Windows ACL | 1 | Created a working shortcut on the user Desktop; did not change the Public Desktop ACL |
| Existing source database could not be hashed while locked | 1 | Created a consistent SQLite backup with the SQLite backup API and verified integrity |
| npx asar probe had no local CLI package alias | 1 | Used the repository's installed @electron/asar package directly |
| Corepack/pnpm was unavailable for the package script | 1 | Ran the repository's installed TypeScript, esbuild, Vite, and Electron Builder binaries directly |
| NSIS signing cache could not create Windows symlinks under the current token | 1 | Built and verified the unsigned unpacked x64 package with signAndEditExecutable disabled; preserved the source NSIS config |
| signAndEditExecutable=false left the generated executable with the Electron default icon | 1 | Applied the existing cached rcedit-x64 resource editor to the generated NAVA Agent.exe, then copied the corrected package using an explicit child-item loop |

## Follow-up branding diagnosis

- The source release is still `4.5.0`; changing it to a new product release number requires an explicit target version because it updates the package, runtime contract, installer artifact, and release documentation together.
- Changed the Windows `appId` and Electron `AppUserModelId` to `com.nava.agent.desktop` so Windows does not reuse the old `lnwjud` taskbar identity/icon cache.
- Verified the embedded icon from the installed executable itself; it is the NAVA `N` icon and its Windows version metadata is `4.5.0.0`.

## Branding result

- Added `executableName: NAVA Agent` to the Windows package configuration.
- Changed user-facing Electron/update-dialog app names to `NAVA Agent`.
- Rebuilt and installed `D:\Program Files\NAVA Agent\NAVA Agent.exe`.
- Updated the working user Desktop shortcut to the new root executable.
- Retained the previous `D:\Program Files\NAVA Agent\lnwjud` directory as a rollback copy; it is not the active process.
- Kept internal package namespaces, IPC channel names, data directory, database filename, and tunnel profile names unchanged for compatibility.
