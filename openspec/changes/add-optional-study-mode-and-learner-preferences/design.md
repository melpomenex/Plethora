# Design: Add Optional Study Mode and Learner Preferences

## Data Model (Migration 163)

- `study_learner_preferences`: `id TEXT PRIMARY KEY`, `subject_key TEXT NOT NULL DEFAULT '__global__'`, `knowledge_level TEXT`, `interests_json TEXT NOT NULL DEFAULT '[]'`, `familiar_domains_json TEXT NOT NULL DEFAULT '[]'`, `explanation_detail TEXT NOT NULL DEFAULT 'balanced'`, `vocabulary_tolerance TEXT NOT NULL DEFAULT 'standard'`, `explanation_language TEXT`, `teaching_approach TEXT NOT NULL DEFAULT 'balanced'`, `example_preference TEXT NOT NULL DEFAULT 'everyday'`, `question_difficulty TEXT NOT NULL DEFAULT 'adaptive'`, `updated_at TEXT NOT NULL`.

## UX & Settings Contract

- `settingsStore.ts`: `studyMode: { showEntryPoints: true, rememberModePerSource: false, enablePersonalization: false, checkSuggestionMode: 'manual', questionFrequency: 'section', localOnlyPreferred: false, enableCaching: true }`.
- **Default Reading Unchanged**: `DocumentViewer` opens in ordinary Read mode; Study Mode workspace (`StudyModeWorkspace.tsx`) only mounts when explicitly activated. Exiting Study Mode returns to the exact scroll/page/CFI/timestamp position.
- **Settings Search & i18n**: All Study Mode settings and Hands-Free Study Mode settings wrapped in `<SettingsSearchTarget>`, cataloged in `settingsSearchCatalog.ts`, and localized in `src/lib/i18n/locales/`.
