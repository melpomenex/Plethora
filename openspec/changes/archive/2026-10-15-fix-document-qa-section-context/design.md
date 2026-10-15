## Context

Document Q&A represents a selected heading as an opaque `#{sectionId}` token. `useDocumentSections` builds that ID from a merged index of extracted-text headings and viewer-provided PDF/EPUB outlines, and `DocumentQATab` later resolves the token and calls `buildSectionFocusedContext` before `chatWithContext`.

The text-heading path has character offsets and body text, but outline converters deliberately initialize `content` to the outline title and do not provide offsets. `mergeOutlineWithHeuristics` skips a heuristic node when an outline node has the same title, so the title-only outline node frequently wins. Duplicate titles are matched globally by title, which can bind content to the wrong chapter. In addition, text-heading ranges currently end at the immediately following heading, so selecting a parent heading excludes its child sections. The request path has no semantic validation that distinguishes a real one-line section from a synthetic title placeholder.

## Goals / Non-Goals

**Goals:**

- Make every accepted Document Q&A `#` selection resolve to meaningful body text from the selected document.
- Preserve outline hierarchy/navigation metadata while enriching nodes with canonical extracted-text ranges.
- Define intuitive parent-section boundaries that contain descendant subsections.
- Use one resolved focused-context value for the LLM-facing prompt and structured context payload.
- Recover deterministically from stale/title-only nodes and report an actionable error when content cannot be resolved.
- Keep focused context within the configured model budget without discarding the selected body in favor of neighbor text.
- Cover the provider boundary in tests so title-only regressions cannot hide behind utility-level tests.

**Non-Goals:**

- Replacing PDF/EPUB extraction, OCR, or the viewer outline stores.
- Changing the `chatWithContext` public signature or any LLM provider integration.
- Persisting section indexes or section selections across document edits/restarts.
- Redesigning the `#` popup or expanding this change into general Assistant behavior, although shared resolver corrections may benefit it.
- Adding semantic/vector matching for headings.

## Decisions

### 1. Separate section navigation metadata from resolved context validity

Extend the section model or introduce an adjacent resolved type that records the source and whether a node has authoritative text bounds. A node is context-ready only when its range is valid for the current full-content snapshot and its resolved body contains non-heading text (or is a legitimately short section identified from source text). Synthetic outline titles are never treated as body content merely because `content` is non-empty.

This uses provenance/range validation rather than a simple `content !== title` check, because a valid section can repeat its title in its body and a genuinely short section can be one line.

Alternative considered: validate only in `DocumentQATab`. Rejected because it duplicates indexing knowledge at the call site and leaves other consumers vulnerable to the same malformed nodes.

### 2. Reconcile outline nodes to extracted headings with structural scoring

During index construction, match each outline/TOC node to at most one extracted heading using normalized title equality as the strongest signal, then breadcrumb/ancestor compatibility, level, page or href hints when available, and monotonic source order. Matching is occurrence-aware, so repeated titles such as “Introduction” consume distinct candidates under their respective parents.

The merged node retains the outline's stable UI hierarchy and navigation fields (`page`, `href`) but adopts the matched heading's `startChar`, computed `endChar`, preview, and content. Unmatched extracted headings remain available in the tree. Unmatched outline nodes remain navigable but are marked unresolved until query-time recovery.

Alternative considered: allow heuristic nodes with duplicate titles to coexist beside outline nodes. Rejected because it creates confusing duplicate choices without guaranteeing the selected outline entry has body text.

### 3. Compute hierarchical section ranges

For each extracted heading, set the section end to the next heading whose level is less than or equal to the selected heading's level, or the end of the document. This means selecting a parent includes its descendant subsections. Also retain an optional direct-content boundary if the UI later needs an immediate-only preview, but focused LLM context uses the hierarchical range.

Alternative considered: retain the current next-heading boundary and concatenate child nodes at request time. Rejected because it risks duplicated text, complicates ordering/truncation, and makes the section model's `content` misleading.

### 4. Resolve tokens against the current document snapshot at send time

Add a pure resolver that accepts selected IDs/nodes, the current document ID, and current full text. It validates bounds, rebinds stale nodes using structural identity where possible, returns ordered resolved sections plus diagnostics, and never crosses into another document. `DocumentQATab` awaits content extraction if needed before resolving.

If a selected token cannot be resolved, the request is not sent as document-grounded Q&A. The UI adds a clear system message asking the user to retry after extraction or choose another section. For multiple mentions, all selected sections must resolve; this avoids silently answering a subset different from what the user selected.

Alternative considered: fall back to the entire document. Rejected because it violates the user's explicit scope, can consume a much larger context window, and conceals the indexing failure.

### 5. Build and pass focused context once

Introduce a focused-context result containing formatted text, resolved labels, estimated tokens, truncation state, and diagnostics. The send handler uses that same formatted text in the user message and the `context.content` supplied to `chatWithContext`; it does not rebuild or append a competing document body downstream.

The existing system prompt may describe the selected labels, but labels are metadata—not a substitute for context. Provider settings remain unchanged, so the user's chosen LLM and model receive the resolved section through the normal adapter.

### 6. Budget the selected body before optional neighbors

Reserve the focused section body first within the available document-context budget. Add parent/previous/next context only from remaining capacity. Truncate at sensible paragraph or line boundaries where possible, include explicit truncation markers, and deduplicate overlapping ranges for multiple selected sections. Token estimates and chips use the resolved body rather than synthetic outline text.

Alternative considered: preserve the current fixed 70% character slice exactly. Rejected because neighbor text can consume budget and character slicing can hide that most of a selected section was omitted. The implementation may retain a conservative reserve for prompts/history, but selected-body priority is mandatory.

### 7. Test both resolution and the LLM call boundary

Add unit fixtures for hierarchy, duplicate titles, unmatched outline entries, stale ranges, multiple/overlapping selections, short legitimate sections, and truncation. Add a Document Q&A integration test with a mocked provider asserting that a selected heading sends body phrases and not merely the title in both the composed user message and `context.content`. Cover extraction fallback and the no-send error path.

## Risks / Trade-offs

- **[Imperfect outline-to-text matching]** → Use conservative one-to-one structural matching and leave ambiguous nodes unresolved for query-time recovery rather than attaching the wrong body.
- **[Parent sections can be large]** → Apply token-aware truncation with explicit markers while preserving the start and representative body content of the selected range.
- **[Index IDs or cached nodes become stale after extraction changes]** → Include the content hash in cache identity, validate offsets against current text, and re-resolve tokens at send time.
- **[Multiple overlapping selections duplicate tokens]** → Sort and coalesce overlapping ranges before formatting context while preserving all selected labels.
- **[Stricter validation blocks some requests that previously returned an answer]** → Provide a specific recovery message and keep general/full-document Q&A available when the user removes the section focus.
- **[Shared indexing changes affect Assistant section mentions]** → Preserve public section IDs/fields where possible and run existing `sectionIndex` and Assistant tests alongside new Document Q&A coverage.

## Migration Plan

1. Add resolver/range behavior and tests without changing provider interfaces or stored data.
2. Update index reconciliation and invalidate in-memory section caches through the existing content/outline hash keys (or a cache-version suffix if needed).
3. Switch Document Q&A section submission to the validated focused-context result and add user-visible failure handling.
4. Run utility, Document Q&A integration, Assistant regression, and provider-adapter tests before release.

Rollback consists of reverting the frontend/index changes; no database or persisted-format migration is required.

## Open Questions

- Whether PDF page-aware extraction exposes sufficiently stable page-to-character offsets to improve structural matching beyond title/order in all viewers; the implementation should use these hints when present without requiring them.
- Whether a future follow-up should expose “include subsections” as a user option. This change defaults parent selections to include descendants because that best matches the meaning of selecting a section.
