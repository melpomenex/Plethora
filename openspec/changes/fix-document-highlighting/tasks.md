## 5. Processed passage qualification and extension

- [ ] 5.1 Exercise extract creation and source reload using `api/extracts.ts`, `DocumentViewer.tsx`, `EPUBViewer.tsx`, `PDFViewer.tsx` and `MarkdownViewer.tsx`. Reuse their locator/render adapters for processed-kind markers and per-reader preference. Confirm old ordinary highlights persist. Test overlap, delete, repeated identical quote, document revision and keyboard/touch activation on real persisted fixtures. Record supported/unsupported format results and defer ambiguous locators to the shared return-source fallback.

- [ ] 5.2 Verify existing highlight creation/editing retains color, category, tags and notes in `CreateExtractDialog.tsx` and `api/extracts.ts`. Exercise live projections in native and browser after restart, and update `docs/FEATURES_IMPLEMENTED.md` with qualified formats and degraded behavior.
