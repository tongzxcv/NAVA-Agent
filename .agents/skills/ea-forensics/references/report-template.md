# EA forensic report template

## Target and authorization

- Target/version/hash:
- Owner or authorization basis:
- Mode: white-box / gray-box / black-box
- Read-only source and isolated lab paths:

## Reproduction contract

- Symbol/broker/account:
- Timeframe/date/tick model:
- Deposit/currency/leverage:
- Set file and SHA256:
- Costs and execution assumptions:

## Architecture map

| Area | Behavior | Evidence label | Source/run evidence | Confidence | Unknowns |
|---|---|---|---|---|---|
| Signal | | | | | |
| Filters | | | | | |
| Entry | | | | | |
| Exit | | | | | |
| Risk/lot | | | | | |
| Recovery | | | | | |
| Execution | | | | | |
| Persistence | | | | | |

## Contradictions and hazards

| Claim or expected rule | Conflicting evidence | Impact | Next falsifying test |
|---|---|---|---|

## Change boundary and parity

- Declared change scope:
- Protected trade-critical paths:
- Input or `.set` migration required:

| Before/after check | Evidence | Result | Native test still required |
|---|---|---|---|
| Trade-critical functions | | | |
| Session/input equivalence | | | |
| Compile/static checks | | | |
| Tester/runtime behavior | | | |

## Verdict

Use one: `LOGIC_MAPPED`, `PARTIAL_INFERENCE`, `CONTRADICTED`, or `INSUFFICIENT_EVIDENCE`.

State explicitly that this is not profitability or live-readiness approval.
