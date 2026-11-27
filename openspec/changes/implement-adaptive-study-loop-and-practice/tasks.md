## 1. Guided Loop, Practice Engine & Evidence Progress Core Modules

- [x] 1.1 Implement the 6-stage Guided Loop state machine (`introduce` → `anchor` → `understand` → `recall` → `adapt` → `reinforce` → `recap`) in `src/lib/study-plans/studyMode/guidedLoop.ts`.
- [x] 1.2 Implement the typed, extensible Practice Question Engine (`multiple_choice`, `free_recall`, `fill_blank`, `ordering`, `scenario_error`) with content-based semantic deduplication (`computeSemanticQuestionFingerprint`, `isSemanticallyDuplicateQuestion`) and evidence-driven difficulty (`selectAdaptiveDifficulty`) in `src/lib/study-plans/studyMode/practiceEngine.ts`.
- [x] 1.3 Extend `studyModeFormativeQuestionTask` in `src/lib/ai/tasks/definitions/studyModeTasks.ts` to support the 5 question kinds, target difficulty (`1..5`), hints, misconception distractor rationale, and exclusion of prior question prompts.
- [x] 1.4 Implement unified evidence progress computation in `src/lib/study-plans/studyMode/evidenceProgress.ts` combining `ConceptMasterySummary`, `KnowledgeGapView`, session formative outcomes, and FSRS retention signals with explicit uncertainty handling and recommended next session generation.

## 2. Guided Loop, Interactive Practice & Progress UI

- [x] 2.1 Build `GuidedLoopBanner` (`src/components/viewer/study-mode/GuidedLoopBanner.tsx`) supporting Freeform ↔ Guided switching, stage stepper, anchor navigation, adaptive remediation branching, optional flashcard promotion, and session recap.
- [x] 2.2 Build `PracticePanel` (`src/components/viewer/study-mode/PracticePanel.tsx`) with continuous adaptive session progress bar, all 5 interactive question types, progressive hints, actionable misconception feedback, and remediation actions.
- [x] 2.3 Build `ProgressPanel` (`src/components/viewer/study-mode/ProgressPanel.tsx`) wired to `getConceptMasterySummary` / `getStudyPlanEvidence` / `listLearningGaps` + session formative evidence, showing Exposure vs. Understanding vs. Retention, per-concept evidence breakdowns with uncertainty badges, and Recommended Next Session.
- [x] 2.4 Add optional non-intrusive inline knowledge check toggle to `OriginalSourcePane.tsx` and wire Guided Loop, `PracticePanel`, and `ProgressPanel` into `StudyModeWorkspace.tsx`.

## 3. Verification & Tests

- [x] 3.1 Write comprehensive unit & integration tests in `src/lib/study-plans/studyMode/__tests__/wave2AdaptivePractice.test.tsx` covering Guided Loop transitions, all 5 question formats, semantic deduplication, evidence-driven difficulty, misconception feedback, and honest evidence-based Progress calculations.
- [x] 3.2 Run `openspec validate`, `npx tsc --noEmit`, `npx eslint`, and `npx vitest run`.
