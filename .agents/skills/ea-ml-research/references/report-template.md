# EA ML audit template

## Decision contract

- Target and horizon:
- Decision/feature availability time:
- Trading action and abstention rule:
- Baselines:

## Data lineage

| Dataset | Source/hash | Symbol/timezone | Window | Rows | Missing/duplicate policy |
|---|---|---|---|---:|---|

## Leakage audit

| Check | Pass/fail/unknown | Evidence | Required correction |
|---|---|---|---|

## Split and model contract

- Train/development/final holdout:
- Walk-forward folds and purge/embargo:
- Preprocessing fit scope:
- Model/version/seed/hyperparameters:
- Threshold and calibration method:

## Results

| Fold/window | Baseline | Model | Statistical metrics | Net trading metrics | DD/tail | Trades | Verdict |
|---|---|---|---|---|---|---:|---|

## Robustness and drift

| Test | Result | Evidence gap |
|---|---|---|

## Verdict

Use one: `ML_RESEARCH_PASS`, `ML_REJECTED`, or `ML_NEEDS_MORE_EVIDENCE`.

List the exact blockers to shadow, demo, or live use. Never collapse research pass into live approval.
