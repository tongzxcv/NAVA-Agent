---
name: nava-machine-bootstrap
description: Bootstrap a new Windows workstation or VPS for NAVA work by inventorying runtimes, paths, registered workspaces, SSH/Tailscale reachability, permissions, MT5 installs, browser/Office dependencies, and health before making scoped setup changes. Use for new machines, rebuilt VPS hosts, or environment migrations.
---

# NAVA Machine Bootstrap

Inventory first; install only what the intended workload requires.

## Discovery

1. Capture OS/build, CPU/RAM/disks, hostname, uptime, PATH, installed runtimes/package managers, browser, Office, Git, PowerShell, Python/Node, WSL, Tailscale, SSH client/server status, and relevant MT5 installs/data paths.
2. List registered NAVA workspaces and permission profile.
3. Test named SSH profiles without exposing key material.
4. Identify required workload classes: EA/MT5, frontend/browser, remote ops, Office/docs, ML/GPU, or general development.
5. Produce a gap matrix: `PRESENT`, `MISSING_REQUIRED`, `OPTIONAL`, `MISCONFIGURED`.

## Setup

1. Apply only required changes, one subsystem at a time.
2. Prefer existing package managers and native components over custom installers.
3. Record paths/versions and restart requirements.
4. Register project workspaces only after confirming the exact root.
5. For MT5, record each install path and corresponding data path separately; never assume numbering from a shortcut name.
6. Verify with one representative task per workload class.

## Handoff

Produce a machine profile containing non-secret paths, versions, SSH profile names, workspace IDs, known limitations, and rollback notes. Never persist passwords, private keys, auth tokens, or broker credentials.
