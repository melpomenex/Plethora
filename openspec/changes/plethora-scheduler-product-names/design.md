# Design — Scheduler Product Names

## Context

Display names for schedulers are hardcoded independently in ~10 TS locations, one Rust arena-label source, and six locale files. Persisted identifiers (`fsrs|sm2|sm5|sm8|sm15|sm18|sm20`), the `AlgorithmType`/`ArenaModelId` serde ids and their order, Tauri command names, and i18n key names are compatibility contracts and must not change. `src/lib/supermemo-grades.ts` already centralizes rating *capability* per algorithm ("view code must never hard-code algorithm-name checks") — display metadata has no equivalent home.

## Goals / Non-Goals

**Goals:**
- Single frontend catalog mapping scheduler id → user-facing metadata; all UI consumes it.
- SuperMemo-derived names gone from user-visible surfaces; FSRS-6 unchanged.
- Rust arena labels + TS browser mirror updated in lockstep with tests.
- Zero behavioral change to scheduling/rating (tests prove it).

**Non-Goals:**
- Renaming persisted ids, enum variants, commands, settings values, sync payloads.
- Changing which schedulers are selectable, rating schemas, or the joystick/six-button split.
- Removing "SuperMemo" where it names the third-party import source.

## Decisions

1. **Catalog lives in `src/lib/schedulerCatalog.ts`** (next to `supermemo-grades.ts`, not reviving dead `utils/constants.ts` `ALGORITHM_NAMES`). Exports `SCHEDULER_CATALOG: Record<AlgorithmId, SchedulerInfo>` plus `schedulerLabel(id)`, `schedulerDescription(id)`, `arenaModelLabel(id)`. Descriptions are i18n-key *names* resolved via `t()` at call sites so locales translate them; catalog stores keys + English fallback.
2. **Name mapping**: `sm2→Plethora Classic`, `sm18→Plethora Adaptive`, `sm20→Plethora Precision`, `fsrs→FSRS-6`; legacy selector ids `sm5/sm8/sm15 → Plethora Classic 5/8/15`; arena baselines `sm15→Classic 15`, `sm19→Classic 19` (honest historical-baseline framing without SuperMemo branding).
3. **Rust arena labels change** (`ArenaModelId::label()`, `ARENA_MODEL_NAMES`) because `ArenaModelCandidate.label` feeds UI directly; `model_id`, order, and serde ids untouched. TS `browser-backend.ts` mirror and `AlgorithmArenaDecision.test.tsx` fixtures updated in the same commit.
4. **i18n values updated in all six locales** (`settingsLegacy.supermemo*`, `learningSettings.*Desc`, `onboarding.tour.review.algorithm.body`, `handbook.understandingSM18/20` bodies); key names unchanged. LearningSettings switches from hardcoded JSX to these keys.
5. **Dead code**: `pages/SettingsPage.tsx` select stays dead but gets catalog labels anyway (cheap, removes stale surface); `constants.ts ALGORITHM_NAMES` deleted.

## Risks / Trade-offs

- [Missed hardcode] → grep gate in tests: brand-inventory-style test asserting no `SM-2|SM-18|SM-20|SM-15|SM-19` strings outside an explicit allowlist (import-source labels, tests, internal identifiers).
- [Rust/TS label drift] → single source per side + test asserting TS arena labels equal Rust `ARENA_MODEL_NAMES` expectations via fixture.
- [Translation drift] → i18n completeness test already enforces key parity across locales.

## Migration Plan

No data migration. Rollback = revert commit. Wire-format change limited to display `label` strings consumed only by UI + updated tests.

## Open Questions

None.
