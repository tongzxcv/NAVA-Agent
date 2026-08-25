# EA ML validation gates

## 1. Dataset contract

- Stable row identity and strictly defined timestamp semantics.
- Feature availability time is no later than the decision time.
- Target window starts after the decision and excludes execution data unavailable at entry.
- Duplicates, gaps, symbol changes, DST/timezone shifts, rollovers, and broker suffixes are documented.
- Raw data and generated features have hashes or immutable manifests.

## 2. Leakage gate

Reject promotion when any of these is unresolved:

- future prices, future extrema, centered filters, negative shifts, or full-window labels appear in features;
- scaler, encoder, selector, PCA, imputer, or threshold was fitted before splitting;
- overlapping event horizons cross train/test boundaries without purge/embargo;
- duplicated timestamps/rows or cached artifacts appear in multiple partitions;
- feature engineering or model selection used the final holdout.

## 3. Validation design

- Use chronological folds with an expanding or rolling training window.
- Add purge/embargo when target horizons overlap.
- Report every fold, including failed and zero-trade folds.
- Keep a final untouched holdout and a later forward/shadow period.
- Compare against no-skill, persistence, and existing-rule baselines.

## 4. Metrics

Statistical metrics depend on the target but should include calibration and fold dispersion. Trading metrics must include costs, turnover, trade count, drawdown, tail loss, consecutive losses, execution rejects, and threshold sensitivity.

For imbalanced classification, prefer precision/recall, PR-AUC, balanced metrics, calibration error/Brier score, and decision-curve value over raw accuracy. For regression, report error by regime and whether directional/threshold decisions survive costs.

## 5. Robustness and drift

- Vary spread, slippage, latency, threshold, seed, and nearby date boundaries.
- Check performance by year, session, volatility, direction, symbol, and broker contract where relevant.
- Record feature-distribution, missingness, calibration, prediction-rate, and outcome drift.
- Define retraining triggers and a rollback target before deployment.

## 6. Promotion gate

Allowed verdicts:

- `ML_RESEARCH_PASS`: methodology and evidence gates pass; not live approval.
- `ML_REJECTED`: leakage, instability, cost failure, or baseline underperformance is proven.
- `ML_NEEDS_MORE_EVIDENCE`: required native, holdout, calibration, or forward evidence is missing.

Live promotion requires a separate explicit decision after native execution and forward/shadow evidence.
