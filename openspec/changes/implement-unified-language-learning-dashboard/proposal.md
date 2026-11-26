## Why

Plethora's Language Learning modules currently lack a dedicated top-level destination, vocabulary management interface, content generation studio, analytics view, language pack manager, and guided onboarding. Users cannot discover Language Learning without enabling a hidden flag in Settings and opening a document.

## What Changes

- Register a first-class lazy-loaded `"language-learning"` tab in `tabsStore`, `TabRegistry`, `NAVIGATION_DESTINATIONS`, `Toolbar`, `MobileNavigation`, Command Palette, and `KeyboardShortcuts`.
- Build `LanguageLearningDashboard` with an active profile switcher and dedicated sections for Today/Overview, Vocabulary Manager (search, state filter, lemma grouping, occurrences, bulk actions, known-word import, export, delete), Content & Discovery (coverage, recommendations, personalized content generation & adaptation), Practice & Tutor Hub, Language Analytics, and Language Packs & Capabilities.
- Add an 8-step skippable Guided Onboarding wizard covering native/target language, proficiency target, recommended language packs, offline capabilities, optional AI/speech providers, initial content, and starting a first session.
- Gate dashboard onboarding and in-reader mounts cleanly while allowing users to discover and opt into Language Learning directly from the dashboard.

## Capabilities

### New Capabilities

- `unified-language-learning-dashboard`: First-class navigable Language Learning workspace uniting profile management, today overview, vocabulary manager, content generation/recommendations, practice/tutor hub, analytics, language packs, and guided onboarding.

## Impact

- `src/stores/tabsStore.ts`, `src/components/tabs/TabRegistry.tsx`, `src/navigation/tabDestinations.ts`, `src/components/Toolbar.tsx`, `src/components/mobile/MobileNavigation.tsx`, `src/components/common/KeyboardShortcuts.tsx`.
- New lazy-loaded components under `src/components/language/dashboard/` and `src/components/language/onboarding/`.
- Full localization across `en`, `de`, `es`, `fr`, `ja`, `zh` locales.
