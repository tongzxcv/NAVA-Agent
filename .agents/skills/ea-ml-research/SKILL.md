---
name: ea-ml-research
description: Design or audit ML/AI components for Forex and MT5 EAs with time-series leakage controls, feature provenance, walk-forward validation, calibration, trading-cost evidence, drift checks, and human promotion gates. Use for classifiers, regressors, regime models, neural networks, reinforcement learning, or LLM-assisted trading research; not for ordinary rule-only EA edits.
---

# EA ML Research

Treat an ML result as a time-ordered experiment, not as a high backtest score.

Read [references/validation-gates.md](references/validation-gates.md) before training or accepting a model. Use [references/report-template.md](references/report-template.md) for the final audit.

## Workflow

1. Define the decision being predicted, target formula, prediction horizon, decision timestamp, and when every feature becomes available in live trading.
2. Record dataset provenance: symbol, broker, timezone, timeframe, date range, tick/bar source, missing-data policy, spread/commission/swap/slippage, and all preprocessing versions.
3. Establish rule-based and no-skill baselines before selecting a complex model.
4. Audit leakage before training: future-derived features, centered windows, target proxies, duplicated rows, train/test overlap, global normalization, feature selection on holdout data, and cached labels.
5. Use chronological train/development/holdout partitions or rolling/anchored walk-forward validation. Keep one final holdout untouched until the design is frozen.
6. Fit scalers, encoders, selectors, thresholds, and calibration only on the training portion of each fold.
7. Compare the smallest adequate model first. Add neural networks, reinforcement learning, or LLM decisions only when simpler baselines measurably fail and the added uncertainty is testable.
8. Separate discovery from confirmation. Freeze and preregister the candidate formula, exclusions, metrics, sample start, and review/promotion gates before reading fresh forward outcomes.
9. Translate predictions into trading decisions with frozen thresholds, abstention rules, turnover limits, costs, latency, and broker constraints.
10. Evaluate statistical quality and trading behavior separately. Route native MT5 execution validation to `ea-research-lab` and calibrate account/tester money units before trusting money metrics.
11. Keep the live baseline unchanged while candidates run in shadow or recommendation-only mode. Reject candidates that fail validation even when their discovery score looked attractive.
12. Require explicit human promotion after the preregistered forward gate; never let training output silently replace a live model or EA rule.

## Model-specific boundaries

- **Supervised models:** report class balance, calibration, threshold sensitivity, and fold dispersion; accuracy alone is insufficient.
- **Regime/unsupervised models:** prove cluster stability and causal feature availability; post-hoc names such as trend/range are hypotheses.
- **Neural networks:** preserve seeds, architecture, checkpoints, and training logs; compare against linear/tree baselines.
- **Reinforcement learning:** prove simulator fidelity, cost model, action timing, reward construction, and no access to future state.
- **LLM/agent decisions:** pin model/version and prompt, require structured outputs, replay the same evidence set, and keep direct live execution disabled.

## Hard boundaries

- Do not use random row splits as promotion evidence for market time series.
- Do not tune on the final holdout, hide failed folds, or select a model from one lucky date window.
- Do not report tester profit as calibrated account money when contract/money units are unknown.
- Do not claim an ML model learned market causality from correlation or feature importance.
- Do not enable live trading, automatic retraining, or automatic model promotion without separate explicit authorization and forward evidence.
