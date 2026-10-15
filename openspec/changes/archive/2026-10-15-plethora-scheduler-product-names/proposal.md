# Plethora 1.0 — Proposal A: Scheduler Product Names

## Why

Plethora's spaced-repetition schedulers are user-visible under Plethora-derived names (Plethora Classic, Plethora Adaptive, Plethora Precision, plus arena baselines Classic 15/Classic 19). For commercial launch these must appear as Plethora product names, without renaming any persisted identifier, and scheduler-specific rating semantics (mobile joystick vs. desktop six-grade buttons) must not regress.

## What Changes

- Introduce a **frontend scheduler catalog** (`src/lib/schedulerCatalog.ts`) as the single source of user-facing scheduler metadata: `id → { label, shortLabel, description, ratingSchema, legacyAliases }`. Display names:
  - `classic` → **Plethora Classic**
  - `adaptive` → **Plethora Adaptive**
  - `precision` → **Plethora Precision**
  - `fsrs` → **FSRS-6** (unchanged — FSRS is a third-party scheduler and must not be presented as Plethora invention)
  - legacy ids `classic_5`/`classic_8`/`classic_15` → "Plethora Classic (Legacy *N*)" style labels in the legacy selector only
- Replace **every hardcoded user-facing occurrence** of Plethora Classic/Plethora Adaptive/Plethora Precision/Classic15/Classic19 labels in:
  - `LearningSettings.tsx`, `routes/settings.tsx`, dead `pages/SettingsPage.tsx`
  - `ItemDetailsPopover.tsx`, `DeckStatsPanel.tsx`, `ReviewTransparencyPanel.tsx`, `FSRSInspector.tsx`
  - i18n values (`settingsLegacy.legacy-third-party*`, `learningSettings.*Desc`, onboarding tour text, handbook `understandingAdaptive/20` values) in **all six locales** — key names unchanged
  - Rust arena labels (`ArenaModelId::label()`, `ARENA_MODEL_NAMES`) and the TS browser-backend mirror (`BROWSER_ARENA_LABELS`), updated in lockstep with their tests. Arena baseline Classic 15/Classic 19 become "Classic 15 baseline"/"Classic 19 baseline" so historical-comparison context stays honest without third-party SRS branding.
- Delete or absorb the dead `ALGORITHM_NAMES` in `src/utils/constants.ts` into the catalog.
- Descriptions emphasize behavior, not provenance; no unsupported superiority claims.
- Tests: rename-only assertions — display strings change, scheduling payloads/ids/rating schemas do not.

## Capabilities

### New Capabilities
- `scheduler-catalog`: central, i18n-aware registry of scheduler display metadata; UI must consume it instead of hardcoding algorithm labels; capability/rating semantics remain sourced from `rating-grades.ts`.

### Modified Capabilities
- None. `flashcard-review-session` behavior is unchanged (presentation-only change verified by tests).

## Impact

- Frontend: settings (3 selects), review statistics panels, transparency/inspector panels, onboarding copy, `browser-backend.ts` arena mirror.
- Rust: `src-tauri/src/algorithms/precision/mod.rs` (`label()`), `arena.rs` (`ARENA_MODEL_NAMES`), serialized `ArenaModelCandidate.label` (wire format — coordinated change with TS tests; `model_id`/order untouched).
- i18n: value updates across en/zh/es/de/fr/ja (no key changes).
- Docs: `docs/USER_HANDBOOK*.md` scheduler sections (import-from-Plethora references stay — third-party product name).
- **Unchanged (compatibility-critical)**: DB `algorithm_type` values, `AlgorithmType`/`ArenaModelId` serde ids and order, Tauri command names (`get_precision_arena_stats` etc.), settings union values, sync payloads, `settingsValidation` enums, i18n key names.

Cross-references: part of the Plethora 1.0 initiative; no dependencies on other proposals. Feeds the brand pass in `plethora-brand-consolidation-finish` and the RC audit in `plethora-1-0-release-candidate-hardening`.
