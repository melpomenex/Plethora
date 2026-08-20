## Context

Shadowing establishes source sentence, learner recording, STT text, timing, and confidence. Specialized pronunciation providers vary substantially by language and model capability, so feedback must be capability-negotiated rather than one universal score.

## Dependencies

- Hard: #1, #2, #19, and transcription/provider capability contracts.
- Soft: #13, #9, and #11.
- Must consume #19 attempts and never add unsupported phoneme scoring; coordinate practice-result schema before implementation.

## Goals / Non-Goals

**Goals:**

- Give useful, calibrated feedback at the highest supported level.
- Preserve raw attempt/provider/version and uncertainty for audit/history.
- Let local/cloud providers coexist and degrade to transcription match.

**Non-Goals:**

- Fabricated phoneme scores, universal accent judgments, or human-tutor replacement.
- Blocking shadowing when pronunciation model is unavailable.

## Decisions

1. **Capability ladder.** Levels are `transcription_match`, `word_confidence`, `timing_rhythm`, `pronunciation_model`, `phoneme_alignment`; a provider advertises supported languages/levels and returns evidence.
2. **Typed feedback with uncertainty.** Each issue includes category, span/time, score/confidence, provider/model/version, and `approximate/unsupported` status. UI never presents absent dimensions as zero.
3. **Raw attempt plus derived result.** Keep recording/recognized text according to shadowing retention; store derived result separately so provider/model upgrades can re-score with consent.
4. **No scheduler coupling.** Feedback can add active evidence or suggest practice, but review rating/rescheduling requires existing explicit flows.
5. **Privacy ladder.** Local model is preferred where configured; cloud specialized scoring requires consent, bounded audio, disclosure, and deletion/retention controls.

## Risks / Trade-offs

- [Scores differ by language/model] → Show provider/capability and avoid cross-language score comparisons.
- [False phoneme certainty] → Hard validation of provider capabilities and confidence; hide unsupported fields.
- [Audio privacy] → Local-first, explicit upload, minimal retention, delete/export.
- [Provider unavailable] → Fall back to shadowing transcription/timing or listen-only.

## Migration Plan

1. Consume shadowing results at transcription-match level.
2. Add timing/word confidence where existing data supports it.
3. Add specialized pronunciation/phoneme adapters and UI only after capability evidence tests.

## Open Questions

- Which specialized providers/models can be supported under current credentials architecture.
- Whether timing/rhythm can be derived locally without a pronunciation model.
- How to explain accent/register differences without normative scoring.
