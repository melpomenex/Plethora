## Context

The schedule is assembled from queue items returned by the Rust command layer. Learning items currently expose the parent document title through the shared `document_title` field, while the schedule renderers fall back directly to generic “Untitled” text when that field is empty. The same queue data is rendered in card, table, expanded, and mobile states, so title resolution must be centralized.

The reading-progress command deliberately returns `date_modified` as a Unix timestamp in seconds. Both the native Rust service and browser backend implement that contract, but Dashboard and Continue Reading subtract the seconds value from `Date.now()` without converting units. This makes current dates look decades old.

The app also normalizes the persisted tab-pane tree during every `MainLayout` render. For split panes, the current normalization creates a new child array on every call, which creates a new normalized pane identity. An effect depending on that value then calls `setActivePaneTabId` on every render, producing React error #185 (maximum update depth exceeded).

## Goals / Non-Goals

**Goals:**

- Give every learning-item schedule entry a useful, consistent display title across all schedule layouts.
- Establish one internal timestamp unit and one relative-time formatter for reading-progress surfaces.
- Make pane normalization structurally stable and make active-pane synchronization idempotent.
- Add focused regression tests that reproduce the timestamp, title, and split-pane failure modes.

**Non-Goals:**

- Renaming or rewriting existing document records in the database.
- Changing the queue’s scheduling algorithm, due-date calculations, or review behavior.
- Changing the meaning of `date_modified`; it remains the document’s last-modified timestamp, which includes reading-position saves and may also change for other document edits.
- Replacing the global error boundary or adding a crash-reporting service.

## Decisions

### 1. Resolve learning-item titles at the shared frontend display boundary

Add a small pure title resolver used by `ScheduleView`/queue-to-schedule mapping and any schedule renderer that needs the label. Resolution order:

1. Use a non-blank parent document title that is not a generic unknown/untitled sentinel.
2. If the parent title is unavailable, use a trimmed preview of the learning item’s question or cloze text with a `Flashcard`/learning-item prefix.
3. If neither source is usable, use a localized generic learning-item label rather than “Untitled Document.”

The resolver should preserve the existing `documentId` and item type so opening and reviewing an item continue to work. The backend should continue batching document-title lookups; this change does not write synthetic names into stored documents.

### 2. Normalize Unix seconds once, then format from milliseconds

Keep the native/browser transport contract in Unix seconds for compatibility, but convert the value to JavaScript milliseconds in `getDocumentsWithProgress` (or a shared timestamp utility at that boundary). `DocumentWithProgress.date_modified` will then represent milliseconds internally. A shared `formatRelativeTime` helper will be used by Dashboard, `ContinueReadingTab`, and `ContinueReadingPage`, with a title/accessible label identifying the value as last updated.

This is preferred over unit auto-detection in every component because it gives consumers one explicit internal contract and prevents a future surface from silently repeating the same seconds/milliseconds mistake.

### 3. Preserve pane identity and guard the synchronization effect

Update `normalizePane` to return the original pane when its children and sizes are already valid, including unchanged split panes. It should only allocate a replacement when normalization actually changes data. In `MainLayout`, synchronize the first pane’s active tab with a functional state setter that returns the current state when the ID is unchanged.

The two protections are intentional: structural sharing prevents the dependency from changing spuriously, and the idempotent setter prevents a future normalization or persisted-layout edge case from becoming an update loop. No change is needed to the persisted layout format.

### 4. Test pure contracts and one integration-level render path

Add unit tests for title resolution and relative-time formatting, including Unix seconds and millisecond inputs at the boundary. Add store/component coverage proving an unchanged split pane retains identity and mounting the layout with a split pane does not repeatedly update state. Run the existing TypeScript/lint/test checks as appropriate for the touched areas.

## Risks / Trade-offs

- **[Risk]** A long or sensitive flashcard question could make a poor title. → **Mitigation:** trim to a bounded preview, keep the parent document title preferred, and use the prompt only when source context is missing.
- **[Risk]** Existing callers may rely on `date_modified` being seconds. → **Mitigation:** audit all consumers of `DocumentWithProgress`, convert at the single API boundary, and add a type/formatter regression test so raw transport values do not leak through.
- **[Risk]** Returning the original pane from normalization could preserve malformed nested data. → **Mitigation:** compare normalized children and sizes before returning; add tests for invalid pane data as well as already-valid split panes.
- **[Risk]** The error may also be triggered by another component in a different workflow. → **Mitigation:** remove the confirmed split-pane loop, add a development reproduction test, and keep the error boundary diagnostics available for any unrelated future error.
