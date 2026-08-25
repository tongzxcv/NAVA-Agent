---
name: ea-forensics
description: Reconstruct and audit Forex/MT4/MT5 EA trading logic from authorized source code, settings, logs, tester reports, or controlled black-box behavior. Use for reverse engineering, entry/exit logic extraction, EX5 behavior inference, architecture mapping, and source-versus-runtime contradictions; never use to bypass licenses or claim recovered source from a binary.
---

# EA Forensics

Reconstruct what an EA does while keeping observed facts separate from inference.

## Select the mode

- **White-box:** `.mq4`, `.mq5`, `.mqh`, Python, or other source is available.
- **Gray-box:** partial source plus EX4/EX5, inputs, logs, or tester evidence is available.
- **Black-box:** only an authorized binary and observable behavior are available.

Read [references/modes-and-evidence.md](references/modes-and-evidence.md) before gray-box or black-box work. Use [references/report-template.md](references/report-template.md) for the final evidence map.

## Workflow

1. Confirm the user owns the target or is authorized to analyze it. Record the exact target path, SHA256, version, and allowed scope.
2. Consult `D:\EA\EA_Knowledge_Base\wiki\index.md`, `wiki\log.md`, and the relevant project page before broad source reads.
3. Freeze the environment needed to reproduce behavior: EA hash, `.set`, symbol and broker suffix, timeframe, dates, tick model, spread/slippage, currency, deposit, leverage, and account mode.
4. Build the logic map:
   - inputs and defaults;
   - event handlers and orchestration;
   - signal, filter, entry, exit, recovery, lot/risk, and order-management paths;
   - symbol/magic ownership, session/news gates, persistence, external files/services, and failure behavior.
5. Attach evidence to every claim. Use only these labels: `PROVEN_SOURCE`, `PROVEN_RUNTIME`, `SUPPORTED_INFERENCE`, `CONTRADICTED`, or `UNKNOWN`.
6. For inferred rules, state confidence, competing explanations, and the smallest experiment that could falsify the claim.
7. Validate source claims by compile/static checks and behavior claims through controlled MT5 experiments. Route batch validation to `ea-research-lab`; keep heavy evidence under `E:\AI_CACHE\mt5-backtests`.
8. For a claimed UI-only, input-only, or refactor-only change, freeze the allowed scope and compare before/after trade-critical functions, defaults, state ownership, and a boundary-equivalence probe. Compilation or structural equality alone is not runtime parity; record any unrun native test explicitly.
9. When input identifiers or serialization change, require a new preset plus a migration note; do not assume an old `.set` maps safely.
10. Update the relevant Obsidian project page when findings are durable. Never promote a strategy or alter production from forensic evidence alone.

## Tool routing

- Discover the registered project with `workspace_list` and keep all reads inside its workspace boundary.
- Use `workspace_context`, `search_files`, `read_many_files`, Git tools, hashes, and bounded shell tasks for evidence collection.
- Prefer logs, tester reports, deal/order history, and controlled input changes over screenshots or narrative recollection.
- For VPS evidence, use the existing profile-based `remote_ssh` capability with bounded read-only commands; record the remote path, timestamp, and artifact hash without copying credentials into prompts or reports.
- Use writer leases before changing a shared workspace. Forensics is read-only by default.

## Hard boundaries

- Do not decompile or crack protected EX4/EX5 binaries, bypass licenses/account binding, remove broker controls, or defeat access protections.
- Do not describe inferred pseudocode as recovered source.
- Do not infer profitability, safety, or live readiness from architecture or one backtest window.
- Do not modify the original target during analysis. Use an isolated lab for probes or instrumentation.
- Preserve Magic Number, symbol ownership, risk controls, and live/production boundaries unless the user separately authorizes a change.
