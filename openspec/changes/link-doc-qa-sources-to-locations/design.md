## Context

Document Q&A (`src/components/tabs/DocumentQATab.tsx`) answers library-wide questions through `ragChat` (`src/api/rag.ts`). The response carries `citations: RagHit[]`, where each hit is `{ documentId, documentTitle, chunkIndex, chunkText, score }`. Today the component flattens those hits into a markdown string appended to the answer:

```
---
**Sources:**
[1] **Title** (score 0.83)
```

That string is rendered with `dangerouslySetInnerHTML` alongside the answer, so the citation is dead text — no location, no click target. Only `sourceDocuments: string[]` (document ids) survives on the message, and it is used solely for the "· 2 docs referenced" header label.

The navigation half already exists and is in production use by the command palette:

- `ExactSearchHitLocation` (`src/types/searchHit.ts`) — a per-format location union (`pdf` page, `epub` cfi/matchIndex, `html`/`markdown` scrollPercent + quote, `youtube`/`audio` timeSeconds).
- `CommandCenter.openDocumentInTab` (`src/components/search/CommandCenter.tsx:1452`) — opens a `document-viewer` tab with `{ documentId, highlightQuery, initialJump, jumpRequestId, autoPlay }`.
- `DocumentViewer` consumes `initialJump` and derives `jumpTextQuote` / `jumpHighlightQuery`, forwarding them to `PDFViewer` (`highlightQuery` + `highlightPageNumber` + `highlightTextQuote`), `EPUBViewer` (`highlightQuery` + `initialSearchTextQuote`), and the HTML/markdown scroll path.

The missing piece is location data. Chunks are produced by `index_document_inner` (`src-tauri/src/commands/rag.rs`) from the document's segmented content and stored in `document_chunk_embeddings` as `(document_id, chunk_index, chunk_text, embedding, content_hash)`. No page, CFI, offset, or timestamp is persisted, so a citation cannot state where it came from without either re-indexing with richer metadata or resolving the location from the chunk text at click time.

## Goals / Non-Goals

**Goals:**
- Every retrieval citation shown under a Q&A answer is clickable and opens its document at the cited passage, highlighted.
- Citations show enough context before clicking (title, quote, resolved location label) to judge relevance.
- No re-index and no database migration: the change must work against the chunks already stored, including a 13k-chunk library.
- A citation whose passage can no longer be located degrades honestly instead of jumping somewhere arbitrary.

**Non-Goals:**
- Changing how chunks are produced, embedded, or stored.
- Inline `[1]`-style citation markers inside the answer body (the model is not asked to emit them today).
- NotebookLM chat sources (`string[]`, no document identity) and the `@doc`-mention answer path, which produces no `RagHit`s.
- Cross-document "show all passages from this document" browsing.

## Decisions

### Resolve locations at click time from `chunkText`, not at index time

**Chosen:** keep `document_chunk_embeddings` untouched. When a source is clicked, load the cited document and resolve the chunk text to an `ExactSearchHitLocation` in the frontend.

**Rejected — persist location metadata on each chunk row:** correct in the long run and cheaper per click, but it needs a schema migration plus a full re-index for every already-indexed document to be useful. The library in question already has an expensive index; invalidating it to make a footer clickable is the wrong trade. Click-time resolution reuses text the viewer loads anyway.

Consequence: resolution is best-effort and can fail (see the unresolved-source decision below). If per-chunk anchors are persisted later, the resolver becomes a fallback rather than the primary path — the UI contract does not change.

### Per-format resolution strategy, keyed on `document.fileType`

The resolver takes `(document, chunkText)` and returns `ExactSearchHitLocation | null`. The quote used for matching is a normalized prefix of `chunkText` (whitespace-collapsed, roughly the first sentence or ~120 characters) — long enough to be unique, short enough to survive the differences between indexed content and rendered content.

- **PDF** — the indexed content for a PDF is the converted HTML emitted by `src-tauri/src/processor/pdf.rs`, which wraps each page in `<div class="page" id="page-N">`. Locate the quote in that content and walk backwards to the nearest `id="page-N"` marker to get the page. Emit `{ kind: "pdf", pageNumber, textQuote }`. The page number is required: `PDFViewer` gates its highlight/scroll effects on `highlightPageNumber`, so a quote-only PDF jump does nothing today.
- **EPUB** — emit `{ kind: "epub", textQuote }`. `EPUBViewer` already searches the book for `highlightQuery` / `initialSearchTextQuote` at open time and jumps to the match, so no CFI is needed.
- **HTML / markdown / plain text** — emit `{ kind: "html" | "markdown", textQuote }`; `DocumentViewer`'s existing quote-scroll path handles it.
- **YouTube / audio / video (transcript-backed)** — find the transcript segment containing the quote and emit `{ kind: "youtube" | "audio", timeSeconds, segmentId, textQuote }`, matching what `CommandCenter` builds for transcript hits.

**Rejected — one generic `highlightQuery`-only jump for all formats:** simpler, but silently does nothing for PDFs, which are the most common Q&A source in this library.

### Carry citations as structured data on the message; keep the markdown footer out of `content`

`content` becomes the answer alone; the assistant message gains `citations?: RagHit[]`. The footer is rendered by a small component below the message bubble.

Consequences worth stating:
- **Copy** — the copy-to-clipboard button currently copies `message.content`, which included the sources text. It must append a plain-text rendering of the citations so copied answers keep their sources.
- **Persistence** — Q&A sessions persist messages; `citations` is an optional field, so sessions saved before this change render exactly as they do today (their sources are already baked into `content`, as text). No migration, no double footer.
- **`sourceDocuments`** stays as-is for the "· N docs referenced" header, derived from citations as it is now.

### Reuse the command palette's tab-opening payload via one shared helper

`CommandCenter.openDocumentInTab` builds a `document-viewer` tab with a per-navigation `jumpRequestId` (so repeated jumps to the same document re-trigger), an icon chosen by `fileType`, and an `autoPlay` flag for time-based jumps — and it has a "document not in cache yet, reload and retry" fallback. Duplicating that in the Q&A tab would guarantee the two drift.

**Chosen:** extract the payload construction into a shared helper (e.g. `src/utils/openDocumentAtLocation.ts`) taking `(documentId, { highlightQuery, initialJump })` plus the `addTab` function, and call it from both `CommandCenter` and the Q&A sources footer. The extraction is behavior-preserving for the command palette; `exact-search-hit-navigation`'s requirements are unchanged and its existing tests guard the refactor.

### Unresolvable sources stay visible and say so

If the document is missing, or the quote cannot be located in its content, the source entry renders with its title and quote but is not activatable, with a short explanation (document no longer available / passage could not be located — the content changed since indexing). Opening the document at page 1 or at the top would look like a successful jump to the wrong place, which is worse than a clear refusal.

Resolution runs when the footer renders (per citation), so the disabled state and the location label are visible before the user clicks rather than after.

## Risks / Trade-offs

- **Quote no longer present in the rendered content** (document re-imported, re-OCR'd, content edited since indexing) → the citation degrades to a non-clickable entry with a stated reason; the answer text is unaffected.
- **Resolution cost on large documents** — matching a quote against a large document's content on the client. → Resolve lazily per citation, cache the result per `(documentId, chunkIndex)` for the session, and cap the scan to a single `indexOf` over the normalized content rather than a fuzzy search.
- **Normalization mismatch between indexed chunk text and rendered content** (entities, whitespace, hyphenation) makes exact matching miss. → Match on a whitespace-collapsed, case-folded prefix; on miss, retry with a shorter prefix before giving up. Accept the remaining misses as unresolved sources rather than guessing.
- **PDFs whose stored content lacks `id="page-N"` markers** (imported through a path other than the Rust PDF converter) → no page resolves, so the source stays non-clickable; covered by the unresolved-source behavior.
- **Refactoring `openDocumentInTab` touches the command palette**, a heavily used path. → Keep the extraction mechanical (same payload, same fallback), and verify command-palette jumps for PDF, EPUB, and transcript results after the change.
- **Older persisted Q&A sessions** keep their sources as inert text inside `content`. → Accepted; back-filling would mean re-parsing markdown footers for no real gain.
