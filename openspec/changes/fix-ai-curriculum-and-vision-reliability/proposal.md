# Change: Fix AI Curriculum Generation Preflight/Resume and Mirage Vision Diagnostics

Covers **BUG-07** (AI curriculum generation raises `"The model, endpoint, or embedding settings changed"` / `"Decomposing Topics: Failed"`) and **BUG-10** (Mirage Vision `libcactus.dylib` / `libmirage.dylib` relative `dlopen` failure on macOS Hardened Runtime).

## Why

1. **BUG-07 (AI curriculum generation errors):** `prepareCurriculumPreflight` leaves `modelSelection: ""` when "Use app default" is selected, causing `coordinator.ts` to re-run async provider discovery (`getRoutingProviders()`) and fail `validatePreflightUnchanged` or `documentIds` equality checks on start or resume (`study_generation.error.provider_changed_on_resume`).
2. **BUG-10 (Mirage Vision errors):** `CactusLibrary::load()` (`src-tauri/src/vision/cactus_ffi.rs`) falls through to bare relative `dlopen("libcactus.dylib")` / `dlopen("libmirage.dylib")` when no bundled library is present, triggering macOS Hardened Runtime `relative path not allowed in hardened program` errors instead of checking `Contents/Frameworks/` or surfacing a clear platform-specific availability/setup error.

## What Changes

- **Pin resolved model & stabilize preflight (`BUG-07`):** Pin the resolved `configId`/`providerId` in `prepareCurriculumPreflight` so starting generation uses the exact authorized route rather than re-discovering an unpinned `"Use app default"` route; compare `documentIds` as sets rather than order-sensitive JSON strings; and handle intentional model switches on resume cleanly without destroying existing saved Study Plan drafts.
- **Hardened-runtime safe Mirage Vision probing & clear diagnostics (`BUG-10`):** Add `Contents/Frameworks/` probing in `cactus_ffi.rs`, avoid relative `dlopen` on macOS hardened builds unless RPATH/executable-relative resolution succeeds, classify missing native runtime as an explicit `UnavailableRuntime` status with actionable installation/env instructions (`PLETHORA_CACTUS_LIB` or sidecar download), and add regression tests for both features.
