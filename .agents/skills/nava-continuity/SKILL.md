---
name: nava-continuity
description: >-
  Continue a NAVA project after a ChatGPT chat is full or a run ends unexpectedly. Use for long tasks, new-chat continuation, resume/continue requests, chat-full incidents, project handoffs, or work spanning multiple chats. Creates bounded project-scoped rolling checkpoints and verifies them against current workspace evidence before continuing.
---

# NAVA Continuity

Keep the latest useful project state outside the conversation. Do not wait for a
chat-full warning.

## Stable project identity

1. Call `workspace_list` and select the exact registered workspace.
2. Build `projectKey` from the registered project name: lowercase it, replace
   spaces with hyphens, and keep it stable across chats. If names collide, append
   the first eight characters of the workspace ID.
3. Store the exact `workspaceId` in every checkpoint.

## Resume in a new chat

1. Call `session_resume` with the stable `projectKey` before broad source reads.
2. If no checkpoint exists, inspect the workspace and create the first one.
3. Verify the returned checkpoint against current `git_status`, relevant durable
   task status, and the project's Obsidian page or phase tracker when present.
4. State any contradiction or stale item. Continue from `nextAction` only after
   the verification agrees.
5. Before the first mutation, follow `nava-multi-chat-coordinator` and acquire the
   workspace writer lease. If that skill is not discoverable, do not stop when
   the lease tools are available: use the direct fallback below.

## Writer-lease fallback

When `nava-multi-chat-coordinator` cannot be loaded, call the NAVA tools
directly:

1. Call `workspace_lease_status` for the exact workspace ID.
2. Call `workspace_lease_acquire` with a short owner label and a 15-minute TTL.
3. Run every non-read workspace tool through `workspace_lease_call` using the
   returned lease ID. The outer object must contain only `workspaceId`,
   `leaseId`, `tool`, and `arguments`; put every child-tool field inside
   `arguments`. Never use `operation` or `name` instead of `tool`. Keep the
   child tool's normal confirmation requirements.
4. Call `workspace_lease_renew` before expiry during long foreground work.
5. Call `workspace_lease_release` during finalization, including after partial
   failure. If the chat ends unexpectedly, let the lease expire.

Stop before mutation only when the lease tools themselves are unavailable or
another active writer owns the workspace. Never bypass the lease with direct
shell, file, Git, or child-MCP mutations.

The user can normally start a replacement chat with:

```text
ใช้ NAVA ทำงานต่อโปรเจกต์ BEELZEBUB จาก checkpoint ล่าสุด ตรวจ Git และ Obsidian ก่อน แล้วทำขั้นถัดไป
```

## Save rolling checkpoints

Call `session_checkpoint`:

- before a long/background operation;
- after a meaningful file change plus its verification;
- after a commit or decision;
- when a blocker/error changes the next action;
- before yielding control or whenever the task changes phase.

Use this bounded shape:

```json
{
  "projectKey": "beelzebub-ea",
  "workspaceId": "registered-workspace-id",
  "objective": "Current outcome being pursued",
  "phase": "Current phase",
  "completed": ["Verified milestone"],
  "files": ["Important relative path or commit ID"],
  "verification": ["Test command and result"],
  "blockers": ["Current blocker or pending evidence"],
  "boundaries": ["Do not touch Live"],
  "nextAction": "One concrete next action"
}
```

Rewrite the project state as facts change. The runtime keeps bounded history and
`session_resume` selects the latest checkpoint for that project.

## Safety

- Never store prompts, chat transcripts, credentials, API keys, private keys,
  `.env` values, raw file content, screenshots, or large logs.
- Record paths, hashes, commits, task IDs, test names, and concise verdicts.
- A checkpoint is memory, not authority. Recheck permissions, destructive
  confirmation, workspace boundaries, and trading promotion gates.
- A checkpoint is not proof. Prefer current Git/runtime/Obsidian evidence when
  it contradicts saved text.
