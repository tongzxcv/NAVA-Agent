---
name: nava-maintenance-doctor
description: Audit NAVA itself for skill drift, duplicate/out-of-sync skill roots, stale tool schemas, MCP health, durable-task debris, cache/index problems, hook drift, recovery state, and repository/runtime version mismatch. Use periodically or when NAVA behavior differs across chats after upgrades.
---

# NAVA Maintenance Doctor

Detect drift before it becomes an incident.

## Audit

1. Compare canonical NAVA repo version/commit with the running Desktop/MCP/runtime version when exposed.
2. Check MCP health/recovery and recent bounded failures.
3. Enumerate local skills by source. Detect:
   - duplicate names with different content;
   - canonical skills missing from global roots;
   - stale global copies;
   - unexpected shadowing/order differences.
4. Inspect tool schema/catalog metadata for stale or incompatible descriptors.
5. Review durable tasks/processes for abandoned `RUNNING` or `termination_unverified` state.
6. Review workspace indexes/watchers, cache telemetry, lifecycle hooks, and recovery status.
7. Run secret/artifact hygiene checks before any repo commit.
8. Classify findings:
   - `HEALTHY`
   - `DRIFT`
   - `STALE_SCHEMA`
   - `ORPHAN_TASK`
   - `INDEX_CACHE_ISSUE`
   - `MCP_RECOVERY_ISSUE`
   - `ACTION_REQUIRED`.

## Repair

- Use `self_heal_plan` for reversible runtime recovery.
- Synchronize skill copies from one declared canonical source; never merge conflicting copies silently.
- Clear/invalidate only safe caches when evidence points to cache/index corruption.
- Do not restart/reinstall as a generic maintenance step.
- After repair, verify skill discovery, one small MCP call, and any previously failing path.

## Reporting

Report what was checked, drift found, changes applied, verification, and remaining manual actions. A maintenance pass must not alter EA Live/Production workspaces.
