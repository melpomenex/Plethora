# Tasks

## 1. Contract and repository integration

- [x] 1.1 Define the typed browser organization target, provenance, status, confidence-band, review-reason, and fingerprint contracts for documents, extracts, and learning items.
- [x] 1.2 Map each contract field to document metadata, extract selection context, and learning-item interaction metadata without introducing a second semantic-tag store.
- [x] 1.3 Add compatibility readers for older browser records and extension payloads that lack the new context envelope.

## 2. Browser capture context and persistence

- [x] 2.1 Extend `browser_extension/shared.js`, `content.js`, and `background.js` to collect bounded heading, nearby-text, author, caption/alt, content-kind, and source-identity evidence.
- [x] 2.2 Extend the Rust browser request types and handlers to validate, cap, persist, and version the structured context for page, extract, AI-card, and image-occlusion paths.
- [x] 2.3 Replace new writes of generated operational labels with structured capture provenance while preserving explicit user tags and compatibility reads for historical labels.
- [x] 2.4 Preserve existing loopback/origin, URL, request-body, and image-size security limits with regression tests for malformed and oversized context.

## 3. Canonical target-aware Smart Tagging

- [x] 3.1 Refactor the existing Smart Tagging queue behind a target adapter while preserving the document queue API and existing settings.
- [x] 3.2 Build target-specific classifier context that ranks item-local evidence, bounded source context, and source tags in that order.
- [x] 3.3 Record per-tag provenance, confidence band, inherited-source identity, organization status, and review reason for every target type.
- [x] 3.4 Enforce bounded concurrency, fingerprint idempotency, dismissal/manual protection, and local fallback for offline or unavailable LLM execution.
- [x] 3.5 Add browser save event scheduling for documents, extracts, and learning items, plus startup/refresh reconciliation for missed events and expired leases.

## 4. Needs Review workflow

- [x] 4.1 Add a cross-item virtual Needs Review query and navigation/command entry without moving records into a mandatory inbox.
- [x] 4.2 Reuse existing tag editor primitives for accept, remove, add/create, retag, mark-correct, dismiss, retry, and bulk actions.
- [x] 4.3 Persist user-confirmed and dismissed provenance/tombstones and make all review operations idempotent with partial-failure reporting.
- [x] 4.4 Add empty, loading, deleted-target, low-confidence, and no-result states for documents, extracts, Q&A/cloze, and image-occlusion items.

## 5. Optional preference phase

- [x] 5.1 Decide whether correction memory is in scope for the release; if not, leave it feature-gated and document the follow-up explicitly.
- [x] 5.2 Not applicable for this release: deterministic correction memory remains disabled, so no preference records or classifier inputs are created.

## 6. Verification and handoff

- [x] 6.1 Add unit tests for context budgeting, normalization/inheritance, status transitions, fingerprints, and user-authority conflict handling.
- [x] 6.2 Add integration coverage for page, extract, Q&A, cloze, and image-occlusion persistence contracts plus frontend reconciliation paths.
- [x] 6.3 Add extension tests for legacy payload compatibility, context trimming, retries, and transport/security limits.
- [ ] 6.4 Perform a manual offline and WebView-suspension test, verify no mandatory inbox behavior, and document any optional preference-phase status.
