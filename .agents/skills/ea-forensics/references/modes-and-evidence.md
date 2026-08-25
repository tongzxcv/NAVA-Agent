# Forensic modes and evidence

## White-box extraction

Map each claim to exact files and lines. Trace the path from event handler to decision and side effect.

Minimum map:

- inputs, constants, globals, persistent state, and external dependencies;
- `OnInit`, `OnTick`, `OnTimer`, `OnTradeTransaction`, `OnDeinit`, and custom dispatchers;
- indicator handles/buffers, bar selection, shift/index semantics, and timeframe conversions;
- signal construction, confirmation, veto filters, duplicate-entry guards, and expiry;
- lot sizing, stop/target calculations, margin/stops/freeze checks, deviation, fill mode, and Magic Number filtering;
- pending lifecycle, partial fill, close/modify retry, breakeven, trailing, basket/recovery, and restart recovery;
- logs, files, network calls, DLLs, Python/ZeroMQ bridges, licensing, and fail-open/fail-closed behavior.

Mark dead code, unreachable branches, duplicated state, contradictory gates, implicit broker assumptions, and anything whose behavior depends on cached MT5 inputs.

## Gray-box and black-box inference

Do not claim source recovery. Infer only observable rules.

Freeze the binary hash and full tester contract. Change one independent variable at a time and collect a control plus counterexample. Useful probes include:

- signal candle shape, indicator threshold, bar shift, timeframe, and session boundary;
- spread, stops/freeze level, tick value, volume step, margin, and filling mode;
- restart, reconnect, partial fill, rejected order, missing dependency, and stale pending state;
- position count, symbol/magic ownership, opposite-side exposure, floating P/L, and equity state.

For each candidate rule record:

| Field | Meaning |
|---|---|
| Observation | What the runtime actually did |
| Hypothesis | The smallest rule consistent with it |
| Alternatives | Other rules that produce the same behavior |
| Confidence | Low, medium, or high |
| Falsifier | A specific controlled case that would disprove it |
| Evidence | Hash, input set, run ID, log/report rows, and timestamps |

One matching event is low confidence. Repeated behavior across changed dates is not independent evidence if the same market pattern drives every case.

## Evidence grades

- `PROVEN_SOURCE`: exact source path and line range proves the claim.
- `PROVEN_RUNTIME`: deterministic native execution evidence proves the observable behavior.
- `SUPPORTED_INFERENCE`: multiple controlled observations support the rule, but implementation is unknown.
- `CONTRADICTED`: reliable evidence conflicts with the claim.
- `UNKNOWN`: evidence is missing, ambiguous, or uncalibrated.

Static metadata, strings, imports, or binary hashes can identify dependencies and provenance; they cannot prove internal strategy logic.
