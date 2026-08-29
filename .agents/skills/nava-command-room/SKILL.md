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
2. If tools or schemas are stale, refresh the NAVA connector. Open a new chat only if refresh does not update the manifest.
3. Treat room, task, join-code, session, idempotency, writer-lease, and resource-lease values as opaque.
4. Command Room does not grant permissions. Every mutation still obeys the active NAVA permission profile, workspace boundary, human confirmation, and destructive-action policy.

## Join and boot

MAIN creates a room with `command_room_admin`, a stable idempotency key, and one to five Lead slots. Deliver each one-time join code privately.

Each chat joins its assigned slot with `command_room_join`:

- provider is `CHATGPT`, `CODEX`, or `OTHER`
- first `connectionEpoch` is 1
- keep the returned `agentSessionId` only in active chat context

Immediately send `command_room_presence` heartbeat with bounded project, workspace, and checkpoint references when known. Room identity comes from the slot and room ID, not from the ChatGPT Project container.

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
3. The old session is revoked.
4. The new chat reads status and inbox, verifies checkpoint/Git/workspace evidence, acknowledges processed messages, and continues.

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
