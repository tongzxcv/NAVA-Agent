---
name: nava-live-production-guard
description: Hard guardrail for MT5 Live/Production operations. Fingerprint the exact terminal, data path, account/server, symbol, EA version/hash, magic, AutoTrading state, and project policy before any risky action; fail closed on ambiguity. Use before launching, restarting, attaching, deploying, enabling trading, changing presets, or otherwise mutating an MT5 terminal.
---

# NAVA Live Production Guard

Never infer which MT5 instance is safe to touch.

## Fingerprint First

Before a risky MT5 action, capture as many of these as the environment exposes:

- terminal executable/install path and PID;
- MetaQuotes data path;
- account login identifier (redacted if reported), broker/server, REAL/DEMO/TESTER;
- balance/equity denomination;
- chart symbol/timeframe;
- EA name/version/source-or-EX5 hash;
- magic number(s);
- AutoTrading state and session/trade state;
- project profile/checkpoint boundaries such as `PRODUCTION FROZEN`, `TRADE OFF`, `TESTER ONLY`, or `CHALLENGER NOT PROMOTED`.

Present one compact identity line before mutation, for example:
`TARGET = MT5(7) / REAL / RATCHET V1.14 / TRADE OFF`.

## Decision

- `SAFE_READ`: observation only.
- `SAFE_TESTER`: isolated tester action with no Live mutation.
- `CONFIRM_REQUIRED`: exact target is known but the action affects Live/Production state.
- `BLOCKED_AMBIGUOUS`: identity, ownership, account class, or policy conflicts.
- `BLOCKED_POLICY`: action violates an explicit frozen/Trade-Off/no-restart/no-deploy boundary.

Fail closed on any ambiguity.

## Mutation Rules

1. Do not use a tester result as authority to modify Production.
2. Do not enable AutoTrading, attach an EA, change a Live preset, restart/close Live MT5, or deploy a Production EX5 unless the user explicitly authorized that exact class of action.
3. Re-fingerprint after restart, login change, terminal update, profile switch, or executable/data-path mismatch.
4. Preserve symbol suffix, account mode, magic ownership, and risk controls unless separately authorized.
5. If multiple terminals are open, match both install path and data path; window title alone is insufficient.
6. When the user says "research", "test", "offline", or equivalent, default to TESTER-only and keep Live untouched.
