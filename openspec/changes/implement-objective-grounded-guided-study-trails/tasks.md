# Tasks: Implement Concept-Grounded Guided Reading and Adaptive Study Trails

## 1. Persistence & Domain Model
- [ ] 1.1 Add additive SQLite migration `154_guided_study_trails` (`learning_segments`, `learning_segment_objectives`, `study_trail_items`, `formative_check_results`) in `src-tauri/src/database/migrations.rs`.
- [ ] 1.2 Create Rust domain models in `src-tauri/src/models/study_trail.rs` and repository `src-tauri/src/database/study_trail_repository.rs` with unit/integration tests.
- [ ] 1.3 Add TypeScript types `src/types/studyTrail.ts` and API client `src/api/study-trails.ts`.

## 2. Structural Analysis & Instructional Retrieval Pipeline
- [ ] 2.1 Implement `src-tauri/src/study_trail/structural_analyzer.rs` for EPUB, PDF, HTML, Markdown, Plain Text, and Transcripts.
- [ ] 2.2 Implement `src-tauri/src/study_trail/content_classifier.rs` to exclude TOC, bibliography, index, front matter, bare headings, running headers/footers, and incidental mentions (with contextual exception support).
- [ ] 2.3 Implement `src-tauri/src/study_trail/retrieval_pipeline.rs` for progressive candidate discovery, section expansion, quality evaluation, deduplication, and coverage validation.
- [ ] 2.4 Write source-selection regression tests covering all required corpus fixtures (TOC, bibliography, index, front matter, repeated headings, keyword-only mention, multi-paragraph explanation, multi-section concept, competing sources, long document outside sampling window, stale revision, scanned PDF without OCR, transcript source, no-match negative test).

## 3. Prerequisite-Aware Trail Planner & Eligibility
- [ ] 3.1 Implement `src-tauri/src/study_trail/planner.rs` (Concept/Source/Study order, session grouping, shared segment deduplication, manual override preservation).
- [ ] 3.2 Implement `src-tauri/src/study_trail/eligibility.rs` (`guided`, `assessment-first`, `open` policies) and remediation segment lookup from `learning_gaps`.
- [ ] 3.3 Implement Tauri commands in `src-tauri/src/commands/study_trails.rs` and register them in `src-tauri/src/lib.rs`.

## 4. Study Queue & Preview Study Trail UX
- [ ] 4.1 Implement `src/lib/study-plans/trail/queueProjection.ts` and `src/components/study-plans/queue/StudyQueueView.tsx` with **Continue Learning** card, blocked/upcoming/completed sections, and all assignment actions.
- [ ] 4.2 Implement `src/components/study-plans/queue/PreviewStudyTrailPanel.tsx` for inspecting, accepting, rejecting, replacing, expanding/contracting, manually selecting, toggling required/optional, reordering, and regenerating per objective.
- [ ] 4.3 Integrate `Queue` mode alongside `List` and `Graph` in `src/components/study-plans/StudyPlanEditor.tsx` and `StudyPlanGraphToolbar.tsx`.

## 5. Guided Reading Mode, Formative Checks & Remediation
- [ ] 5.1 Extend `src/lib/study-plans/reading/` (`trailController.ts`, `useStudyTrailReader.ts`, `resolveReadingRange.ts`, `readerAdapters.ts`) for Plain Text, Transcript-backed media, start/end boundary tracking, and persistent resume locators.
- [ ] 5.2 Implement `src/components/viewer/GuidedReadingPanel.tsx` (desktop side panel / mobile compact sheet) with learning objective, boundaries, progress, notes/extracts, Socratic tutor, and finish -> comprehension check flow.
- [ ] 5.3 Implement `src/components/study-plans/queue/FormativeCheckDrawer.tsx` and wire assessment eligibility + targeted `LearningSegment` remediation into `AssessmentList.tsx` and `WeakTopicWorkspace.tsx`.

## 6. Verification & Hardening
- [ ] 6.1 Run Rust tests (`cargo test`), TypeScript Vitest suites (`vitest run`), typecheck (`npx tsc --noEmit`), and OpenSpec strict validation.
- [ ] 6.2 Verify end-to-end integration flow and backward compatibility with existing Study Plans and assessments.
