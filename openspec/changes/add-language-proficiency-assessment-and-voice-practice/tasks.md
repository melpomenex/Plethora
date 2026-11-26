## 1. Placement & Adaptive Proficiency Assessment

- [x] 1.1 `src/lib/languageAssessment/placement.ts` and `adaptive.ts` track separate 6-dimension skill estimates (`vocabularyBreadth`, `grammarMorphology`, `readingComprehension`, `listeningComprehension`, `writingProduction`, `speakingPronunciation`) with EAP IRT posteriors, `confidenceInterval {low, high, minBand, maxBand}`, `sem`, `confidenceScore`, and `NON_CEFR_DISCLAIMER` (never an accredited certification). Untested dimensions stay `unavailable`; below-floor dimensions report `insufficient-evidence`.
- [x] 1.2 `LanguageAssessmentPanel.tsx` added to the Language Learning Dashboard ("Assessment" sub-view of `LanguageLearningTab.tsx`), with adaptive multiple-choice/free-response items, skip/finish-early, per-dimension status chips, range/confidence/sample display, and the disclaimer.

## 2. Capability-Gated Voice Conversation

- [x] 2.1 `LanguageVoiceConversation.tsx` reuses `createConfiguredShadowingProviders` (STT), `createProductionLanguageTutorService` + `buildLearnerContext` (Learner-Aware AI Tutor), and `speechSynthesis` (multilingual TTS, `LANG_TO_BCP47`), with transcript review/edit, optional correction, configurable speed (0.6–1.6×), and strict gating: voice UI only renders when profile + real STT provider + AI availability all exist; otherwise it reports unavailable with reasons and never simulates voice with text-only UI.

## 3. Verification

- [x] 3.1 `src/lib/languageAssessment/__tests__/assessmentVerification.test.ts` covers multi-dimensional uncertainty bounds, insufficient-evidence states, adaptive exercise selection (exact max-Fisher-information rule), ability move directions, skip non-counting, zero-evidence combination, and dimension enumeration. `src/components/language/__tests__/voiceConversationGate.test.tsx` covers truthful capability gating when STT/AI is unavailable (no fake voice UI) and enabling when all three prerequisites exist.
