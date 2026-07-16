## 1. Learning-item schedule context

- [x] 1.1 Extend the schedule item model and queue-to-schedule mapping with the learning-item question/cloze prompt needed for a fallback title, without changing item IDs, document IDs, or item types.
- [x] 1.2 Add a pure shared schedule-title resolver with bounded prompt previews, parent-document preference, generic-sentinel detection, and a localized learning-item fallback.
- [x] 1.3 Route schedule cards, tables, expanded rows, and mobile rows through the shared resolver; remove direct “Untitled”/“Unknown Document” rendering for learning items.
- [x] 1.4 Add or update translations for learning-item title prefixes, generic fallbacks, and any accessibility labels introduced by the schedule title treatment.
- [x] 1.5 Add regression tests covering titled parents, orphaned/untitled parents, empty prompts, bounded previews, and preservation of review/document-open action identifiers.

## 2. Reading-progress timestamp display

- [x] 2.1 Add shared timestamp normalization and relative-time formatting utilities with an explicit JavaScript-millisecond internal contract and safe invalid-value handling.
- [x] 2.2 Convert `getDocumentsWithProgress` results at the API boundary for both native and browser backends, and audit all `DocumentWithProgress.date_modified` consumers for the new unit contract.
- [x] 2.3 Update Dashboard, Continue Reading tab, and Continue Reading page to use the shared formatter and expose “last updated/modified” context through visible or accessible labeling.
- [x] 2.4 Add regression tests proving Unix seconds from the backends render as recent values, millisecond inputs remain correct, and invalid timestamps never produce `NaN` or implausibly large ages.

## 3. React maximum-update-depth fix

- [x] 3.1 Refactor `normalizePane` to preserve structural sharing for already-valid tab and split panes, allocating new objects only when normalization changes data.
- [x] 3.2 Make MainLayout’s first-pane active-tab synchronization idempotent so unchanged IDs return the current local state without scheduling another render.
- [x] 3.3 Add tests for repeated normalization of valid split panes, correction of malformed persisted pane data, and mounting/rendering the layout with a split pane without React error #185.

## 4. Verification

- [x] 4.1 Run focused schedule, timestamp, pane-store, and component regression tests and resolve any failures.
- [x] 4.2 Run the project type/build validation and lint checks for the changed frontend paths.
- [ ] 4.3 Manually verify Dashboard, Continue Reading, and Schedule on a mobile-sized layout and a persisted split-pane layout, including opening/reviewing a learning item and confirming readable relative dates.
