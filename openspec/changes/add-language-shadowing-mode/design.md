## Context

The app has TTS provider adapters, local/cloud transcription, transcript timing, audio capture/navigation utilities, and mobile presentation contexts. Shadowing needs a small practice session layer that references source media/sentence rather than duplicating it.

## Dependencies

- Hard: #1, #2, #8/audio playback, and existing transcription/provider contracts.
- Soft: #13, #14, #15, and #21.
- Freeze `PracticeAttempt`, recording policy, source/media resolver, and comparison result before #20/#21/#22 share practice storage.

## Goals / Non-Goals

**Goals:**

- Provide a repeatable listen/speak/compare loop with transparent limitations.
- Store minimal practice metadata and expose consent/local-processing choices.
- Produce reusable recognized-text/timing comparison results for pronunciation work.

**Non-Goals:**

- Perfect pronunciation scoring or phoneme claims (covered later).
- A social voice marketplace or always-on microphone.

## Decisions

1. **Practice session references source.** Store profile, source sentence/anchor, media range/provider, attempt timestamp, recording policy, recognized text, comparison summary, and optional local recording reference.
2. **Explicit capture.** Microphone permission and recording start are user initiated; stop/cancel/delete are always available. Default retention is minimal and configurable.
3. **Original-first playback.** Resolve aligned original media, then existing TTS; show which source was used and allow replay.
4. **Transcription comparison is baseline.** Normalize expected/recognized text with language-aware rules, show missing/substituted/extra words and confidence when available, and label approximate results.
5. **Provider ladder/privacy.** Prefer local STT, then configured cloud with consent; cloud receives only the short attempt/audio required and is not needed for text reading.

## Risks / Trade-offs

- [Microphone/platform support differs] → Capability check, clear fallback to listen-only, and mobile/desktop permission tests.
- [STT errors mistaken for learner errors] → Show recognition confidence and “uncertain,” never definitive pronunciation claims.
- [Sensitive recordings] → Local default where possible, explicit retention/delete/export, no silent uploads.
- [E-ink cannot record well] → Transcript/listen-only degradation and clear unavailable state.

## Migration Plan

1. Add practice/session contract and listen-only loop.
2. Add capture/STT comparison and minimal history.
3. Expose results to active evidence and pronunciation scoring.

## Open Questions

- Default recording retention and whether audio is ever synced.
- Best local STT route for Android/iOS-capable architecture.
- Timing tolerance for immediate shadowing.
