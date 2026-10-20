## Why

P0: passage classification and a persistent score cache exist, but no reader controller invokes them. Reading should reveal useful, unobtrusive suggestions without scroll jank, unsolicited cloud work or library-wide scanning.

## Current Verified Behavior

`runPassageClassification` in `src/lib/ai/tasks/definitions/passageClassificationTask.ts:85` has no production caller at `615570ff`. `passage_scores.rs` provides registered get/put commands and backend tests, but no frontend adapter is present. Existing active-recall sampling is an approximate scroll/text heuristic, insufficient for precise margin anchors. The schema comment and archived design D23 say **above 0.75**; one archived task says ≥0.75. Use strict `> 0.75`, with an explicit boundary test. See [audit](../../planning/ai-learning-completion-audit.md).

## What Changes

- Add source-specific, stable passage adapters and a viewport/idle controller over the existing classifier and cache.
- Bound eligibility, concurrency, pending work, cache residency and inference usage; invalidate by content and classifier revision.
- Show accessible anchored indicators and route explicit actions to existing extract/card/cloze/highlight workflows.
- Stop work when disabled, suspended, navigated away or denied consent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-knowledge-relationships`: refine the existing Passage extract-worthiness requirement into a complete reader contract.

## Scope and Non-goals

PDF text/reflow/OCR-HTML, EPUB, HTML, Markdown, plain text and saved/unsaved RSS reading surfaces are evaluated explicitly. Inaccessible frames, image-only documents without authorized OCR and media playback remain unavailable with an explanation. No whole-library classification, automatic OCR, automatic card creation, new semantic index or change to active-recall sampling.

## Impact

Reader host/adapters, `SelectionActionsSheet`, selection action registry, a thin passage-score API, the existing Rust cache and Settings search only if a user control is added. Readers retain their own coordinates and navigation anchors.

## Dependencies

Initialization 1.1 and diagnostics 1.1 shared contracts. Runs in parallel with agent work after contracts land. Knowledge coverage is not required. The knowledge change owns other requirements in the same base spec; this change owns only Passage extract-worthiness.

## Compatibility Risks

Content hashes alone do not identify classifier revisions, locations or dismissals. Reflow/iframe remounts can invalidate geometry without invalidating scores. Default-true flags cannot authorize cloud background classification.

## Definition of Done

Production reader tests prove eligible passage → cache lookup → one bounded classification → stable indicator → real learning action. Repeat reads reuse scores; document edits invalidate affected scores; disabling causes zero new requests. Geometry, keyboard/touch, cloud-denial, cancellation and budget tests pass on every supported adapter.
