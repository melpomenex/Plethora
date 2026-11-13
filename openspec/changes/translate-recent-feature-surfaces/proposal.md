## Why

Recent feature work has added substantial user-facing areas, especially Study Plans, without routing their screens through the app's translation system. The Study Plans page and navigation labels are translated, but core list, editor, research, lesson, assessment, and grading copy remains hardcoded in English; dictionary key-parity checks can miss this because non-English dictionaries inherit English values.

## What Changes

- Audit the current app for user-facing copy on newly added feature surfaces, including their navigation entry points, mobile variants, dialogs, empty/error states, status messages, and accessible names.
- Route uncovered copy through the existing i18n system and add translations for all supported locales: `en`, `zh`, `es`, `de`, `fr`, and `ja`.
- Localize Study Plans end to end, including creation and editing, curriculum, sources and research, lessons, assessments, results, history, evidence, and grading.
- Strengthen regression checks so inherited English fallback values do not count as translations for newly covered feature keys and unlocalized literals in covered surfaces are reported.
- Keep locale updates and i18n coverage checks in the same change as future user-facing surface additions.

## Capabilities

### New Capabilities

- `i18n-coverage`: Defines localization requirements for newly added app surfaces and verification that detects untranslated or hardcoded UI copy.

### Modified Capabilities

None.

## Impact

- Affected UI: `src/components/study-plans/**`, Study Plans entry points, and any other newly added surfaces identified by the app-wide inventory. This includes the English error-message table in `src/lib/study-plans/studyErrorMessage.ts`.
- Affected localization files: `src/lib/i18n/locales/{en,zh,es,de,fr,ja}.ts`.
- Affected verification: i18n completeness/source-coverage checks and focused locale smoke coverage for the audited surfaces.
- No API or dependency changes are expected.
