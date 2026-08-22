# Findings

## Confirmed

- Desktop shortcut targets D:\Program Files\NAVA Agent\NAVA Agent.exe.
- Shortcut working directory is D:\Program Files\NAVA Agent.
- Running Electron process and renderer load the installed package from D:\Program Files\NAVA Agent.
- Active user data directory is C:\Users\Endlessly\AppData\Roaming\lnwjud.
- Installed package contains resources\app.asar\dist\renderer\index.html.
- SQLite is readable in read-only mode while the app is running.
- Settings are permission_profile=full, selected_workspace_id for D:\EA\THANATOS, and ui_locale=th.
- The selected workspace directory exists.
- Desktop MCP listener is active on 127.0.0.1:18765 and owned by the running NAVA Agent main process.
- SQLite integrity check returned ok.
- Packaged local stdio launchers exist at the D: installation root.
- Codex points local_agent_hub to http://127.0.0.1:18765/mcp.

## Risk and pending configuration

- permission_profile=full allows dangerous operations automatically according to the project profile definition.
- Remote Secure MCP Tunnel is not configured: the profile directory and encrypted runtime-secret file are absent. No tunnel-client process is running.

## Sensitive-data rule

Do not print API keys, tokens, passwords, encrypted blobs, or credential values. Report only presence/state and safe metadata.

## Full-access setup request

- User explicitly authorized full system access for NAVA Agent.
- Do not weaken the requested full profile; persist the requested state explicitly rather than relying only on the code default.
- Keep OpenAI Platform credentials user-controlled; do not invent, display, or commit them.

## Setup result

- Explicit settings persisted: permission_profile=full and unrestricted_mode=true.
- Explicit tunnel client path persisted: C:\\Users\\Endlessly\\Downloads\\tunnel\\tunnel-client.exe.
- Database integrity remained ok after writes.
- Full official tunnel-client v0.0.12 Windows amd64 archive was downloaded to E:\\AI_CACHE and SHA256 verified before extraction.
- Extracted tunnel-client and cloudflared are available under C:\\Users\\Endlessly\\Downloads\\tunnel.
- Active packaged app is D:\\Program Files\\NAVA Agent\\NAVA Agent.exe; its app.asar contains dist\\renderer\\index.html and the MCP listener is active on 127.0.0.1:18765 under the same main PID.
- Public Desktop shortcut could not be recreated because the current token lacks create/write permission there. A working shortcut now exists at C:\\Users\\Endlessly\\Desktop\\NAVA Agent.lnk.
- Secure MCP Tunnel remains pending user-owned values: tunnel ID, Runtime API key, and the resulting lnwjud.yaml profile.
- No configured OpenAI tunnel/admin/API key environment variables are present.

## Branding result

- The Windows executable and shortcut now use `NAVA Agent`.
- The packaged Electron app name and update dialog now use `NAVA Agent`.
- The active process path is `D:\\Program Files\\NAVA Agent\\NAVA Agent.exe`; the old nested executable is not running.
- The old nested `D:\\Program Files\\NAVA Agent\\lnwjud` directory remains only as a rollback copy.
- Internal workspace/data/IPC/tunnel identifiers remain `lnwjud` to preserve existing settings and integrations.
- The Windows app identity is now `com.nava.agent.desktop`; the previous `com.lnwjud.desktop` identity is no longer used by the active package.
- The installed executable metadata is ProductName `NAVA Agent`, OriginalFilename `NAVA Agent.exe`, and the embedded icon is the NAVA `N` icon.
- The displayed release version remains `v4.5.0` because that is the repository's synchronized source version; no new release number was inferred.
