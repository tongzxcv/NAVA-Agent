---
name: research-to-lab-bridge
description: Convert an external or Deep Research report into falsifiable local experiments without treating citations or narrative claims as tested truth. Use when research is done in a separate chat/tool and NAVA must turn it into an EA/software test matrix, reproduce claims, or decide what evidence is still missing.
---

# Research to Lab Bridge

External research proposes hypotheses; the local lab decides what survives testing.

## Input Contract

Accept a report, citation list, paper notes, strategy description, or user summary. Preserve source attribution and date. Label every imported claim `EXTERNAL_CLAIM` until locally verified.

## Workflow

1. Extract atomic claims: mechanism, expected effect, assumptions, population/market, timeframe, parameters, and reported metric.
2. Classify each claim as:
   - directly testable;
   - needs data not yet available;
   - background/context only;
   - unsafe/invalid to operationalize.
3. Convert testable claims into a falsification matrix: baseline, candidate change, frozen variables, dataset/date split, metric, minimum evidence, and rejection criterion.
4. Identify leakage/overfit risks and differences between the source population and the user's environment.
5. For EA work, hand execution to `ea-research-lab` and `nava-mt5-lab-operator`; for ML, also use `ea-ml-research`.
6. Keep source-reported numbers separate from locally measured numbers.
7. After testing, map each claim to `REPRODUCED`, `NOT_REPRODUCED`, `INCONCLUSIVE`, or `NOT_TESTED`.
8. Update durable project knowledge with the local result and source reference, not the external claim alone.

## Rules

- Do not promote Production from literature or web research alone.
- Do not tune repeatedly on the final/OOS window to force agreement with a source.
- Do not silently change the source claim's timeframe, instrument, spread, or execution assumptions.
