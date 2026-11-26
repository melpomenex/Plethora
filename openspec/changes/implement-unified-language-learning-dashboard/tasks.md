## 1. Navigation & Guided Onboarding

- [x] 1.1 Register `"language-learning"` tab in `tabsStore.ts` (TabType union), `TabRegistry.tsx` (lazy `LanguageLearningTab`, icon, translation key, secondary preload), `tabDestinations.ts` (dest + aliases `lang`/`languages`/`language`), `Toolbar.tsx`, `MobileNavigation.tsx`, `MainLayout.tsx`, and `TabIcons.tsx`. Command Palette `destinationActions.ts` and `KeyboardShortcuts.tsx` do not enumerate tabs (only deep actions like study-plans home); no changes were required there. `src/navigation/__tests__/tabDestinations.test.ts` passes for the new destination.
- [x] 1.2 Implement 8-step skippable `LanguageOnboardingModal.tsx` supporting native/target language selection, proficiency target, language pack install (via `filterCatalogPacks` + `getStarterPackEntries`), offline capabilities summary, optional AI/speech setup, initial content import, and first session launch. Creates the profile via `createLanguageProfile`, sets `settings.languageLearning.enabled`, best-effort starter-pack install.

## 2. Dashboard Views & Vocabulary Management

- [x] 2.1 Implement `LanguageDashboardView.tsx` (Today) with recent vocabulary lookups (`LexiconPage<LanguageLookupEvent>`), recent practice attempts (`comparison.score`), associations count, and honest unavailable/empty states.
- [x] 2.2 Implement `VocabularyManagerView.tsx` (search, state filter, lemma grouping, surface forms, definitions, source occurrences with jump-to-source, encounter frequency, linked flashcards, manual state changes, bulk ops, known-word import preview/apply — `KnownWordImportRecord {word, state}` — export, ignore/restore, delete).
- [x] 2.3 Implement `LanguageContentHubView.tsx` (uses `buildLearnerContext` from `languageTutor/context`), `LanguagePracticeHubView.tsx` (gates, links, hosts `LanguageVoiceConversation`), `LanguageAnalyticsView.tsx` (evidence-status ladder `ready|stale` = usable), and `LanguagePacksView.tsx`.

## 3. Verification

- [x] 3.1 `src/navigation/__tests__/tabDestinations.test.ts` passes (language-learning path, aliases, label/description keys in en all validated); full 6-locale i18n coverage enforced by `i18n-completeness.test.ts` (17 tests pass); accessibility/typography contracts covered by `src/components/language/__tests__/accessibility.test.tsx` + `hostIntegration.test.tsx`; `npm run check:bundle` passes (30.5 MB total).
