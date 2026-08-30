# Findings

- Current Git trees for local Phase 3C.7 commit `238295a` and `nava/main` `5e95bb0` are identical.
- Existing uncommitted `task_plan.md` and `docs/PHASE_PROGRESS.md` belong to the earlier Phase 3C.7 rollout and must not be overwritten or staged with this fix.
- The old HERMES ChatGPT Web chat lacks direct `command_room_presence` and `command_room_status`; nested `tool_batch` dispatch with session authority is blocked before reaching NAVA.
- Current Codex connector already exposes both direct typed tools, so the defect is connector exposure/manifest parity rather than Command Room storage or session validation.
- Workspace `NAVA Agent Dev` is registered as `5333332a-b768-4094-b232-4f853b645ea8`; resumed checkpoint requires current Git verification and there were no active writer leases before acquisition.
- Official OpenAI plugin guidance treats tool names, descriptions, schemas, and annotations as user-facing behavior, recommends one focused tool per distinct action, and requires metadata refresh plus a new conversation after server metadata changes.
- NAVA already registers all eight Command Room primitives as direct MCP tools. The missing direct tools in the old HERMES conversation are therefore stale/deferred ChatGPT connector metadata, not a missing broker handler.
- The server currently permits every Command Room call inside `tool_batch`; this is incompatible with ChatGPT safety for nested `agentSessionId` and must fail closed with a refresh/direct-tool instruction.
- The most important server instructions are not currently within the first 512 characters for Command Room direct-only routing, despite official guidance placing shared required sequences there.
- The complete MCP server suite passes 33 files / 178 tests after the change; Command Room integration remains 10/10 and public discovery remains exactly eight primitives.
- The bundled `nava-command-room` rule was synchronized to Codex, Claude, `.agents`, and ZCode roots; the local skill router index now contains the refreshed rule.
- This source fix cannot rewrite the tool schema cached by an already-open ChatGPT conversation. That conversation must refresh the connector; if direct tools still do not appear, a new conversation is required and any session takeover must follow the explicit safe-takeover flow.
