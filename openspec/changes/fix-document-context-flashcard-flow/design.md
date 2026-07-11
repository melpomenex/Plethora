## Context

Document Q&A and Assistant both expose `#` heading mentions and flashcard tools, but they independently parse mentions, assemble prompts, execute tools, and render results. The current section path can mix cached outline nodes with freshly extracted text; when an identifier or range is stale, downstream context builders can fall back to the first token-budget slice of the document. Tool calls retain parameters while executing, yet the chat UI renders them as generic status rows (and Assistant exposes serialized parameters), rather than as learning artifacts.

Flashcard Studio has another context model with persisted local state. It normalizes some arrays at use sites, but document and EPUB metadata can still enter as `null`, be restored from an older shape, or remain unloaded because document listings omit full content. Context modes then depend on optional strings/arrays and chapter extraction that may default to the beginning of the document.

The change spans section indexing, provider request boundaries, tool-result modeling, two chat surfaces, local persistence, and Flashcard Studio. It must work offline with configured LLM providers, avoid new dependencies, preserve existing conversations where possible, and keep context within model token limits.

## Goals / Non-Goals

**Goals:**

- Resolve a `#` mention to an authoritative range in the active document text and use that same focused text in every LLM-facing context field.
- Never silently substitute the document beginning when an explicitly selected section cannot be resolved.
- Represent flashcard tool calls as normalized card artifacts with stable identity, source metadata, and lifecycle state.
- Render the same compact, polished, interactive card collection in Document Q&A and Assistant.
- Make Flashcard Studio context state and EPUB loading null-safe, with actionable empty/error states.
- Consolidate card-generation/tooling behavior enough to prevent the two assistant surfaces from drifting again.

**Non-Goals:**

- Replacing the LLM provider abstraction, RAG system, or flashcard database schema.
- Redesigning the full Flashcard Studio modal or review experience.
- Perfect semantic heading detection for unstructured documents with no outline or detectable headings.
- Automatically saving cards when the user asked only to preview or discuss possible cards.

## Decisions

### 1. Use one canonical focused-context request object

Introduce/extend a shared resolver that accepts the active document ID, canonical extracted text, selected section descriptors, and token budget. It returns either a successful object containing resolved ranges, exact content, labels, truncation/source metadata, and a stable context key, or a typed failure. Document Q&A and Assistant will pass this object to a shared request-content builder so the prompt body and structured provider context receive the identical text.

Resolution will prefer authoritative ranges tied to the current content hash, then structurally re-resolve by title and breadcrumb. Explicit selection failures stop before the LLM request and present recovery guidance. Neighbor inclusion is opt-in and clearly delimited; it must not turn a selected section into a slice beginning at offset zero.

Alternative considered: trust cached section `content`. Rejected because cached nodes can outlive text extraction/EPUB navigation changes and reproduce the drift this change addresses.

### 2. Persist section references, not duplicated section bodies

Conversation messages may retain a lightweight source reference (document ID, section IDs/labels, content hash, and optional range metadata) for display and retry. The full document or section body will not be copied into persisted chat history. Before a new request or retry, references are revalidated against current canonical content.

Alternative considered: persist full focused text. Rejected because it increases local/synced conversation size, duplicates copyrighted source material, and becomes stale after re-extraction.

### 3. Normalize tool calls into typed flashcard artifacts

Create a shared adapter from `create_qa_card` and `create_cloze_card` tool calls/results to a `ChatFlashcardArtifact` model. It includes a stable artifact ID, type, front/question, back/answer or cloze text, status (`pending`, `saved`, `failed`), persisted card ID when available, error message, document/section source reference, and timestamps. Existing generic tool calls remain supported.

Execution updates artifacts in place and preserves useful card data after completion. Conversation deserialization defensively validates optional arrays and fields, allowing older messages with only `toolCalls` to derive artifacts at render time.

Alternative considered: infer cards only in the React renderer. Rejected because persistence, retries, status transitions, analytics, and cross-surface consistency require a domain model outside presentation code.

### 4. Share an in-chat card collection component

Both chat surfaces will render flashcard artifacts through one component. The default layout is a dense list with a collection header/count and per-card rows showing type, a useful front preview, a restrained answer preview, source label, and state. A row is a real button/list item with visible focus, screen-reader labels, and no nested interactive controls. Activating it opens the existing card detail/editor/studio route appropriate to whether the card is saved or still a draft. Failed items expose an inline retry action and error detail; pending items remain readable while showing progress.

The component will use existing design tokens, responsive widths, and motion preferences. Raw JSON and internal tool names will not be the primary user presentation, though non-card tools continue through the generic tool renderer.

Alternative considered: embed full flashcards as large chat bubbles. Rejected because batches would dominate the conversation and make scanning difficult.

### 5. Normalize Flashcard Studio context at every boundary

Define a single `normalizeContextSelection` contract that converts nullable/legacy persisted values to a complete safe shape. Normalize document content, chapter lists, search results, page ranges, excerpts, and EPUB TOC values before any `.length`, `.trim`, iteration, or range calculation. Reset document-bound context when the selected document changes unless it came from an explicit seed for that document.

For EPUBs whose list entry lacks content, Flashcard Studio will use the canonical document text loader/extractor also used by Document Q&A. Context management shows loading, empty, and recoverable error states rather than evaluating incomplete data. Explicit chapter/section mode with no resolvable selection disables generation instead of reverting to the first document slice.

Alternative considered: add optional chaining only at the observed crash line. Rejected because nullable restored state and incomplete document metadata enter through several paths and would continue causing inconsistent behavior.

### 6. Share card-creation prompt and execution policy

Extract common flashcard-tool instructions, tool-call normalization, and execution lifecycle for Document Q&A and Assistant. The policy distinguishes preview/discussion from create/save intent, requires tool calls for creation intent, attaches the active document and focused section source automatically, and yields one user-facing artifact collection. Parser compatibility fallbacks remain isolated and covered by fixtures, but raw JSON is not rendered to users.

## Risks / Trade-offs

- [Structural re-resolution can select the wrong duplicate heading] → Include breadcrumb/level/content-hash signals, reject ambiguous matches, and ask the user to reselect instead of guessing.
- [Strict failure replaces a previously permissive fallback] → Provide an actionable inline message and keep the original query in the composer for retry.
- [Large card batches can still make chat noisy] → Use a compact collapsed/expandable collection with an initial visible subset and total count.
- [Old conversations lack artifact IDs or source metadata] → Derive deterministic display IDs from message/tool-call position and treat missing source fields as optional.
- [Saved card navigation differs by host surface] → Expose a small callback interface from the shared component and use existing studio/editor entry points in each host.
- [Canonical extraction adds latency for EPUBs] → Show context loading state, cache by document/content hash, and avoid re-extraction while a valid result exists.

## Migration Plan

1. Add the focused-context and flashcard-artifact types/adapters with unit tests while keeping current callers compatible.
2. Move Document Q&A and Assistant to the shared request/tooling pipeline behind their existing UI entry points.
3. Add the shared artifact collection and retain the generic renderer for non-card tools and legacy calls.
4. Harden Flashcard Studio normalization and canonical EPUB loading, then add restored-state regression fixtures.
5. Ship without a database migration; normalize legacy local/synced conversation and studio state on read.
6. Roll back by reverting the frontend change; persisted additions are optional fields and older clients ignore them.

## Open Questions

- Which existing card detail/editor entry point should be the default click target for a newly saved card in each host surface?
- Should a large generated batch default to showing three or five card rows before expansion?

