---
name: nava-multi-chat-coordinator
description: Coordinate NAVA work across multiple chats or agents so reads can run concurrently while workspace mutations use an expiring writer lease. Use when two or more chats may inspect or change local projects at the same time.
---

# NAVA Multi-Chat Coordinator

Keep different projects independent and prevent two chats from mutating the same workspace concurrently.

## Workflow

1. Call `workspace_list` and use the exact registered workspace ID.
2. If this chat continues earlier work, use `nava-continuity` and call `session_resume` for the project before broad reads.
3. For read-only work, proceed normally; no lease is needed.
4. Before the first mutation, call `workspace_lease_status`.
5. Acquire with `workspace_lease_acquire`, using a short owner label that identifies the chat and task. Default to 15 minutes unless a longer foreground operation is already known.
6. Run each non-read tool through `workspace_lease_call`. Keep the child tool's normal arguments, permission checks, and `userConfirmed` requirement.
7. Renew before expiry during long work. Prefer durable background tasks rather than holding one long MCP request.
8. Save a rolling `session_checkpoint` after milestones and before long operations.
9. Release in a finalization step even after partial failure. If the chat crashes, let the lease expire; never delete lease state manually.

## Collision handling

- Different workspaces: continue independently.
- Same workspace, reads only: continue concurrently.
- Same workspace, another active writer: report its owner and expiry, then wait or ask that owner to release.
- Never bypass a lease through unscoped shell commands, a child MCP, or direct file/Git tools.

The lease is coordination, not authorization. It does not grant permissions or replace destructive-operation confirmation.
