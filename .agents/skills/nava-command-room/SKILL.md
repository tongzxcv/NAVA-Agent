---
name: nava-command-room
description: Coordinate one NAVA MAIN chat and up to five reusable LEAD chats through the local Command Room broker. Use when work must continue across full chats, multiple projects, ChatGPT Project or normal chats, or a Codex participant; covers manual join, inbox acknowledgement, read-only task flow, checkpoint references, takeover/rebind, and clean parking. Do not use it to bypass writer leases, schedule browser wake-ups, or switch provider quotas.
---

# NAVA Command Room

Coordinate agents through bounded broker records. The Command Room stores summaries and references, not raw prompts, credentials, cookies, API keys, private keys, or large tool output.

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
2. If they are missing, enable the Command Room feature, refresh the NAVA connector, and retry in a new chat only if refresh does not update the manifest.
3. Treat every `agentSessionId`, join code, room ID, task ID, and idempotency key as opaque. Never paste them into durable notes or public messages.
4. Phase 1 is manual and local. It does not wake browser tabs, create 25-minute schedules, execute shared-resource queues, or change ChatGPT/Codex quota behavior.

## MAIN boot

Use `command_room_admin` with `action: "create"`, a stable safe idempotency key, and `leadSlots` from 1 to 5. Save the returned room ID only in the active chat context. Deliver each one-time join code privately to the intended chat.

Join the `MAIN` slot with `command_room_join`:

- provider is `CHATGPT`, `CODEX`, or `OTHER`
- first `connectionEpoch` is 1
- retain the returned `agentSessionId` only for the active session

Immediately call `command_room_presence` with `action: "heartbeat"`. Add bounded `projectKey`, `workspaceId`, and `lastCheckpointId` only when known.

## LEAD boot

Join the assigned `LEAD-1` through `LEAD-5` slot with its one-time code and required connection epoch. A chat may be inside or outside a ChatGPT Project; room identity comes from the manual slot, not the ChatGPT Project container.

After join:

1. Heartbeat with the current project and workspace references.
2. Read inbox from cursor 0 or the last acknowledged cursor, limit at most 50.
3. Acknowledge only through the highest sequence actually processed.
4. Read room status before claiming work.

Never send directly from one LEAD to another. Send questions, updates, results, and handoffs to `MAIN`, which routes the work.

## Inbox loop

At meaningful milestones and before parking:

1. Call `command_room_inbox` with `action: "read"`.
2. Process immutable messages in sequence order.
3. Call `command_room_inbox` with `action: "ack"` and `ackThrough` equal to the last processed sequence.
4. Use the returned cursor on the next read.

Do not tight-poll. Check after completing a bounded unit of work, when waiting for a decision, or when the user explicitly asks.

## Task flow

Phase 1 Command Room tasks must use `mutationMode: "READ_ONLY"`.

MAIN:

1. Assign with project, optional workspace, bounded brief, acceptance criteria, expected room version, and a new idempotency key.
2. Review submitted evidence.
3. Approve, reject, cancel, or request a bounded follow-up.

LEAD:

1. Claim the assigned task with the current task version.
2. Start it.
3. Heartbeat or wait with a reason when blocked.
4. Submit a bounded result with evidence references and optional checkpoint or durable-task ID.
5. Never claim another LEAD's task.

On a version conflict, read status again. Do not guess the new version or retry a mutation with a different meaning under the same idempotency key.

## Workspace writes and checkpoints

Command Room coordination never grants file-write authority. Before any workspace mutation, follow `nava-multi-chat-coordinator` and acquire or verify the one active writer lease for that workspace.

When a writer lease is active, persist a workspace checkpoint only through this exact wrapper:

```json
{
  "workspaceId": "<workspace-id>",
  "leaseId": "<lease-id>",
  "tool": "session_checkpoint",
  "arguments": {
    "projectKey": "<stable-project-key>",
    "summary": "<bounded milestone>",
    "boundaries": ["<preserved constraints>"],
    "evidenceRefs": ["<file, commit, test, or task reference>"],
    "nextAction": "<single concrete next action>"
  }
}
```

Call `workspace_lease_call` with only the four outer fields shown. Put every checkpoint field inside `arguments`. A resumed checkpoint is evidence to verify against current Git, workspace, task, and Obsidian state; it is not permission to mutate.

## Chat-full takeover

If a chat is full or lost:

1. MAIN calls `command_room_admin` with `action: "rebind"`, the target slot, current room version, and a new idempotency key.
2. Start a new chat and join with the new one-time code and returned required connection epoch.
3. The old session is revoked. Do not reuse it.
4. The new chat reads status and inbox, verifies checkpoint/Git/workspace evidence, acknowledges processed messages, and continues the assigned task.

If MAIN itself is replaced, use the same rebind flow for `MAIN`; do not create a duplicate room unless recovery of the existing room is impossible and the user explicitly chooses replacement.

## Messages

Use:

- `QUESTION` for a decision or missing input
- `UPDATE` for bounded progress
- `RESULT` for verified completion or rejection evidence
- `HANDOFF` for a precise continuation point

Each message needs a short subject, bounded summary, evidence references, optional next action, target slot, and unique idempotency key. Never paste full source trees, raw logs, prompts, or secrets.

## Parking and room lifecycle

A LEAD that finishes or pauses calls `command_room_presence` with `park` and its latest checkpoint reference. Use `leave` only when the current session should become offline.

MAIN may pause, resume, or archive the room with the current room version. Before archiving, ensure tasks are terminal or deliberately preserved and all active agents have parked or left.

`command_room_resource` is status-only in Phase 1. Coordinate MT5, VPS, browser, GPU, and other shared resources manually; do not imply that NAVA scheduled or reserved them.
