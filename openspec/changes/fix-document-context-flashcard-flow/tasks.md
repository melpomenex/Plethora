## 1. Focused Document Context Foundation

- [x] 1.1 Add shared focused-section request/result and source-reference types, including typed unresolved/ambiguous failures, content hash, exact ranges, labels, truncation, and token metadata.
- [x] 1.2 Update section resolution to validate cached ranges against canonical current text and structurally re-resolve by document, title, hierarchy, and breadcrumb without defaulting to offset zero.
- [x] 1.3 Update the shared LLM request-content builder so prompt content and structured provider context are derived from the same resolved focused text.
- [x] 1.4 Add unit tests for exact section extraction, duplicate-heading disambiguation, stale references, ambiguous failures, multi-section delimiters, and over-budget truncation anchored at the selected section start.

## 2. Document Q&A and Assistant Section Flow

- [x] 2.1 Refactor Document Q&A `#` selection and submission to retain structured section references, load canonical document text, resolve immediately before sending, and preserve the user's query on failure.
- [x] 2.2 Refactor Assistant `#` selection and submission to use the same focused-context resolver and provider-boundary request builder as Document Q&A.
- [x] 2.3 Attach validated document/section provenance to flashcard tool arguments and assistant message metadata without persisting full source bodies in conversation history.
- [x] 2.4 Add integration tests that select a non-opening EPUB/document chapter and assert both assistant surfaces send that section—not the document beginning—to the LLM and card tools.
- [x] 2.5 Add negative integration tests proving stale, ambiguous, and ownerless section references send no LLM request and display actionable reselection guidance.

## 3. Shared Flashcard Tool Artifacts

- [x] 3.1 Define the normalized chat flashcard artifact model for Q&A and cloze content, stable identity, lifecycle status, persisted card ID, source reference, timestamps, and per-card errors.
- [x] 3.2 Extract shared flashcard creation-intent instructions, tool-call parsing/normalization, and execution lifecycle from Document Q&A and Assistant while retaining generic non-card tool support.
- [x] 3.3 Update tool execution to transition each card independently through pending, saved, and failed states, preserve readable content, attach document/section source, and support retrying only failed cards.
- [x] 3.4 Defensively normalize legacy local/synced conversation messages and derive artifacts from valid historical card tool calls when typed artifacts are absent.
- [x] 3.5 Add parser, normalization, persistence, mixed-tool, partial-failure, retry, and legacy-message tests using Q&A and cloze fixtures.

## 4. Interactive In-Chat Card Experience

- [x] 4.1 Build a shared compact card collection with count, card type, front/cloze content, restrained answer preview, source label, and pending/saved/failed state using existing design tokens.
- [x] 4.2 Add progressive disclosure for large batches and responsive behavior that keeps the collection readable in narrow Assistant and wider Document Q&A layouts.
- [x] 4.3 Make card rows keyboard and pointer operable with semantic controls, visible focus, meaningful accessible names, reduced-motion support, and an inline retry action for failures.
- [x] 4.4 Connect saved rows to the existing card detail/editor entry point and draft rows to an editable draft/Studio flow without losing generated content or provenance.
- [x] 4.5 Replace card-specific raw tool rows in Document Q&A and Assistant with the shared collection while leaving non-card tools in the generic renderer.
- [x] 4.6 Add component tests for compact rendering, expand/collapse, keyboard activation, click routing, source/state labels, partial failure/retry, and accessible semantics in both host surfaces.

## 5. Flashcard Studio Context Reliability

- [x] 5.1 Centralize `ContextSelection` normalization for nullable/legacy chapters, search results, excerpt, page range, EPUB metadata, and other persisted or seeded fields.
- [x] 5.2 Audit Flashcard Studio context management and guard every optional string/collection before trimming, measuring, iterating, indexing, or calculating ranges.
- [x] 5.3 Load EPUB and other missing document bodies through the canonical document text loader/extractor, cache by document/content hash, and present loading, empty, retryable error, and ready states.
- [x] 5.4 Reset or revalidate document-bound chapter, section, search, excerpt, and page selections when the selected document changes while preserving valid explicit seeds.
- [x] 5.5 Block generation for unresolved explicit context modes and remove fallbacks that substitute the first token-budget slice of the document.
- [x] 5.6 Add regression tests for the `null is not an object (evaluating 's.length')` EPUB path, null/legacy restored state, missing extraction, document switching, valid excerpt seeds, and unresolved chapter/search modes.

## 6. End-to-End Verification

- [x] 6.1 Add end-to-end fixtures for creating mixed Q&A/cloze batches from a selected non-opening EPUB section in Document Q&A, Assistant, and Flashcard Studio.
- [x] 6.2 Verify created cards are persisted once, display as interactive artifacts with the correct source, open in the expected editor/detail flow, and survive conversation reload.
- [x] 6.3 Run targeted frontend unit/integration tests, TypeScript checks, formatting/lint checks, and relevant Rust tests for document extraction boundaries.
- [x] 6.4 Manually verify desktop and narrow layouts, keyboard-only operation, screen-reader labels, dark/light themes, large batches, provider failure, and EPUB context recovery.
