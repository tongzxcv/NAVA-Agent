# Findings

- Installed NAVA process is `D:\Program\NAVA Agent.exe`, version 4.12.1.
- Valid packaged launcher exists at `D:\Program\lnwjud-mcp-stdio.cmd` and under `D:\Program Files\NAVA Agent`.
- Current source `apps/desktop/src/main/tunnel-controller.ts` passes the raw Windows launcher to `--mcp-command` at the init boundary.
- Current profile is stale from the prior account (`tunnel_6a8982d40bd881919b5fd949829adf9c`); it must not be treated as proof of the new account connection.
- New Platform tunnel created for Personal account: `tunnel_6a97c6052c388191b4fa0525df725ae3`.
- New Runtime API key was created and entered into NAVA; its value is intentionally not recorded here.
- The new key authenticated successfully against the tunnel metadata endpoint for the new organization; the previous account mismatch was resolved without exposing either key.
- The tunnel initially had no ChatGPT workspace association. Adding workspace `8bf2c189-519d-4eba-a1a5-0a59cf59c66a` made it appear in the ChatGPT Tunnel picker.
- ChatGPT created and connected the `NAVA Agent` development app from the selected tunnel. The app page displays the discovered NAVA tools and `Authorization used: None`.
- The installed runtime now recognizes `tunnel metadata fetched` as a connected/live signal, preventing a false `unknown` health state after a successful metadata bootstrap.
- A short network/DNS interruption produced poll warnings at 14:49, then the tunnel client logged `poller recovered; polling operational`; later dispatcher requests were forwarded to the MCP server.
