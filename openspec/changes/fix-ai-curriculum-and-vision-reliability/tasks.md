## 1. AI Curriculum Generation (BUG-07)
- [ ] 1.1 Pin resolved route/model identity in `curriculumPreflight.ts` and compare `documentIds` as sorted sets.
- [ ] 1.2 Ensure `CurriculumGenerator.tsx` and `coordinator.ts` handle "Use app default" and `recoveryJob` resume without spurious `provider_changed_on_resume` errors while preserving existing valid Study Plans on failure.

## 2. Mirage Vision Diagnostics & Path Probing (BUG-10)
- [ ] 2.1 Update `src-tauri/src/vision/cactus_ffi.rs` to probe `Contents/Frameworks/` and avoid bare relative `dlopen` errors on macOS Hardened Runtime, returning a clear structured unavailability message.
- [ ] 2.2 Update `src-tauri/src/vision/mirage.rs` and `src/components/settings/MirageInstallCard.tsx` to display clear status and recovery guidance.

## 3. Regression Tests
- [ ] 3.1 Add Vitest tests for `curriculumPreflight.ts` / `coordinator.ts` ("Use app default", set-based `documentIds`, resume after settings change, malformed provider output, and existing plan preservation).
- [ ] 3.2 Add Rust tests in `cactus_ffi.rs` / `mirage.rs` for candidate path resolution, missing-library error formatting, and graceful failure handling.
