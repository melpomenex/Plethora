## Why

Shadowing can compare recognized text but cannot responsibly claim phonetic accuracy. Plethora needs a capability ladder that adds timing, rhythm, pronunciation-model, and phoneme feedback only when the configured provider supports it, while keeping uncertainty visible and avoiding fabricated certainty.

## What Changes

- Build pronunciation feedback on the shadowing attempt contract.
- Support levels from transcription match through word confidence, timing/rhythm, pronunciation-model score, and phoneme alignment.
- Show omitted/substituted words, stress/timing/fluency issues, and problematic phonemes only when supported.
- Add provider abstraction for local/cloud specialized models, score history, privacy, and active-practice recommendations.

## Dependencies

- Hard: profiles, processing, `add-language-shadowing-mode`, transcription/provider capability contract.
- Soft: audio alignment, analytics, SRS, writing/dictation.
- Does not change generic review grading or claim unsupported phonetic evaluation.

## Capabilities

### New Capabilities

- `language-pronunciation-feedback`: Capability ladder, provider scores, uncertainty, feedback display, history, and privacy.

### Modified Capabilities

- None; shadowing remains usable with transcription-only comparison.

## Impact

- Practice attempt/result schema, provider registry/settings, local/cloud model adapters, shadowing UI, active evidence/analytics, mobile/audio permissions, and tests for score validity.
