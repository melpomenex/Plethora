# Verification: Consolidate Study Mode Learning Foundation

- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml study_mode` and `study_source_repository` `#occ:N` tests.
- Frontend tests: `npx vitest run src/lib/study-plans/` verifying `StudyPlanEditor` and `queueProjection` pass.
- Strict OpenSpec validation: `openspec validate consolidate-study-mode-learning-foundation --strict`.
