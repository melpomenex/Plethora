## 1. Types & Models

- [x] 1.1 Update `QualityPreset` in `src/types/audioEdition.ts` to include `"fal"` and verify type checking passes

## 2. Dialog UI & Provider Integration

- [x] 2.1 Add the Fal.ai preset card to the primary Quality & Voice Profile selector in `src/components/audio/CreateAudioEditionDialog.tsx` and reflow preset grid to responsive `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` for mobile and desktop
- [x] 2.2 Add Fal.ai (`fal`) to the Advanced Settings Provider dropdown in `CreateAudioEditionDialog.tsx`, linking model defaults and voice roster resolution for built-in and saved custom profiles
- [x] 2.3 Disable the speed slider with explanatory text when Fal.ai is the selected provider, enforcing adapter capability constraints
- [x] 2.4 Connect Fal.ai pre-flight billing consent validation and cost estimation in the audition preview and creation submit handlers

## 3. Automated Tests & Verification

- [x] 3.1 Add unit tests in `src/components/audio/__tests__/CreateAudioEditionDialog.test.tsx` covering Fal.ai preset selection, Advanced dropdown selection, voice enumeration, speed parameter gating, auditioning, and generation job submission
- [x] 3.2 Execute the test suite via `npm run test:unit -- src/components/audio/__tests__/CreateAudioEditionDialog.test.tsx` and verify all tests pass
- [x] 3.3 Run the performance benchmark gate (`npm run bench:check`) to verify baseline compliance
