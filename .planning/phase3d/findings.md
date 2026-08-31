# Phase 3D Findings

- Base commit is merged PR #7: `5a12a084ac97bd0c405dbb36d40cca9c41dd4a7f`.
- `apps/chatgpt-extension` is absent from the repository.
- Existing source already contains migration 007, `CommandRoomExtensionService`,
  `apps/desktop/src/main/command-room-extension-bridge.ts`, Desktop IPC
  channels, and Command Room Pair/Wake/Revoke controls.
- Existing Phase 3 plan forbids a generic MCP proxy, credential extraction,
  transcript scraping, silent chat creation, and automatic quota switching.
- The extension must therefore consume the existing narrow Bridge rather than
  call the MCP endpoint or Command Room tools directly.
- Desktop pairing payload is JSON with `protocolVersion`, `bridgeUrl`, `roomId`,
  `slotKey`, `bindingId`, one-time `challenge`, `expiresAt`,
  `connectionEpoch`, and `allowedOrigins`.
- Bridge pairing is `POST /v1/pair/confirm` with `bindingId`, `challenge`,
  `extensionInstallationId`, and an exact `conversationRef`; successful pairing
  returns a safe binding summary plus a bearer `authToken`. Authenticated wake
  reads and transitions are limited to the existing `/v1/bindings/...` and
  `/v1/wakes/...` routes.
- The first slice will keep the bearer token in `chrome.storage.session`, not
  persistent extension storage. The installation identity alone is persisted
  in `chrome.storage.local`. This intentionally requires re-pairing after a
  browser restart until the later encrypted-material/recovery gate is designed
  and tested.
- The extension will surface a wake and let the user copy a fixed continuation
  prompt manually. It will not overwrite the composer or auto-submit; those
  actions remain a later DOM-contract gate.
