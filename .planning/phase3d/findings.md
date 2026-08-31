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

## Completion-pass decisions

- Browser restart recovery uses an explicit user passphrase. The binding state
  and bearer token are encrypted with PBKDF2-SHA-256 derived AES-256-GCM before
  being written to `chrome.storage.local`; the passphrase itself is never
  stored. A locked profile cannot poll or call the Bridge until the user
  unlocks it, and a lost passphrase requires a new NAVA pairing payload.
- Automatic polling uses the Chrome `alarms` API at one minute and is created
  only after a successful pair or unlock. Manual checking remains available;
  exact-tab, duplicate-tab, DOM, offline, and Bridge failure paths remain
  fail-closed and recoverable.
- The safe submit contract is intentionally manual: a wake can show and copy a
  fixed continuation prompt after a user click, but the user pastes and sends
  it. No transcript scraping, composer overwrite, button click, or fabricated
  `submitted` transition is added.
- The source/runtime harness gates are complete. A real authenticated Chrome
  pilot is intentionally separate because it requires loading the unpacked
  extension into the user's browser profile; the disposable pilot could not be
  launched in this environment and did not modify browser state.
