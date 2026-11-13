## Purpose

Defines localization behavior for newly added and recently expanded user-facing app surfaces, and prevents English fallbacks or source literals from being mistaken for complete localization.

## ADDED Requirements

### Requirement: User-facing copy on covered feature surfaces follows the selected locale

All application-authored user-facing copy on the surfaces included in the localization audit SHALL render in the selected supported app locale. This includes visible labels, instructions, placeholders, accessible names, status and error messages, privacy and cost disclosures, confirmations, and empty states. Product names, third-party names, user-authored content, and generated or imported content MAY remain in their original language.

#### Scenario: Study Plans surfaces use the selected locale
- **WHEN** a user opens Study Plans in a supported non-English locale
- **THEN** the plan list and creation flow, editor, curriculum and source views, web research, lessons, assessments, results, history, evidence, and grading controls display localized application copy
- **AND** screen-reader names, placeholders, disclosures, statuses, and errors use the same locale

#### Scenario: Locale changes across audited feature surfaces
- **WHEN** a user changes the app locale and opens a covered feature surface
- **THEN** its navigation entry, controls, dialogs, and feedback messages render in the newly selected locale
- **AND** dynamic values such as counts, titles, URLs, and provider names remain correctly substituted

#### Scenario: Feature error is displayed
- **WHEN** a covered feature returns a known error or validation message
- **THEN** the user sees the localized recovery message rather than a hardcoded English sentence or raw translation key

### Requirement: Covered feature translations are explicit and regression-checked

Every application-authored translation key introduced or touched for a covered surface SHALL have an explicit value in each supported locale (`zh`, `es`, `de`, `fr`, and `ja`) in addition to the English source value. The existing English fallback SHALL NOT count as translation coverage. Automated checks SHALL detect unresolved keys, missing explicit locale entries, unlocalized source literals in covered surfaces, and placeholder mismatches. A reviewed allowlist MAY exempt universal terms or proper names that are intentionally unchanged.

#### Scenario: Translation is missing from a supported locale
- **WHEN** a covered English key has no explicit translation in one supported non-English locale
- **THEN** the localization completeness check fails and identifies the key and locale

#### Scenario: English fallback is inherited
- **WHEN** a covered locale dictionary only inherits a key from the English dictionary
- **THEN** the localization completeness check reports the key as untranslated even though runtime lookup can resolve it

#### Scenario: A hardcoded user-facing literal is added
- **WHEN** user-facing JSX text or a user-visible string attribute is added to a covered surface without using the translation system
- **THEN** the source-coverage check reports the file and literal unless it matches a reviewed allowlist entry

#### Scenario: Placeholder tokens are translated
- **WHEN** a covered translation contains formatted values
- **THEN** every locale preserves the English key's placeholder names so runtime values render without loss or unresolved tokens
