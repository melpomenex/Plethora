## 1. Saved annotation target contract

- [x] 1.1 Add explicit extract/document ownership to persisted annotation descriptors and extend reader context-menu payloads/state to support an annotation target without selected text. Verify type checking and focused tests for descriptor ownership, including multi-page PDF and multi-range EPUB records.
- [x] 1.2 Implement target resolution and precedence over unrelated selection/link state, with explicit choices for overlapping saved annotations. Verify tests for repeated passage text, multiple candidates, temporary marks, and no-hit fallback.

## 2. Reader event bridges

- [x] 2.1 Wire Markdown and HTML/OCR HTML context-menu handlers to resolve persisted marks before their empty-selection return paths. Verify no-selection right-click, cross-iframe target checks, coordinate translation, and existing selection/link fallback tests.
- [x] 2.2 Carry ownership through EPUB annotations and resolve SVG/range hits without blocking text selection; clean up listeners across rendition/content changes. Verify EPUB integration tests for right-click without selection, chapter remount, multiple range fragments, and iframe placement.
- [x] 2.3 Add PDF fixed-layout hit testing using the same viewport conversion as rendered saved rectangles. Verify targeted tests under zoom, rotation, scrolling, and multi-page annotations while drag selection remains functional.
- [x] 2.4 Resolve PDF reflow annotation targets using saved mark ownership and canonical/resolved range geometry. Verify reflow tests target the same extract as fixed layout and do not treat a stale selection or unrelated mark as the clicked annotation.

## 3. Removal action and persistence

- [x] 3.1 Add the localized Remove highlight/extract menu action and reuse/factor the existing extract delete confirmation flow with passage identification. Verify confirmation, cancellation, keyboard activation, destructive styling, and shared-menu dismissal in component tests.
- [x] 3.2 Route confirmed removal through the existing extract store/API; snapshot and validate ownership, dismiss stale menus on document changes, and prevent duplicate pending submissions. Verify tests for deletion failure, already-deleted targets, navigation during confirmation/deletion, and repeated activation.
- [x] 3.3 Reconcile all fragments and affected extract/list/minimap/count state after persistence; refresh or invalidate loaded queue data and distinguish refresh failure from deletion failure. Verify integration tests for one count decrement, no actionable queued extract, surviving overlapping marks, retained reading position, and refresh failure after successful deletion.
- [x] 3.4 Verify desktop and browser fallback use the existing deletion semantics, including linked learning-item policy. Add focused regression coverage where needed and confirm removed records remain absent after reopening without altering source content or unrelated records.

## 4. Integration validation

- [x] 4.1 Run the changed reader/menu/API regression suites with `npm run test:run -- <affected-test-paths>`, plus `npx tsc --noEmit` and ESLint on changed source files. Record passing checks and any pre-existing failures separately.
- [x] 4.2 Exercise the available browser fixture for saved marks, cancel/remove/reopen, overlap handling, persistence, iframe placement, and compact viewport behavior; record results and document unavailable native format/entry-point coverage.
- [x] 4.3 Run `npm run bench:check` locally after preparing the current bundle required by its budget check. Verify no performance or bundle regressions; if an intentional performance/bundle change is necessary, update its baseline/budget with an explanation under the repository protocol rather than masking a regression.
- [x] 4.4 Run `openspec validate remove-document-annotations-via-context-menu --strict` and verify every requirement scenario has automated coverage or a recorded manual validation result before marking implementation complete.
