# Tasks: Extend Study Mode with Active Learning

- [ ] 4.1 Add Migration `164_study_formative_questions` and Rust repository/commands for persisting formative questions, stripping answer keys, and authoritative idempotent grading.
- [ ] 4.2 Fix `FormativeCheckDrawer.tsx` and `study_trails.rs` so MC correctness is never computed or trusted from the client, and written responses use rubric-aligned evaluation instead of the 8-word substring heuristic.
- [ ] 4.3 Register active-learning AI tasks (`study-mode-plan-augmentations`, `study-mode-generate-component`, `study-mode-generate-formative-questions`, `study-mode-grade-formative`) in `src/lib/ai/tasks/definitions/studyModeTasks.ts`.
- [ ] 4.4 Implement Learn view (`StudyLearnView.tsx`) and Practice view (`StudyPracticeView.tsx`) inside `StudyModeWorkspace` with collapsible/dismissible source-linked components and `learning_evidence` integration.
