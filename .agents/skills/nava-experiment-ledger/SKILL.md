---
name: nava-experiment-ledger
description: Maintain a durable experiment genealogy so baselines, candidates, champions, rejects, hashes, exact deltas, scenario IDs, and promotion status cannot be confused or rerun accidentally. Use for iterative EA/ML/benchmark research with many branches.
---

# NAVA Experiment Ledger

Every experiment has an identity, parent, evidence, and terminal status.

## Required Record

For each experiment store a compact row/object with:

- project and experiment ID;
- parent/baseline ID;
- hypothesis/change summary;
- source/config/data hashes;
- environment class;
- scenario IDs;
- durable task/run IDs;
- primary metrics;
- exact deltas vs parent;
- invariant/parity results;
- verdict;
- evidence references;
- created/completed timestamps;
- superseded-by or next-action when applicable.

## Statuses

`PLANNED`, `RUNNING`, `PROMOTE`, `REJECT`, `NEEDS_MORE_EVIDENCE`, `SUPERSEDED`, `INVALID_RUN`.

## Workflow

1. Check the ledger before running. Do not rerun an identical fingerprint unless explicitly forced.
2. Freeze the baseline ID at experiment start.
3. New parameter/data/execution classes create a new child identity; never overwrite historical results.
4. Compute exact deltas against the declared parent, not "the latest file in the folder".
5. Champion status is explicit and unique per comparison class.
6. Preserve rejected branches with concise reason codes so failed ideas are not rediscovered repeatedly.
7. Link final evidence; keep raw heavy artifacts outside the source repo according to `ea-research-lab`.
8. Update the ledger atomically after the run reaches a terminal status.

## Integrity

If hashes, environment class, or baseline evidence are missing, the run cannot be promoted. Duplicate IDs or two champions in the same class are ledger errors that must be resolved before new promotion.
