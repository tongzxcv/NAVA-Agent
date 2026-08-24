---
name: nava-incident-doctor
description: Diagnose NAVA Desktop, MCP stdio, Secure Tunnel, EPIPE, ExceptionGroup, timeout, and stuck-task incidents from bounded redacted evidence. Use before restarting, reinstalling, or changing a live NAVA configuration.
---

# NAVA Incident Doctor

Diagnose first and preserve the running user's state.

## Workflow

1. Call `diagnostic_bundle_create` with the affected workspace ID when known.
2. Classify the failure as input/permission, workspace lease, oversized response, process timeout, optional dependency, MCP transport, Tunnel, or Desktop main-process failure.
3. Correlate timestamps and task IDs. Do not treat a later healthy check as proof that the reported incident never happened.
4. Call `self_heal_plan` only after evidence identifies a recoverable condition.
5. Present the plan before any mutation. Use `self_heal_apply`, process cancellation, restart, reinstall, or configuration changes only after explicit authorization.
6. Verify the smallest affected path, then run one unrelated small MCP call to prove the shared session survived.

## Retry rules

- Retry only transient failures, with a bounded attempt count and increasing delay.
- Do not retry permission, invalid-input, secret-policy, or destructive-confirmation failures.
- Do not automatically repeat a tool whose underlying operation may still be finishing; check task/process status first.
- Never print Runtime API keys, bearer tokens, environment secrets, full prompts, or unbounded logs.
