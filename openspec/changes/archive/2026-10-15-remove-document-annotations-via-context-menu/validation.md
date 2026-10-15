# Annotation removal validation

Validated on 2026-10-15. Implementation and all available browser validation are complete. The native format/entry-point matrix remains an explicitly recorded validation limitation.

## Automated checks

- 121 tests passed across 14 suites, including the real EPUB and PDF reader event bridges, Markdown, fixed/reflow PDF geometry and ownership, text overlap repainting, shared menus, deletion, extract counts, and extracts-list concurrency. The final API/dialog subset rerun also passed all 24 tests after the last edits.
- `npx tsc --noEmit` passed; the final `build:check` also ran TypeScript successfully.
- ESLint on changed source and test files: zero errors; 39 existing warnings in the surrounding reader/locale files. New menu/helper/tests have no lint findings.
- `npm run build:check` passed, including product documentation validation and bundle budgets. The final build includes the browser ownership fix, contextmenu propagation fix, and HTML mobile/link fallback guards.
- `npm run bench:check` passed: 53 benchmarks compared; bundle budget passed. It reported stale-baseline warnings for benchmarks measuring faster than their recorded baseline; no baseline/budget changes were made.
- Ripwire quality delta: no gating regressions. The optional ownership parameter on `deleteExtract` has no incompatible indexed callers.
- Impeccable detector on the new menu and reused deletion dialog: no findings.
- `openspec validate remove-document-annotations-via-context-menu --strict` passed.

## Behavioral coverage

| Requirement/scenarios | Evidence |
| --- | --- |
| Saved marks work without selection, including reopened records | `annotationContextMenu.test.tsx`, real EPUB/PDF reader tests, and browser persistence check below |
| Correct ownership for repeated text, overlapping marks, multiple page/CFI fragments | `annotationContextMenu.test.tsx`, `EPUBViewer.test.tsx`, `PDFViewer.navigation.test.tsx` |
| Confirm, cancel, deletion error/retry, duplicate confirmation, navigation/unmount | `AnnotationRemovalMenu.test.tsx`, `extracts.annotationRemoval.test.ts` |
| Persist record removal, retain source/unrelated annotations, preserve linked-card policy | API deletion tests, text overlap/survivor repaint tests, browser reload check |
| Counts, loaded queue entries, extract state/list updates, post-persistence reconciliation failure | API deletion/count tests and existing extracts-list regression suite |
| Browser ownership/anchor aliases and soft-deletion tombstones | API annotation-removal tests plus browser fixture using real IndexedDB backend |
| Native command dispatch and unchanged native deletion semantics | Existing and new API tests; native repository deletion path inspected, with no backend changes |
| Plain-selection fallback, temporary marks, cross-document DOM, transformed PDF geometry, canonical reflow word IDs | `annotationContextMenu.test.tsx`, `pdfContextMenu.test.ts`, existing Markdown search and highlight/reflow suites |
| Menu keyboard control, dismissal, opening-event propagation | Shared menu tests plus synchronous-mount regression in `AnnotationRemovalMenu.test.tsx`; browser check |
| HTML iframe placement and compact action sheet | Browser fixture using real saved text marks, shared hit testing, menu, dialog, and extract API |
| Queue reader integration | Queue Scroll Mode uses the same `DocumentViewerWrapper`; all three viewer callbacks now preserve annotation payloads |

## Browser checks

Used a disposable development fixture with the real `MarkdownViewer`, anchored-mark painter, `AnnotationRemovalMenu`, deletion confirmation, extract store/API, and browser IndexedDB backend. It exercised:

1. Restoring three overlapping saved records without any active selection.
2. Right-clicking a mark and opening an explicit annotation chooser.
3. Canceling confirmation: three records and their marks remained.
4. Confirming one removal: two records remained and the surviving mark/source text stayed visible.
5. Reloading the page: two records remained, confirming durable deletion.
6. Rendering the same saved records inside an HTML iframe: right-click opened the shared menu at the passage's on-screen location.
7. A 390×844 viewport: the shared action appeared in its compact sheet presentation.

This pass exposed and fixed two issues: camelCase browser records were not normalized into the API's snake_case ownership contract, and the opening right-click could dismiss a newly mounted menu as it bubbled to document listeners. Both have regression tests.

The fixture source files were removed from the checkout, the temporary browser tab was closed, and its viewport override was reset. No production UI/debug route is added.

## Final check results

The final production build passed with a 5 KB entry, one PDF worker, and a 24.5 MB bundle. The recorded final benchmark run passed all 53 comparisons and the bundle budget. Two benchmark reruns during commit preparation were noisy: the first reported five unrelated baseline failures, and the second reported only `ankiImport/convert-2000-notes` just over its threshold. Other failures from the first run passed on the second. No performance baselines or bundle budgets changed.

## Remaining native manual validation

The full app's EPUB loader cannot run in the available browser: it reports `getEpubStreamUrl is not available in web mode`. Native computer automation is disabled in this environment. Therefore this pass does not claim physical-device touch/drag validation or the complete EPUB/PDF/OCR format matrix opened from both Documents and Queue in Tauri.

The browser fixture verifies shared behavior; it is not a substitute for testing every native reader entry point. In particular, EPUB loading in the available browser reports `getEpubStreamUrl is not available in web mode`, and native computer automation is disabled. Therefore physical-device touch/drag validation and the complete EPUB/PDF/OCR format matrix opened from both Documents and Queue remain unverified.
