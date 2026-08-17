# Implementation Tasks

## 1. Job kind & server pipeline
- [x] 1.1 Register `document_reconstruct` (schema, options, page-unit quota binding, progress contract)
- [x] 1.2 Stage providers on ProviderRegistry: OCR (Mistral-class), layout/reading-order, structure mapping (canonical schema emitter), table/equation/figure extraction
- [x] 1.3 Checkpoint/resume per page; partial results; artifact storage + TTL policy
- [x] 1.4 Golden-fixture suite (scanned 2-col, tables, equations, image-only) per engine version

## 2. Client integration
- [x] 2.1 `api/pdfReflow.ts` cloud write-through into local page cache/assets
- [x] 2.2 "Improve this document" UI: page-range picker, before/after preview, accept/revert overlay, per-document status
- [x] 2.3 Low-quality suggestion triggers (text coverage/fallback/OCR confidence) with calm-UX rules
- [x] 2.4 Pre-flight estimate dialog + cloud-compute disclosure; exclusion-flag enforcement client+server

## 3. Contracts & validation
- [x] 3.1 Schema additive-version policy note; reindex hint event on completion (7)
- [x] 3.2 Visual spec extension with reconstructed fixtures; selection/anchor regression tests
- [x] 3.3 Privacy tests (log scans, TTL deletion); quota tests; partial-failure/resume tests
- [x] 3.4 i18n 6 locales; full gates

