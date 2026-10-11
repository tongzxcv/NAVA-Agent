---
name: nava-long-run-orchestrator
description: Run long NAVA jobs reliably across MCP/chat time limits using durable background workflows, checkpoints, bounded status reads, resume, and completion notification. Use for MT5 batches, builds, research pipelines, remote jobs, large scans, packaging, or anything likely to exceed about 30 seconds or have uncertain duration.
---

# NAVA Long-Run Orchestrator

Long work must survive the current tool call and chat turn.

## Pattern

`PLAN -> CHECKPOINT -> DURABLE START -> RECORD TASK_ID -> YIELD SAFELY -> RESUME -> COLLECT -> VERIFY -> CHECKPOINT -> NOTIFY`

## Workflow

1. Split the job into deterministic stages before starting the first heavy stage.
2. Save a `session_checkpoint` containing objective, boundaries, completed work, durable task IDs, expected artifacts, and one concrete next action.
3. Use `shell operation=workflow execution=background`, `wsl_exec ... execution=background`, or `remote_ssh ... execution=background` as appropriate. Do not start a foreground process first and convert later.
4. Record every returned task ID immediately in the tracker/checkpoint.
5. Do not tight-poll. Use status/logs only at meaningful milestones or when the user asks.
6. On resume, verify current Git/workspace evidence and task state before continuing.
7. Classify a run as `RUNNING`, `COMPLETED`, `FAILED`, `TIMED_OUT`, `CANCELLED`, `STALLED`, or `TERMINATION_UNVERIFIED`.
8. For a failure, preserve stdout/stderr tail, exit code, stage ID, and artifacts before deciding whether a retry is safe.
9. Retry only idempotent/transient stages. Never automatically repeat a mutation whose completion is uncertain.
10. After completion, collect final result, run the smallest relevant verification, update the checkpoint, and use `notification` when a long task finishing is user-relevant.

## Recovery

- If the chat/tool call ends but the durable task survives, resume by task ID rather than restarting.
- If a task is missing, inspect process/recovery/live-log evidence before declaring it lost.
- If the terminal state is `termination_unverified`, do not launch a duplicate heavy job until ownership is resolved.
- Release writer/resource leases once the stage no longer needs them.
