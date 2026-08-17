# Implementation Tasks

## 1. Job kind & server pipeline
- [ ] 1.1 Register `document_reconstruct` (schema, options, page-unit quota binding, progress contract)
- [ ] 1.2 Stage providers on ProviderRegistry: OCR (Mistral-class), layout/reading-order, structure mapping (canonical schema emitter), table/equation/figure extraction
- [ ] 1.3 Checkpoint/resume per page; partial results; artifact storage + TTL policy
- [ ] 1.4 Golden-fixture suite (scanned 2-col, tables, equations, image-only) per engine version

## 2. Client integration
- [ ] 2.1 `api/pdfReflow.ts` cloud write-through into local page cache/assets
- [ ] 2.2 "Improve this document" UI: page-range picker, before/after preview, accept/revert overlay, per-document status
- [ ] 2.3 Low-quality suggestion triggers (text coverage/fallback/OCR confidence) with calm-UX rules
- [ ] 2.4 Pre-flight estimate dialog + cloud-compute disclosure; exclusion-flag enforcement client+server

## 3. Contracts & validation
- [ ] 3.1 Schema additive-version policy note; reindex hint event on completion (7)
- [ ] 3.2 Visual spec extension with reconstructed fixtures; selection/anchor regression tests
- [ ] 3.3 Privacy tests (log scans, TTL deletion); quota tests; partial-failure/resume tests
- [ ] 3.4 i18n 6 locales; full gates
