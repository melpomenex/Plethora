# Verification: Add Optional Study Mode and Learner Preferences

- `npx vitest run src/components/settings/search/__tests__/settingsSearchCoverage.test.ts`
- `npx vitest run src/components/viewer/__tests__/StudyModeWorkspace.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml study_mode`
- Strict OpenSpec validation: `openspec validate add-optional-study-mode-and-learner-preferences --strict`.
