# NAVA Findings (rolling summary)

Historical per-day findings were pruned from the repository on 2026-09-02 so the
public tree stays free of machine-specific paths and oversized session logs; the
prior content remains in git history for the operator. Durable project knowledge
lives in `docs/` (architecture, phase progress) and in knowledge bases outside
this repository.

Current highlights:

- Architecture is a strict onion: `domain`/`shared` -> `workspace`/`process`/`filesystem`
  -> `storage`/`git`/`capabilities` -> `application` -> `mcp-server`/`desktop`/`cli`,
  with permissions enforced as a cross-cutting engine at the application layer.
- Security model: fail-closed unrestricted default, permission profile persisted
  explicitly, git tools permission-gated with `userConfirmed` for destructive
  subcommands, DPAPI-protected runtime secrets, transactional workspace leases,
  opt-in bearer token for the local MCP HTTP endpoint (`mcp_http_token` setting).
- Verification culture: authoritative GitHub Windows release gate plus the
  `test:release-extras` suite (tunnel-lock contract/powershell, repo hygiene,
  electron startup diagnostics).
- Open follow-ups: per-tool input schemas for the passthrough upgrade-tool
  catalog, Command Room session TTL (needs a product decision on idle-expiry
  semantics), command-room-broker orchestration coverage beyond the room-close
  lease fan-out test.


## 2026-09-03 — Phase 3D browser-extension acceptance findings

- Browser pairing authority and Command Room agent-session authority are separate. A trusted Desktop pairing can bind the current MAIN browser conversation at the agent's existing epoch without creating a new Command Room session; a fresh agent join would require the next epoch and is therefore a separate takeover/rebind operation.
- The extension must resolve exactly one bound conversation tab. Zero matches fail closed as the wrong conversation and multiple exact matches fail closed as `AMBIGUOUS_TAB`; neither condition should touch the wake bridge as a successful delivery.
- Composer safety is a hard boundary: non-empty drafts and busy generation/edit/voice states reject wake injection rather than modifying user text. Conversation identity changes during SPA navigation abort/remove the wake UI.
- `DELIVERED` and `SUBMITTED` are browser delivery states, not proof that a Command Room task was claimed. Task claim remains an authenticated agent-side transition.
- The Extension Bridge remains loopback-only with an explicit extension-origin allowlist and does not expose a generic MCP/tool proxy. Restart recovery preserved pairing/settings while normal NAVA startup removed the temporary Electron CDP listener.
- Verification tooling should avoid package-manager commands that can implicitly run dependency status/install flows during a closure-only test pass; the installed test runner can be invoked directly when the dependency tree is already present and immutable for the gate.
