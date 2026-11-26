# Tasks: Consolidate Study Mode Learning Foundation

- [ ] 1.1 Add Migration `162_study_mode_foundation` (`study_mode_sessions`, `study_mode_artifacts`) and Rust models/repository (`study_mode.rs`, `study_mode_repository.rs`) with CRUD, staleness detection, and cascade cleanup.
- [ ] 1.2 Add Tauri commands in `src-tauri/src/commands/study_mode.rs` and TypeScript contracts/API in `src/types/studyMode.ts` and `src/api/study-mode.ts`.
- [ ] 1.3 Fix `#occ:N` chunk disambiguation in `study_source_repository.rs`, `selected.extractIds` filtering in `study_trails.rs`, and `PreviewStudyTrailPanel` reorder/rejection semantics.
- [ ] 1.4 Add System A -> System B authored-assignment bridge in `StudyTrailRepository` and add Rust + Vitest unit tests for migrations, repository, and source fixes.
