## Context

Proficiency estimation and voice conversation are P2 capabilities that must never delay core P0/P1 stabilization or misrepresent internal estimates as accredited CEFR exams.

## Goals / Non-Goals

**Goals:**
- Estimate separate 6-dimension learner ranges with explicit confidence/uncertainty intervals.
- Provide turn-based spoken conversation only when real STT + AI + TTS capabilities are present.

**Non-Goals:**
- Issuing accredited CEFR certificates or collapsing distinct skills into a single unsupported score.
- Faking voice conversation with a text-only UI.

## Decisions

1. **Explicit uncertainty.** Every placement/adaptive result carries `{ minBand, maxBand, confidence, sampleCount, disclaimer }` per skill dimension.
2. **Strict voice gating.** Require real `shadowingProviders.length > 0` + `isAnyAiAvailable()` + explicit cloud consent when STT/AI runs off-device.

## Risks / Trade-offs

- [Sparse sample sizes] -> Return `"insufficient-evidence"` until minimum items per dimension are answered.
