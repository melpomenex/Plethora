## Why

Even with a reliable 4-tab, 3-pane workspace, Study Mode's current Practice flow generates single disconnected questions with hardcoded difficulty `2` and `Date.now()` fingerprints (allowing repeated questions), offers no Guided adaptive study loop alongside Freeform reading, and leaves the `Progress` tab disconnected from Plethora's unified learning-evidence engine (`src/api/learning-evidence.ts`). Learners need an interchangeable Freeform/Guided experience, a continuous multi-type adaptive practice engine with semantic deduplication and misconception feedback, and an honest evidence-backed Progress dashboard that distinguishes exposure, understanding, and retention.

## What Changes

- **Guided & Freeform Modes (Interchangeable, Zero Setup)**:
  - Keep Freeform as the zero-friction default while adding a prominent **Start Guided Session** action in the `Learn` tab and header.
  - Implement a structured 6-stage Guided Loop state machine (`introduce` → `anchor` → `understand` → `recall` → `adapt` → `reinforce` → `recap`) that navigates to the anchored source passage, builds understanding, runs active recall, adapts on misconceptions (re-explain differently & reassess), offers optional FSRS flashcard creation, and ends with an honest session recap.
- **Typed, Extensible Interactive Practice Engine**:
  - Replace one-off question generation with continuous adaptive practice sessions featuring progress tracking, progressive hints, actionable misconception explanations, and optional non-intrusive inline knowledge checks inside `OriginalSourcePane`.
  - Support 5 interactive question types out of the box—`multiple_choice`, `free_recall`, `fill_blank`, `ordering`, and `scenario_error`—on a typed registry cleanly extensible to `compare_contrast`, `problem_solving`, and `teach_back`.
  - **Semantic Deduplication**: Replace `${scopeKey}:${Date.now()}` fingerprints with normalized content/concept semantic fingerprints and token-overlap deduplication so sessions do not repeat questions.
  - **Evidence-Driven Difficulty**: Replace hardcoded difficulty `2` with dynamic difficulty selection (`1..5`) driven by recent session performance and `ConceptMasterySummary` / FSRS evidence state.
- **Unified Learning Evidence & Progress Tab**:
  - Wire the `Progress` tab to Plethora's shared learning-evidence API (`getConceptMasterySummary`, `getStudyPlanEvidence`, `listLearningGaps`) merged with current-session formative evidence, strictly computing Exposure vs. Understanding vs. Retention without ever asking an LLM to fabricate mastery percentages.
  - Display per-concept evidence breakdowns with explicit uncertainty states (`Not assessed` / `Insufficient evidence`), detected misconceptions, and an actionable **Recommended next session** card with estimated duration.
- **Reconciliation**: Reconciles and extends the unarchived `extend-study-mode-with-active-learning` and `integrate-study-mode-adaptive-remediation` specs.

## Capabilities

### New Capabilities
- `study-mode-adaptive-practice`: Typed extensible multi-format Question Engine, continuous adaptive practice sessions with hints and misconception feedback, semantic question deduplication, evidence-driven dynamic difficulty, and optional inline knowledge checks.
- `study-mode-guided-loop-and-progress`: Interchangeable Freeform and 6-stage Guided Study Loop, plus the unified learning-evidence Progress view distinguishing exposure, understanding, retention, uncertainty, and recommended next steps.

### Modified Capabilities
- (None in `openspec/specs/`; reconciles unarchived `extend-study-mode-with-active-learning` and `integrate-study-mode-adaptive-remediation`.)

## Impact

- **New Logic Modules**: `src/lib/study-plans/studyMode/guidedLoop.ts`, `src/lib/study-plans/studyMode/practiceEngine.ts`, `src/lib/study-plans/studyMode/evidenceProgress.ts`.
- **AI Task Definitions**: Extend `studyModeFormativeQuestionTask` in `src/lib/ai/tasks/definitions/studyModeTasks.ts` to accept target difficulty (`1..5`), extended question kinds, and prior question prompts/fingerprints to avoid repetition.
- **UI Components**: `src/components/viewer/study-mode/GuidedLoopBanner.tsx`, `src/components/viewer/study-mode/PracticePanel.tsx`, `src/components/viewer/study-mode/ProgressPanel.tsx`, updates to `OriginalSourcePane.tsx` (optional non-intrusive inline check) and `StudyModeWorkspace.tsx`.
- **Tests**: `src/lib/study-plans/studyMode/__tests__/wave2AdaptivePractice.test.tsx` covering guided loop transitions, all 5 question types, semantic deduplication, dynamic difficulty adaptation, misconception remediation, and evidence-based progress math.
