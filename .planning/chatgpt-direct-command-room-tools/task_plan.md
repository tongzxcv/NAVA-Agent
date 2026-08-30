# ChatGPT direct Command Room tools

## SCQA

- **Situation:** NAVA Command Room exposes eight runtime primitives and Phase 3C.7 preserves LEAD session authority.
- **Complication:** The ChatGPT Web connector does not expose `command_room_presence` and `command_room_status` directly. Routing session-bearing calls through `tool_batch` is blocked before NAVA receives them.
- **Question:** What is the smallest connector-contract change that restores heartbeat and `resume_check` without rotating the LEAD-4 session or adding a ninth Command Room primitive?
- **Answer:** Expose the existing presence/status primitives as direct connector tools, reject/avoid nested session-bearing batch routing, and update the bundled skill to fail closed when direct tools are stale or absent.

## Acceptance criteria

- [x] ChatGPT connector metadata exposes direct `command_room_presence` and `command_room_status` schemas after connector refresh.
- [x] Runtime discovery still contains exactly eight `command_room_*` primitives.
- [x] Session-bearing Command Room calls are not prescribed or routed through generic `tool_batch`.
- [x] Existing tool discovery, Command Room session authority, and Desktop behavior remain green.
- [x] Skill/docs explain connector refresh and fail-closed behavior without exposing session IDs.
- [ ] Task-owned tests, lint/typecheck, secret/artifact guard, commit, push, PR, and CI pass.

## Phases

- [completed] Locate connector exposure seam and freeze one public RED tracer.
- [completed] RED -> GREEN direct presence/status exposure metadata.
- [completed] RED -> GREEN session-bearing batch guard and skill contract.
- [completed] Run focused/full source gates and review scope.
- [in progress] Commit the scoped, secret-scanned change; push, open the PR, and monitor CI.
- [pending] Decide installed-runtime rollout only after source gates pass and active NAVA work is safe.

## Safety boundaries

- Preserve the existing HERMES LEAD-4 session and `connectionEpoch=1`; no join, rebind, or epoch rotation.
- Do not read, print, persist, or transmit raw `agentSessionId`, join codes, API keys, or credentials.
- Keep exactly eight internal Command Room primitives; do not add a ninth tool or a second session store.
- Do not touch EA, MT5, VPS workloads, production Command Room SQLite, or unrelated dirty files.
- Preserve installed NAVA settings/workspaces if a later rollout is required.

## Errors encountered

| Error | Attempt | Resolution |
|---|---:|---|
| `workspace_lease_call` rejected child `shell.workspaceId` as unknown | 1 | Kept the exact outer lease envelope and removed the field that is not part of the child shell schema; branch creation then passed. |
| RED tracer showed nested Command Room call returned a batch child `INTERNAL_ERROR` instead of failing at the batch boundary | 1 | Added a pre-dispatch direct-only guard that rejects every `command_room_*` child without reading or echoing its arguments. |
| `docs:tools:check` nested script could not resolve `corepack` from the NAVA workflow PATH | 1 | Keep the already-passed MCP build and run the catalog generator directly with the verified portable Node 24 executable. |
