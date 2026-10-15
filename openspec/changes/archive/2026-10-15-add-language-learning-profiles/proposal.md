## Why

Plethora has application locale settings and document language metadata, but it has no durable learner identity for a target language. That prevents the existing readers, Queue, dictionary, TTS, transcription, review, and analytics systems from becoming language-aware without contaminating ordinary reading.

## What Changes

- Add first-class, multi-profile language-learning records with target language, base/explanation language, proficiency estimate, preferences, and processing capabilities.
- Add non-destructive document/media-to-profile associations with automatic suggestion, explicit enable, and explicit disable states.
- Store the active profile separately from the application UI locale and preserve per-document overrides.
- Add profile settings, import/export/sync rules, deletion behavior, and migration for existing content language metadata.
- Expose a shared profile context to readers, Queue, dictionary, TTS/transcription, analytics, AI, and future practice modes.

## Dependencies

- Hard dependencies: none; this is a foundation contract.
- Soft dependencies: `complete-app-internationalization` for application-locale terminology; `add-collections` for deciding whether profile associations are collection-scoped.
- This proposal extends document metadata and settings; it does not replace application i18n or collections.

## Capabilities

### New Capabilities

- `language-profiles`: Profile persistence, associations, activation, settings, detection suggestions, migration, and platform behavior.

### Modified Capabilities

- None. Existing application locale behavior remains unchanged.

## Impact

- SQLite migrations/repositories/commands for `language_profiles`, profile preferences, and content associations.
- TypeScript API/store/settings surfaces and localized settings UI.
- Document import metadata and reader entry points, without mutating source content.
- Sync/backup/export schemas, account scoping, mobile/e-ink presentation, and tests for multi-profile isolation.
