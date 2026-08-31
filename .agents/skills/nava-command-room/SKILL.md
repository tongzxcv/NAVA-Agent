---
name: nava-command-room
description: Coordinate one NAVA MAIN chat and up to five reusable LEAD chats across normal chats, ChatGPT Projects, or a Codex participant. Use for multi-project handoff, chat-full takeover, versioned READ_ONLY or WRITE tasks, workspace writer-lease ownership, and bounded MT5/CPU/VPS/browser/GPU resource reservations. Never use it to bypass permissions, wake browser tabs, trade/deploy Live, or switch provider quotas.
---

# NAVA Command Room

Coordinate agents through bounded local SQLite records. Store summaries and evidence references only; never store raw prompts, credentials, cookies, API keys, private keys, join codes, session IDs, lease IDs, or large tool output in durable notes.

## Preconditions

1. Confirm these eight tools are visible:
   - `command_room_join`
   - `command_room_status`
   - `command_room_inbox`
   - `command_room_send`
   - `command_room_task`
   - `command_room_presence`
   - `command_room_resource`
   - `command_room_admin`
2. Call every `command_room_*` tool directly. Never place a Command Room call, join code, or `agentSessionId` inside `tool_batch`; NAVA rejects that nested route because ChatGPT may block the authority value before it reaches the server.
3. If direct tools or schemas are stale, refresh the NAVA connector. If the current chat still lacks the direct tool, stop with `DIRECT_COMMAND_ROOM_TOOLS_UNAVAILABLE`; open or safely rebind a new chat only through the takeover flow below. Never use `tool_batch` as a fallback.
4. Treat room, task, join-code, session, idempotency, writer-lease, and resource-lease values as opaque.
5. Command Room does not grant permissions. Every mutation still obeys the active NAVA permission profile, workspace boundary, human confirmation, and destructive-action policy.

## Join and boot

MAIN creates a room with `command_room_admin`, a stable idempotency key, and one to five Lead slots. Deliver each one-time join code privately.

To expand an existing room, MAIN may call `command_room_admin` with `action=add_lead`, the current `expectedVersion`, and a stable idempotency key. NAVA adds only the next contiguous slot (`LEAD-2`, then `LEAD-3`, and so on through `LEAD-5`). The response returns a one-time join code only on the first successful mutation; an idempotent replay never reveals it again. Adding a slot creates `AVAILABLE` authority with epoch 0 only — it does **not** create an `agentSessionId`. The trusted Desktop **Add Lead** button uses the same broker/storage mutation without exposing a MAIN session to the renderer.

Each chat calls `command_room_join` directly for its assigned slot:

- provider is `CHATGPT`, `CODEX`, or `OTHER`
- first `connectionEpoch` is 1
- keep the returned `agentSessionId` only in active chat context

Immediately call `command_room_presence` directly for heartbeat with bounded project, workspace, and checkpoint references when known. Then call `command_room_status` directly with `action=resume_check`, the exact `roomId`, `slotKey`, `connectionEpoch`, and active `agentSessionId`. Continue only when authority is `READY`; `HEARTBEAT_REQUIRED` means heartbeat/read-back is incomplete, and `CREATE_SESSION_REQUIRED` means the chat must join or be rebound first. Room identity comes from the slot and room ID, not from the ChatGPT Project container.

Recovery/bootstrap material may contain only `roomId`, `slotKey`, and `connectionEpoch`. It is a locator, not session authority; never copy a raw join code or `agentSessionId` into Git, Obsidian, logs, or handoff notes.

## Inbox loop

At bounded milestones, before waiting, and before parking:

1. Read `command_room_inbox` from the saved cursor, at most 50 messages.
2. Process immutable messages in sequence.
3. Acknowledge only through the highest sequence actually processed.
4. Send questions, updates, results, and handoffs through MAIN. Lead-to-Lead delivery stays blocked.

Do not tight-poll. Recheck after completing a bounded work unit or when asked.

## Task flow

MAIN:

1. Assign a versioned task with project, workspace, brief, acceptance criteria, mutation mode, current room version, and a fresh idempotency key.
2. Require `workspaceId` for every `WRITE` task.
3. Review submitted evidence, then approve, reject, cancel, or issue bounded follow-up work.

LEAD:

1. Read status and claim only its assigned task.
2. Start with the current task version.
3. For `READ_ONLY`, work without a writer lease.
4. For `WRITE`, use the writer lease returned by start. If the workspace is already leased, accept the actionable `WAITING` result; never bypass it. Retry start with a new idempotency key only after status shows the conflict is clear.
5. Heartbeat only while actively running. Wait, submit, fail, cancel, park, leave, or lease expiry releases task-owned leases.
6. Submit bounded result evidence and optional checkpoint or durable-task references.

On a version conflict, read status again. Never guess a version or reuse an idempotency key for a different meaning.

## Workspace mutation and checkpoint

Command Room reuses NAVA's single authoritative writer lease per workspace. It does not create a second Git/file lock.

For a running WRITE task, route every workspace mutation through `workspace_lease_call` with exactly these outer fields:

```json
{
  "workspaceId": "<workspace-id>",
  "leaseId": "<writer-lease-id returned by Command Room>",
  "tool": "<mutation tool>",
  "arguments": {
    "<child tool fields>": "<values>"
  }
}
```

Route `session_checkpoint` through the same wrapper while the writer lease is active. A resumed checkpoint is evidence to verify against current Git, workspace, task, and Obsidian state; it is never mutation authority.

If heartbeat reports lease expiry, the task becomes `WAITING`. Read status, verify current evidence, then start again to reacquire.

## End-of-round checkpoint contract

End every bounded work round with a user-visible checkpoint that a fresh chat can use to resume without guessing. Do this even when the round produced no mutation, rejected an experiment, hit a blocker, or ended because tool/run time expired.

When persistence is allowed, call `session_checkpoint` before the final reply and display the returned UUID as `checkpoint <uuid>` in the user-visible block. This durable UUID is the canonical continuity reference for the round. A numbered heading such as `Checkpoint 19`, a phase tracker entry, or `session_handoff` may supplement it but never replaces it. For an active Command Room WRITE task, route this final `session_checkpoint` through the current writer lease.

The checkpoint must be self-contained and should use the project's own terminology. Include, when relevant:

1. **Canonical accepted baseline** — the last state that is actually accepted, plus its version/checkpoint/commit reference. Never silently promote the current experiment.
2. **This round** — what was changed, tested, measured, inspected, or ruled out.
3. **Outcome** — mark important candidates or gates as `ACCEPT`, `REJECT`, or `PENDING`. State the verified evidence or metric that justifies the status.
4. **Unverified work** — explicitly name compile/tests/replay/deep-run/live acceptance or other gates that have not passed yet. Never write as though a pending gate passed.
5. **Exact resume point** — the next command, verification, file, candidate, or decision to pick up first. If the run ended mid-operation, state the last completed gate and the next unfinished gate.
6. **Continuity references** — relevant workspace, branch/worktree, commit, durable checkpoint UUID, durable background `task_id`, candidate/version, and protected artifact path when they materially help resume.
7. **Hard invariants** — note safety boundaries that must remain unchanged, such as Production/Live untouched, no rebind/takeover, connection epoch unchanged, read-only scope, frozen thresholds, or unrelated dirty files preserved.

Prefer concise prose plus a small set of bullets, similar to a lab handoff, rather than a giant generic template.

The project phase tracker may mirror the same bounded facts when useful, but it is supplementary to the durable checkpoint. If the user explicitly requested read-only/no-write behavior, **do not call `session_checkpoint` and do not write a tracker merely to satisfy this contract**; report the same checkpoint in chat only and state that no durable checkpoint was persisted in that round.

For background work that outlives the round, checkpoint the durable `task_id` immediately so a new chat can read its status/result. Never store secrets, raw session authority, join codes, credentials, or large logs in a checkpoint.

On resume, treat the checkpoint as a locator/evidence summary, not authority. Call `session_resume` with the stable project key, then verify the returned checkpoint against current Git/workspace/runtime/task state before the next mutation.

## Shared resources

Use `command_room_resource` only for a RUNNING task assigned to the current agent.

- `status`: inspect capacities, active leases, and queue depth.
- `request`: reserve `mt5-terminal-1` through `mt5-terminal-7`, `cpu-heavy-project`, `vps-nava-writer`, `managed-browser-writer`, or `gpu-heavy`.
- `renew`: extend a lease only while its task remains RUNNING.
- `release`: release early when the resource is no longer needed.

Busy requests queue by priority, five-minute aging, then FIFO. Reusing the same request idempotency key may promote a still-queued request after capacity is released. A resource lease reserves capacity only; it does not execute a command, retry a mutation, place an MT5 order, or grant authorization.

## Chat-full takeover

When a chat is full or lost:

1. MAIN rebinds the target slot with the current room version and a new idempotency key.
2. Start a new chat and join with the returned one-time code and required connection epoch.
3. Send a heartbeat, then run `command_room_status` with `action=resume_check`; do not claim takeover until it returns `READY` for the exact room, slot, session, and epoch.
4. The old session is revoked and must fail across status, inbox, send, task, presence, resource, and admin actions.
5. The new chat reads status and inbox, verifies checkpoint/Git/workspace evidence, acknowledges processed messages, and continues.

Use the same flow for MAIN replacement. Do not create a duplicate room unless recovery is impossible and the user explicitly chooses replacement.

## Parking and lifecycle

A Lead that pauses calls `command_room_presence` with `park` and the latest checkpoint reference. Active WRITE work moves to WAITING and task-owned writer/resource leases are released. Use `leave` only when the session should become offline.

MAIN may pause, resume, archive, or rebind a room. Before archive, ensure work is terminal or deliberately preserved and all active agents are parked or offline.

## Non-goals

Never imply that Command Room:

- wakes ChatGPT tabs or creates sub-hour cloud schedules
- switches ChatGPT/Codex/Claude quota or makes usage unlimited
- bypasses permission, login, rate limit, writer lease, or confirmation
- trades, deploys Live, or launches MT5/VPS/browser/GPU work merely because a resource is reserved
- stores a shared-chat URL or transcript as continuity
