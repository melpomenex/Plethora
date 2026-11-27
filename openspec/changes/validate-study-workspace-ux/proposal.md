## Why

A production-quality Study Mode workspace requires more than layout refactoring: it must recover gracefully from AI provider failures with human-readable actionable messages instead of raw validation strings, protect against stale or cancelled async generation responses across document/scope switches, integrate cleanly with Plethora's mobile Back stack (`overlayStack` / `applicationBack`), support all Plethora themes (light, dark, sepia, custom, high-contrast, e-ink) and accessibility requirements, localize all user-facing strings, fix audio/slides TTS & offline caching defects, and be backed by comprehensive automated unit, integration, Rust, performance, and visual E2E validation.

## What Changes

- **Actionable AI Error Recovery**: Map Plethora's existing `AIErrorCategory` (`src/lib/ai/errors.ts`) to concise, user-friendly Study Mode error messages with context-appropriate recovery actions (Retry, Choose another model / Open AI Settings, Switch to Local / Adjust Scope, Dismiss) while preserving technical details in a collapsible disclosure and preserving previously valid artifacts on failed regeneration.
- **Session Persistence, Draft Preservation & Stale-Response Guards**:
  - Persist draft practice answers and active activity state per scope across Read/Study toggles and document tab switches.
  - Guard all async generation/load responses with scope/session/request-generation tokens so stale or cancelled responses never mutate the wrong document or scope.
- **Audio/Slides TTS & Cache Fixes**: Fix `studyTtsBridge.ts`, `studyMediaCache.ts`, `PlayableAudioLessonPlayer.tsx`, and `PlayableSlidesPlayer.tsx` so browser `speechSynthesis` actually speaks when selected as fallback, stop persisting ephemeral `blob:` URLs in `localStorage`, and report honest offline cache status.
- **Mobile Navigation, Accessibility & i18n**:
  - Register transient Study Mode overlays/sheets with Plethora's `overlayStack` / `registerOverlayDismissal` so Escape and Android/mobile Back dismiss surfaces in exact visual-layer order.
  - Ensure hidden reader content is `inert` + `aria-hidden`, focus management and ARIA roles are complete, reduced-motion is respected, and user-facing strings use Plethora's i18n system (`useI18n` / locale keys).
  - Verify `settingsSearchCatalog.ts` / `settingsSearchCoverage.ts` if any Study Mode settings are added or renamed.
- **Comprehensive Automated & Visual Validation**:
  - Unit & integration tests covering presentation exclusivity, layout coordination, scope resolution, evidence persistence (Rust), Assistant answer-key protection, provider error taxonomy, stale-response guards, and zero-overhead inactive Study Mode.
  - Visual & Playwright E2E QA across desktop, mobile, and representative Plethora themes, plus `tsc`, `vitest`, `cargo test`, `build:check`, and `bench:check`.

## Capabilities

### New Capabilities
- `study-workspace-reliability-and-validation`: Actionable `AIErrorCategory` error recovery, stale-response and cancellation guards, draft/session resumability, fixed TTS/media caching, `overlayStack` mobile/keyboard Back integration, theme/a11y/i18n polish, and full automated + visual QA gates.

### Modified Capabilities
- (None archived in `openspec/specs/`.)

## Dependencies

- Depends on `refactor-study-mode-workspace`, `implement-source-aware-study-scopes`, and `integrate-study-workspace-assistant`.

## Non-Goals

- Claiming physical native-device verification when only browser/desktop emulation was executed.
- Weakening existing test assertions or disabling existing benchmarks.

## Impact

- **Error & Task Reliability**: New `src/lib/study-plans/studyMode/studyErrorTaxonomy.ts`, updates to `src/lib/study-plans/studyMode/taskController.ts`, `src/lib/study-plans/studyMode/sessionPersistence.ts`, `src/lib/study-plans/studyMode/studyTtsBridge.ts`, `src/lib/study-plans/studyMode/studyMediaCache.ts`.
- **UI, A11y, Mobile & i18n**: `src/components/viewer/StudyModeWorkspace.tsx`, `src/components/viewer/study-mode/*.tsx`, `src/lib/i18n/`.
- **Tests & Visual QA**: `src/lib/study-plans/studyMode/__tests__/`, `src-tauri/src/database/study_mode_repository.rs`, Playwright visual harness/spec.
