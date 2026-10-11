---
name: nava-mt5-lab-operator
description: Operate MT5 research and tester runs safely and reproducibly: freeze the target, compile, allocate terminals, run durable batches, parse reports, compare against a declared baseline, classify the result, preserve evidence, and clean only owned artifacts. Use for long or repeated MT5/EA experiments; pair with ea-research-lab for research methodology and nava-live-production-guard before touching any installed terminal.
---

# NAVA MT5 Lab Operator

Turn an approved EA experiment into one reproducible tester execution without confusing terminals, accounts, baselines, or artifacts.

## Preconditions

1. Load `ea-research-lab` for hypothesis, scenario matrix, money-unit calibration, gates, and promotion policy.
2. Load `nava-live-production-guard` and fingerprint every MT5 target before any launch, restart, attach, AutoTrading change, file deploy, or tester run.
3. Record: project/workspace, terminal install path, data path, symbol, timeframe, dates, tick model, spread/slippage, deposit, leverage, EA/source/set hashes, baseline ID, and candidate ID.
4. Treat Live and Production as read-only unless the user separately authorizes that exact mutation.

## Execution

1. Prefer tester-only execution. Disable sound, visual mode, dashboards/comments, and other non-test UI when the project supports those switches.
2. For batches, reserve an MT5 resource through Command Room when available; otherwise verify no conflicting runner owns the chosen terminal.
3. Compile before testing and require zero compile errors. Keep the compile log or hash reference.
4. Use `shell operation=workflow` with `execution=background` before the first heavy step whenever duration may exceed about 30 seconds. Save the durable `task_id` in the project checkpoint/phase tracker.
5. Never tight-poll. Read one bounded status/log snapshot after meaningful progress, then collect the final result.
6. Parse every scenario into a structured row, including failure/timeout rows. Capture Net, PF, win rate, equity/balance DD, recovery, margin, trade/deal counts, and project-specific invariants.
7. Compare only calibrated like-for-like runs. Compute exact deltas from the declared baseline and flag trade/deal-count or lifecycle parity breaks separately from money metrics.
8. Classify only as `PROMOTE`, `REJECT`, or `NEEDS_MORE_EVIDENCE` according to predeclared gates. A tester win is not Live approval.
9. Persist the final matrix, hashes, runner/task IDs, verdict, and next action. Update the EA knowledge base when the finding is durable.
10. Clean only artifacts owned by the completed run. Preserve champion evidence, final summaries/matrices, referenced reports, active-run folders, and anything used by a commit/wiki decision.

## Failure Rules

- If a process may still be alive, inspect durable task/process state before retrying.
- Do not silently rerun a completed `scenario_id`.
- Do not change spread, data source, symbol suffix, deposit, leverage, or set values between baseline and candidate without declaring a new comparison class.
- Do not restart or close an unrelated MT5 instance to free capacity.
- If target identity is ambiguous, stop before mutation and report the conflicting fingerprints.
