---
name: nava-video-forensics
description: Perform evidence-first video and frame forensics for UI/chart/trading recordings. Use for BreakBlock/TFB/zone geometry, object construction, cursor/selection state, candle anchors, temporal changes, screen transforms, or any claim that must be proven from frames rather than narrative recollection.
---

# NAVA Video Forensics

Separate visible facts from geometric inference and semantic claims.

## Evidence Labels

Use only:
- `FACT`: directly visible or mechanically measured.
- `SUPPORTED`: best explanation with stated confidence.
- `AMBIGUOUS`: competing explanations remain.
- `DISPROVED`: the tested claim conflicts with evidence.

## Workflow

1. Record source file/hash, resolution, frame rate, relevant timestamps, and whether the video was re-encoded.
2. Extract only bounded windows needed for the question. Preserve exact timestamps/frame numbers.
3. Identify stationary windows before comparing screen coordinates across time.
4. Detect and compensate chart pan/zoom/scale changes. Never compare raw screen Y across a transform as if it were the same price.
5. Separate object geometry from UI chrome: selection handles, mouse guides, measurement tools, crosshairs, subtitles, overlays, and dialog borders are not price anchors by default.
6. Use temporal persistence: compare pre-onset, onset, and post-onset frames; temporal median/difference is stronger than one screenshot.
7. Map candidate edges to candle bodies/wicks only when the anchor is unique. Record competing candles when not unique.
8. For every semantic claim such as "this rectangle is the BreakBlock" or "this line is SL", state the smallest observation that would falsify it.
9. Keep a frame-evidence table with timestamp, region/bounds, observation, transform state, label, confidence, and contradiction notes.
10. Promote no canonical geometry rule from an ambiguous clip. Preserve the current canonical rule until independent evidence resolves it.

## Hard Rules

- Selection handles are never price anchors by themselves.
- A visually similar color is not semantic identity.
- OCR/text can support semantics but does not prove geometry.
- Screen pixels become price relationships only after chart transform/scale is accounted for.
- Do not average contradictory frames into false certainty.
