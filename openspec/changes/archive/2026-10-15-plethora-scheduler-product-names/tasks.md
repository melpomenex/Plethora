## 1. Catalog

- [x] 1.1 Create `src/lib/schedulerCatalog.ts` with labels, shortLabels, i18n description keys, rating schema refs, arena labels; unit tests
- [x] 1.2 Delete dead `ALGORITHM_NAMES` from `src/utils/constants.ts`

## 2. Frontend consumers

- [x] 2.1 `LearningSettings.tsx`: use catalog + i18n keys for options/descriptions/arena copy/Pure-Mode label
- [x] 2.2 `routes/settings.tsx` and dead `pages/SettingsPage.tsx`: catalog-driven options
- [x] 2.3 `ItemDetailsPopover.tsx`, `DeckStatsPanel.tsx`, `ReviewTransparencyPanel.tsx`, `FSRSInspector.tsx`: catalog labels
- [x] 2.4 `browser-backend.ts` arena label mirror uses catalog
- [x] 2.5 `types/entitlements.ts` capability copy update

## 3. Rust arena labels

- [x] 3.1 Update `ArenaModelId::label()` + `ARENA_MODEL_NAMES` (classic_15/classic_19 → Classic 15/19); keep ids/order
- [x] 3.2 Update `AlgorithmArenaDecision.test.tsx` fixtures and any Rust label tests

## 4. i18n + docs

- [x] 4.1 Update `settingsLegacy.legacy-third-party*`, `learningSettings.*Desc`, onboarding tour algorithm text, `handbook.understandingAdaptive/20` values in all six locales
- [x] 4.2 Update scheduler sections in `docs/USER_HANDBOOK*.md` (keep third-party legacy third-party collection import references)

## 5. Guard tests + validation

- [x] 5.1 Add no-SM-branding UI grep test with explicit allowlist (import-source labels, internal ids, tests)
- [x] 5.2 Run scheduler/rating test suites (`SixGradeRatingControl.matrix`, `reviewStore`, `queueScrollKeyboard`, `cargo test` algorithms) and fix regressions
