---
name: nava-incident-autopsy
description: Build a root-cause timeline for NAVA 502/MCP tunnel failures, EPIPE, service crashes, stuck workers, poisoned request state, late responses, and recurring reconnect incidents, then prove the repair with regression/soak evidence. Use after or alongside nava-incident-doctor when the goal is root cause rather than immediate recovery.
---

# NAVA Incident Autopsy

Recovery is not root-cause closure.

## Relationship

Use `nava-incident-doctor` for immediate evidence collection and reversible recovery. This skill owns the deeper timeline, causal hypothesis, repair proof, and recurrence prevention.

## Workflow

1. Capture a `diagnostic_bundle_create` snapshot before restart/reinstall when possible.
2. Build a timestamped timeline from live logs, correlation IDs, task IDs, MCP recovery state, tunnel/service process evidence, event logs, and crash traces.
3. Separate:
   - user-visible symptom;
   - first internal fault;
   - propagation path;
   - recovery event;
   - latent state that could cause recurrence.
4. State competing root-cause hypotheses and falsifying evidence.
5. Mark status independently:
   - `SERVICE_RECOVERED`
   - `ROOT_CAUSE_IDENTIFIED`
   - `FIX_APPLIED`
   - `REGRESSION_PROVEN`
   - `SOAK_PROVEN`
6. Use `self_heal_plan` only for deterministic reversible repairs; code defects belong in the canonical NAVA repo with tests.
7. Add a regression test reproducing the actual failure mode when code changed.
8. Verify the affected path, then an unrelated small MCP path, then a bounded repeated/soak sequence if recurrence involved timing or stale state.
9. Record cause, fix, test names, relevant commit/hash, and remaining uncertainty.

## Rules

- A green health check after restart does not erase the incident.
- Do not call a fix permanent without a reproducer or equivalent regression evidence.
- Do not expose credentials, raw prompts, tokens, cookies, or unbounded logs in the autopsy.
