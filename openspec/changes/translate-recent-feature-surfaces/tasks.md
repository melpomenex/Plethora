## 1. Surface Inventory

- [x] 1.1 Enumerate active app destinations and the recently added or expanded feature surfaces attached to them, including mobile variants, dialogs, menus, overlays, empty/error states, and accessibility labels; verify every destination has a source-file entry in the audit inventory (`src/lib/i18n/recentFeatureSurfaceInventory.ts`).
- [x] 1.2 Audit the inventory for application-authored visible strings, user-visible attributes, feedback messages, privacy/cost disclosures, and error mappings; verify each finding is marked for translation or has a documented exception for user/generated/imported/third-party content.

## 2. Study Plans Localization

- [x] 2.1 Route Study Plans list, creation, editor, curriculum, source, research, home, history, and evidence copy through the existing i18n system; verify the covered-source check reports no unapproved literals in these files.
- [x] 2.2 Route lesson, assessment, attempt, results, grading, save-status, and recovery copy through i18n, including placeholders and accessible names; verify the inventory marks these flows complete and source coverage passes.
- [x] 2.3 Replace the hardcoded Study Plans validation and error message table with locale lookups; verify representative storage, generation, privacy-consent, validation, and grading errors render localized recovery text.
- [x] 2.4 Add explicit English, Chinese, Spanish, German, French, and Japanese values for every Study Plans UI key; verify each locale has the required placeholders and no covered key relies on inherited English.

## 3. Other Recent Feature Surfaces

- [x] 3.1 Localize all other uncovered newly added or expanded surfaces identified by the inventory, including navigation entry points and mobile/dialog variants; verify each inventory finding is resolved in all six locales or has a reviewed content exception.
- [x] 3.2 If the audit adds or renames a Settings control or meaningful group, add its stable search target, catalog entry, coverage row/exclusion, and corresponding tests; verify Settings search coverage passes. No Settings controls were added or renamed by this audit.

## 4. Regression Coverage and Verification

- [x] 4.1 Extend i18n coverage checks to detect missing explicit translations for audited feature keys, unresolved translation keys, placeholder mismatches, and hardcoded visible literals in inventoried UI files; verify representative missing-key, English-fallback, and source-literal cases are reported with file/key context.
- [x] 4.2 Run the focused i18n completeness and covered-surface source checks; verify all supported locales pass without an unreviewed exception.
- [x] 4.3 Smoke representative Study Plans and other audited feature flows in `en`, `zh`, `es`, `de`, `fr`, and `ja`; verify labels, accessible names, consent copy, validation/errors, and dynamic placeholders render in the selected locale.
