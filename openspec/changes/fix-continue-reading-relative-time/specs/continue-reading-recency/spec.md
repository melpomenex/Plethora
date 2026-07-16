## ADDED Requirements

### Requirement: Continue Reading SHALL show a realistic imported-time value

Each non-completed document card in Continue Reading SHALL display a relative time derived from the document's import/added timestamp. The timestamp SHALL be normalized to JavaScript milliseconds before it reaches the UI, and the visible copy, tooltip, and accessible name SHALL identify the value as imported time rather than last updated time.

#### Scenario: Native Unix-seconds timestamp is displayed as a recent relative time

- **WHEN** the native progress query returns a document `date_added` value in Unix seconds representing an import two days ago
- **THEN** the API normalizes it to milliseconds and the card displays the localized equivalent of “Imported 2d ago” rather than a multi-decade week count

#### Scenario: Browser Unix-seconds timestamp matches native behavior

- **WHEN** the browser backend returns the same document import instant as Unix seconds
- **THEN** the browser path produces the same normalized relative-time value and user-facing label as the native path

#### Scenario: Very recent import uses the existing human-readable thresholds

- **WHEN** a document was imported less than one minute ago
- **THEN** the card displays the localized equivalent of “Imported just now”

### Requirement: Continue Reading SHALL handle missing import timestamps safely

If a document has no valid import timestamp, Continue Reading SHALL use a valid normalized modification timestamp as a fallback. If neither timestamp is valid, the card SHALL render the safe placeholder `—` and SHALL expose an accessible description that the import time is unavailable.

#### Scenario: Missing import time falls back to modification time

- **WHEN** a document has a missing or invalid `date_added` value and a valid `date_modified` value
- **THEN** the card displays a relative time based on `date_modified` while retaining the explicit imported-time label

#### Scenario: Both timestamps are invalid

- **WHEN** a document has no valid `date_added` or `date_modified` timestamp
- **THEN** the card displays `—` and its tooltip and accessible name communicate that the import time is unavailable

### Requirement: Backend progress projections SHALL preserve recency ordering

The native and browser progress-list implementations SHALL return the import timestamp in addition to the existing document fields, while continuing to sort results by `date_modified` descending. The shared TypeScript mapping SHALL normalize both timestamps at the API boundary and SHALL expose nullable millisecond values to the Continue Reading page.

#### Scenario: Existing ordering remains unchanged

- **WHEN** two eligible documents have different `date_modified` values and any ordering of `date_added` values
- **THEN** the progress list orders the documents by newest `date_modified` first, as it does today

#### Scenario: Older data remains readable

- **WHEN** a backend response omits or returns null for the appended import timestamp
- **THEN** the TypeScript mapper accepts the response, exposes a null import timestamp, and lets the UI apply its modification-time fallback without throwing
