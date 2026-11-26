# Proposal: Add Optional Study Mode and Learner Preferences

## Problem Statement

Plethora lacks an optional, non-intrusive **Study Mode** inside document readers and Study Plans, as well as optional subject-specific learner preferences (distinct from `language_profiles`). Users must be able to read documents normally with zero interruptions, activate Study Mode explicitly on demand, exit immediately back to the exact reading position, and optionally personalize explanations.

## Goals

1. **Optional Reader Study Mode**: Add a compact, non-intrusive Read/Study toggle in `DocumentViewer` header (and Command Palette / document context menu), plus a responsive Study Mode workspace (`Learn`, `Source`, `Practice`, `Mind Map`, `Audio`, `Slides` tabs with progressive disclosure) on desktop and mobile.
2. **Optional Learner Preferences (Migration 163)**: Add `study_learner_preferences` (global + subject-specific overrides for self-reported knowledge level, interests, familiar domains, explanation detail, vocabulary tolerance, teaching approach, example preference, question difficulty) without requiring onboarding or a profile.
3. **Bounded Learner Context**: Construct a compact, token-budgeted learner context packet reusing the `languageTutor/context.ts` pattern.
4. **Settings & Discoverability**: Add a Study Mode settings section with `<SettingsSearchTarget>` + `settingsSearchCatalog.ts` + i18n coverage (defaulting to conservative, non-intrusive values), and fix the missing `TTSSettings` Hands-Free Study Mode search targets.

## Dependencies

- `consolidate-study-mode-learning-foundation`.

## Non-Goals / Out of Scope

- Requiring learner profile setup or onboarding modals on document open.
- Replacing `language_profiles` for foreign-language learning.
