## 1. Extend the progress timestamp contract

- [x] 1.1 Add nullable imported/added timestamp fields to `DocumentWithProgress` and the startup progress item types, documenting that API-facing values are JavaScript milliseconds.
- [x] 1.2 Extend the native progress queries for the full Continue Reading list and startup snapshot to select `date_added` while preserving `date_modified` sorting and append the new value to the existing tuple/object contracts.
- [x] 1.3 Extend the browser IndexedDB progress projection to return `date_added` alongside the existing progress and modification timestamp, preserving compatibility with documents that lack the field.
- [x] 1.4 Normalize both native and browser timestamp values at the TypeScript API boundary, including startup snapshot mapping, while accepting omitted/null appended values from older data.

## 2. Update Continue Reading presentation

- [x] 2.1 Change Continue Reading cards to format the imported timestamp first and fall back to the normalized modification timestamp when import time is unavailable.
- [x] 2.2 Replace the ambiguous “Last updated” tooltip/accessible copy with localized “Imported {relative}” wording and an explicit unavailable-time message.
- [x] 2.3 Update all supported locale dictionaries (`de`, `en`, `es`, `fr`, `ja`, and `zh`) so the new label and fallback copy remain consistent across languages.

## 3. Add regression coverage

- [x] 3.1 Update browser backend contract tests to assert the appended import timestamp and preserve the existing modification timestamp behavior.
- [x] 3.2 Add position API/relative-time tests proving Unix-second import timestamps normalize to milliseconds and render realistic minute/day/week values instead of multi-decade week counts.
- [x] 3.3 Add Continue Reading rendering coverage for the imported label, missing-import fallback, invalid-both-timestamps placeholder, tooltip, and accessible name.
- [x] 3.4 Run the focused Vitest suites plus the repository TypeScript/lint validation and confirm native/browser progress ordering is unchanged.
