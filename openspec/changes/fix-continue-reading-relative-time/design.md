## Context

Continue Reading currently receives a tuple containing document id, progress, title, and `date_modified`. The native SQL command and browser backend expose that timestamp as Unix seconds, while the UI formatter operates on JavaScript milliseconds. The existing `date_modified` field is also an ambiguous label for users because it can change when a document is edited, synced, or saved at a new reading position.

Documents already persist `date_added`, which has a stable meaning for this card: when the document was imported into the library. The change can therefore fix both the unit mismatch and the ambiguous display meaning without introducing a new database column or migration.

## Goals / Non-Goals

**Goals:**

- Make import time the primary timestamp shown on Continue Reading cards.
- Keep timestamp units consistent across native, browser, and TypeScript boundaries.
- Preserve the existing most-recently-modified ordering used to prioritize cards.
- Provide a useful fallback for legacy records with a missing or invalid import timestamp.
- Make the visible label, tooltip, and accessible name describe the timestamp accurately.
- Cover both backend projections with regression tests.

**Non-Goals:**

- Adding a separate last-opened event or reading-session timestamp.
- Changing document sorting, progress grouping, or reading-position persistence.
- Migrating existing document rows; `date_added` already exists in the document model.
- Changing the shared relative-time thresholds beyond what is needed to prevent unit errors.

## Decisions

### Use `date_added` for the user-facing recency

The progress query will return both the existing `date_modified` value and the document's `date_added` value. The UI will format `date_added` and label it as imported/added time. If `date_added` is unavailable or invalid, it will fall back to `date_modified`; if both are invalid, it will render the existing safe placeholder rather than inventing a date.

Using `date_added` is preferred over adding a new `last_opened_at` field because it satisfies the requested behavior with existing persisted data and avoids defining what counts as an open event across PDF, EPUB, video, audio, and web readers.

### Normalize at the API boundary

Both native SQL and browser IndexedDB projections will continue to return Unix seconds in their transport tuple for consistency with the existing command contract. The position API will append the import timestamp to that tuple and normalize it with `normalizeUnixTimestampMs` before constructing `DocumentWithProgress`. The UI and its tests will only consume millisecond timestamps.

Appending the field keeps the existing tuple positions stable for id, progress, title, and modified time while allowing older callers to remain compatible during the change.

### Keep modification time for ordering and fallback only

The native and browser queries will still sort by `date_modified`, so the Continue Reading list does not change its current prioritization. `date_modified` remains available as a fallback for older or malformed rows, but it will no longer be presented as the primary user-facing meaning.

### Make the user-facing copy explicit

The card's visible relative value, tooltip, and accessible label will use the localized equivalent of “Imported {relative}”. This replaces the ambiguous “Last updated” wording and makes it clear why the timestamp is shown.

### Verify native and browser parity

Add mapping coverage for Unix-second import timestamps on both the browser backend contract and the shared position API normalization. Add UI-focused coverage for recent timestamps, missing import timestamps, and the explicit imported label. Existing relative-time unit tests remain the source of truth for output thresholds.

## Risks / Trade-offs

- **[Risk]** Some legacy documents may have malformed or absent `date_added` values. → **Mitigation:** Normalize defensively, fall back to `date_modified`, and render `—` only when no valid timestamp exists.
- **[Risk]** One backend projection could return a different tuple shape and break the mapping. → **Mitigation:** Update native command, browser backend, startup/wire types if they consume the same projection, and add contract tests for each path.
- **[Trade-off]** Import time does not tell users when they last opened a document. → **Mitigation:** Use explicit “Imported” copy rather than implying a reading event; a future last-opened feature can introduce a dedicated field without redefining this contract.

## Migration Plan

No database migration is required. Deploy the expanded read-only response and frontend mapping together. If rollback is needed, the previous client can ignore the appended tuple value and continue using `date_modified`; newer clients retain the existing fields and fallbacks when connected to older data.

## Open Questions

None.
