# Verification: Validate Study Mode End-to-End

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npx tsc --noEmit && npm run docs:validate`
- `npx vitest run src/lib/study-plans/ src/components/viewer/__tests__/StudyModeWorkspace.test.tsx src/components/settings/search/__tests__/settingsSearchCoverage.test.ts`
- `openspec validate validate-study-mode-end-to-end --strict`
