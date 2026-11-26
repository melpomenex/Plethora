## Why

After P0 and P1 language capabilities stabilize, learners benefit from multi-dimensional placement diagnostics, adaptive proficiency tracking across separate skills, and capability-gated spoken AI conversation practice without misleading CEFR certification claims or fake voice interfaces.

## What Changes

- Add placement assessment (`src/lib/languageAssessment/placement.ts`) sampling vocabulary recognition, reading comprehension, listening comprehension, grammar, writing, and supported speaking dimensions, returning explicit proficiency bands with uncertainty intervals and clear non-accreditation disclosure.
- Add adaptive 6-dimension proficiency tracking (`reading`, `listening`, `writing`, `speaking`, `vocabulary`, `grammar`) without collapsing into an unsupported scalar score.
- Add capability-gated turn-based spoken AI conversation (`LanguageVoiceConversation.tsx`) reusing existing local/opt-in STT, Learner-Aware AI Tutor, and Multilingual TTS, hiding/disabling voice mode cleanly when required STT or AI providers are unavailable.

## Capabilities

### New Capabilities

- `language-proficiency-assessment-and-voice-practice`: Multi-dimensional placement & adaptive proficiency estimation with uncertainty disclosure, plus capability-gated spoken AI conversation turns.

## Impact

- `src/lib/languageAssessment/*`, `src/components/language/LanguageVoiceConversation.tsx`, and Dashboard entry points.
