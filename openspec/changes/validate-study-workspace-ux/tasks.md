## 1. Error Recovery, Stale-Response Guards & Persistence
- [x] 1.1 Implement `src/lib/study-plans/studyMode/studyErrorTaxonomy.ts` mapping `AIErrorCategory` and verification/source/consent errors to user-friendly titles, descriptions, applicable recovery actions, and collapsible technical details.
- [x] 1.2 Add monotonic scope/document epoch guards and `cancelAll()` on scope change/unmount in `StudyModeWorkspace.tsx` and `taskController.ts`, ensuring failed regeneration preserves previously valid artifacts.
- [x] 1.3 Persist draft written practice answers in `StudyModeSessionSnapshot` and restore them across Read/Study toggles and tab switches.
- [x] 1.4 Add non-Tauri web fallbacks for `createStudyFormativeQuestion`, `submitStudyFormativeAnswer`, and `verifyStudyModeArtifact` in `src/api/study-mode.ts`.

## 2. Audio/Slides TTS, Mobile Back, Accessibility & i18n
- [x] 2.1 Fix `studyTtsBridge.ts`, `studyMediaCache.ts`, `PlayableAudioLessonPlayer.tsx`, and `PlayableSlidesPlayer.tsx` to use real `window.speechSynthesis` fallback, avoid persisting ephemeral `blob:` URLs in `localStorage`, and report honest offline cache status.
- [x] 2.2 Register transient Study Mode overlays/sheets with `registerOverlayDismissal` (`src/lib/overlayStack.ts`) and ensure hidden reader containers are `inert` + `aria-hidden="true"`.
- [x] 2.3 Verify semantic theme tokens, reduced-motion compliance, keyboard accessibility, and localized user-facing copy.

## 3. Comprehensive Automated Tests & Visual QA
- [x] 3.1 Add comprehensive frontend unit and integration tests covering presentation exclusivity, layout coordination, scope resolution, citation navigation, Assistant answer-key protection, provider error taxonomy, stale-response guards, draft restoration, and zero-overhead inactive Study Mode.
- [x] 3.2 Add Rust unit tests in `src-tauri/src/database/study_mode_repository.rs` verifying `scope_key` session isolation, `mark_scope_artifacts_stale` across revisions, `learning_evidence` recording (`evidence_recorded == true`), and FSRS non-mutation.
- [x] 3.3 Run `openspec validate --strict`, `tsc`, `vitest`, `cargo test`, `npm run build:check`, and `npm run bench:check`, fixing all discovered regressions.
