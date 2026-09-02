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
