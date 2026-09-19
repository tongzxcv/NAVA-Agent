---
name: nava-windows-vps-ops
description: Operate and troubleshoot Windows workstations/VPS hosts through a consistent evidence-first runbook covering Tailscale/SSH/RDP reachability, services, processes, ports, event logs, startup, scheduled tasks, and application health. Use for remote Windows incidents or maintenance; prefer profile-based remote_ssh over GUI remoting.
---

# NAVA Windows VPS Ops

Diagnose from transport inward; mutate only the failing layer.

## Runbook

1. Establish host identity, intended role, and allowed scope. Prefer a named `remote_ssh` profile; never place passwords/private keys in prompts or logs.
2. Check in this order:
   - local/remote network reachability and Tailscale state;
   - TCP port/listener;
   - SSH or RDP service;
   - firewall/policy evidence;
   - account/session evidence;
   - process tree and application service;
   - startup/scheduled task;
   - Windows Event Log/crash context.
3. Correlate timestamps before changing anything.
4. Prefer `service_context`, `process_context`, `port_context`, `event_log_context`, `startup_context`, `crash_trace`, and bounded remote commands over screenshots.
5. For a repair, capture the current value/state first, apply the smallest reversible change, then verify the same layer plus one end-to-end application check.
6. Never reset multiple subsystems at once just to "see if it works".
7. Record host/profile, changed setting/service, before/after state, verification, and rollback.

## Safety

- Do not disable firewall/security controls broadly when a scoped rule/service fix is possible.
- Do not delete user data, account profiles, app state, or scheduled tasks without explicit authorization.
- Do not restart a production service/host merely because monitoring is stale; prove the fault first.
- Prefer command-line/SSH management; use RustDesk/RDP/Windows UI only when the task genuinely requires GUI state.
