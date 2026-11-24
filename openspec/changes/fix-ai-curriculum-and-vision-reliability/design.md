# Technical Design: AI Curriculum & Mirage Vision Reliability

## 1. AI Curriculum Generation (`BUG-07`)
- `src/lib/study-plans/generation/curriculumPreflight.ts`:
  - When `selectedConfigId` is empty ("Use app default") and `performStudyAiPreflight` resolves a concrete `model.configId` / `providerId`, record the resolved route identity and pass it into `coordinator.ts` so `prepareCurriculumPreflight` does not drift between preview and execution.
  - Compare `documentIds` using sorted/deduplicated sets so benign ordering differences from SQLite `sourceScope` refresh do not spuriously throw `provider_changed_on_resume`.
- `src/lib/study-plans/generation/coordinator.ts` & `src/components/study-plans/CurriculumGenerator.tsx`:
  - When resuming a failed job (`recoveryJob`), allow the user's newly authorized preflight to proceed (updating the job's checkpoint preflight cleanly when the user confirms) rather than blocking on `checkpoint_evidence_changed` / `provider_changed_on_resume`.
  - Preserve existing valid Study Plans if generation fails at any stage.

## 2. Mirage Vision (`BUG-10`)
- `src-tauri/src/vision/cactus_ffi.rs`:
  - Add `<exe>/../Frameworks/` to `candidate_paths()` for macOS `.app` bundles.
  - On macOS (`#[cfg(target_os = "macos")]`), skip bare relative `dlopen("libcactus.dylib")` / `dlopen("libmirage.dylib")` fallback (or try `@executable_path/../Frameworks/...` / `@rpath/...`) so Hardened Runtime does not emit confusing `dyld` relative-path errors, and instead report a structured `MirageRuntimeUnavailable` message listing checked bundle paths and recovery steps.
- `src-tauri/src/vision/mirage.rs` & `src/components/settings/MirageInstallCard.tsx`:
  - Surface clear platform availability, missing library status, and recovery actions without crashing or claiming success.
