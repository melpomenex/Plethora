## 1. Establish Regression Coverage

- [x] 1.1 Add `sectionIndex` fixtures that reproduce title-only PDF outline and EPUB TOC nodes, duplicate heading titles under different parents, and parent headings with nested descendants.
- [x] 1.2 Add failing tests for stale/out-of-range section metadata, legitimate short source sections, unmatched outline entries, and document identity mismatches.
- [x] 1.3 Add a Document Q&A provider-boundary test that selects a `#` heading and asserts body phrases appear in both the composed user message and `chatWithContext` context payload instead of only the title.

## 2. Make Section Indexes Content-Aware

- [x] 2.1 Add explicit section source/provenance and authoritative-range metadata without breaking existing popup/navigation consumers.
- [x] 2.2 Change extracted-heading range calculation so a section ends at the next heading of the same or higher level and parent selections include descendant subsections.
- [x] 2.3 Replace global title de-duplication with one-to-one structural reconciliation using normalized titles, breadcrumb compatibility, level/location hints, and monotonic document order.
- [x] 2.4 Enrich matched PDF/EPUB outline nodes with extracted `startChar`, `endChar`, preview, and body content while retaining outline page/href and hierarchy metadata.
- [x] 2.5 Mark unmatched outline/TOC nodes unresolved rather than representing their title as body content, and version/invalidate the in-memory cache if the section model semantics require it.

## 3. Resolve and Assemble Canonical Focused Context

- [x] 3.1 Implement a pure send-time resolver that validates selected IDs, document identity, ranges, and content snapshot, then rebinds recoverable stale or title-only nodes against current text.
- [x] 3.2 Resolve multiple selections in document order, coalesce overlapping ranges, retain all selected labels, and fail atomically when any requested section is unresolved.
- [x] 3.3 Refactor focused-context assembly to return canonical formatted text, resolved labels, token estimate, truncation state, and diagnostics.
- [x] 3.4 Update token budgeting to prioritize selected bodies, add optional parent/previous/next context only with remaining capacity, truncate on sensible boundaries, and emit explicit truncation markers.
- [x] 3.5 Make section chips and request-time estimates use resolved context rather than synthetic outline-title length.

## 4. Integrate Document Q&A Submission

- [x] 4.1 Ensure the current document text is loaded or extracted before resolving `#` selections and prevent tokens from resolving against a newly selected different document.
- [x] 4.2 Replace the current `matchedSectionId` shortcut with resolution of every section token and pass the canonical focused context into `buildMultiDocumentContext` or its replacement.
- [x] 4.3 Use the same canonical focused body in the composed user prompt and `chatWithContext` structured context while preserving the user's configured provider, model, and controls.
- [x] 4.4 Add a clear no-send error/system message for unavailable section context with guidance to retry extraction or reselect the heading; do not silently fall back to a title, partial selection set, or full document.
- [x] 4.5 Clear or refresh selected-section UI state when the target document/content changes, while keeping normal non-section Document Q&A behavior unchanged.

## 5. Verify Supported Sources and Regressions

- [x] 5.1 Verify automated cases for Markdown/text, PDF outline, EPUB TOC, duplicate titles, parent/leaf ranges, multiple and overlapping mentions, extraction fallback, stale IDs/ranges, truncation, and unresolved context.
- [x] 5.2 Run existing section index, SectionMentionPopup, Document Q&A, Assistant section-mention, and LLM adapter tests and fix any regressions caused by the shared index changes.
- [x] 5.3 Manually select headings from representative Markdown/text, PDF, EPUB, and HTML section fixtures in Document Q&A and confirm focused context reflects the section body and the displayed token estimate is plausible.
- [x] 5.4 Inspect a mocked or debug request for at least two configured provider adapters and confirm the selected section body reaches the provider exactly once through the canonical context path.
