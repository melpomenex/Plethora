# Tasks: Implement Pedagogical Content Verification

- [ ] 2.1 Define `PedagogicalEvaluationReport` and 11-criterion Appendix B rubric types in `src/types/studyMode.ts` and `src-tauri/src/models/study_mode.rs`.
- [ ] 2.2 Implement deterministic verification in `src/lib/study-plans/studyMode/pedagogicalVerifier.ts` and `src-tauri/src/study_mode/verifier.rs`.
- [ ] 2.3 Register bounded `pedagogical-eval` AI task in `src/lib/ai/tasks/definitions/studyModeTasks.ts` with `wrapUntrustedBlock` containment and 1-retry bounded repair.
- [ ] 2.4 Create deterministic human-reviewed pedagogical evaluation fixtures and automated tests covering all failure modes.
