# Design

## Context

See proposal.md for motivation. Current state that shapes this design:

- **Selection actions today**: `AssistantPanel` builds a selection action list (`ask-selection`, `summarize-selection`, `copy-selection`) that appends quoted text to the assistant input — a desktop-chat pattern, presented on mobile as the horizontally scrolling pill menu the user flagged.
- **Library Q&A exists as a task**: `askLibrary` (`src/lib/ai/tasks/definitions/libraryTask.ts`) already takes `{ query, sources, contextPassage }`, where `contextPassage` is exactly the "selected passage as untrusted context" slot, and validates citations against retrieved chunks (`validateLibraryAnswer`). Retrieval goes through `SemanticRetriever` (`ai_learning` default, `appsearch-hybrid`, `document-only`) with `RAG_NAMESPACE_LIBRARY`, and `RetrievalResult` already carries `documentId`, `documentTitle`, `headingPath`, and `location` — everything source chips need to deep-link.
- **Scope is one parameter away**: `SemanticRetrieveRequest` accepts an optional `documentId`, and `resolveLibraryRagComposition()` already resolves retriever + `generatorKind` (`ondevice` / `cloud` / `none`) per platform. No new retriever or indexing work is required.
- **Mobile sheet pattern exists**: `MobileContextMenuSheet` is the established bottom-sheet component to build on.
- **Learning-loop endpoints exist**: flashcard creation (`knowledgeFormulation`), TTS (`src/api/tts.ts`).

## Goals / Non-Goals

**Goals:**

- One code path for all three scopes (Passage / Document / Library) through the existing `askLibrary` task and citation validation.
- The sheet and answer cards are purely additive and mobile-gated; desktop assistant behavior is untouched.
- Every answer the user can act on (flashcard, read-aloud, follow-up) carries its provenance.

**Non-Goals:**

- New retrievers, embedding models, or changes to the library indexing pipeline.
- Desktop UI changes to `AssistantPanel`.
- Web search inside the sheet (the existing `webSearchContext` slot in document QA stays as-is).

## Decisions

### 1. One task, three scopes — reuse `askLibrary` for everything

Passage scope calls `askLibrary` with `sources: []` and the chip text as `contextPassage`; Document scope retrieves with `documentId` set (via the `document-only`/`ai_learning` retriever) and passes chunks as `sources`; Library scope uses the current `resolveLibraryRagComposition()` path unchanged. **Why**: a single citation-validation and untrusted-containment model instead of three divergent answer paths. **Alternative considered**: a separate lightweight task for passage-only questions — rejected, because it would duplicate the containment/validation logic for no behavioral gain.

### 2. New `AskSheet` component built on the `MobileContextMenuSheet` pattern

The composer and answer cards are a new mobile-only component following the existing sheet conventions (gestures, safe-area handling, focus management), not an adaptation of `AssistantPanel`. **Why**: the sheet is a reading-flow UX (docked, dismissible, document stays visible); the panel is a chat UX. Forcing one into the other would compromise both.

### 3. Promote Ask, don't redesign the whole selection menu

On mobile viewports the selection menu renders Ask as the single primary action with the remaining actions behind an overflow control. The desktop menu is unchanged. **Why**: minimal blast radius — the complaint is specifically about reaching Ask, not about the other actions.

### 4. Plumb retrieval location metadata through to source chips

`AskLibrarySource` currently carries only `id` + `text`. The answer model is extended to carry `documentId`, `documentTitle`, `headingPath`, and `location` per citation (all already present on `RetrievalResult`), so chips can deep-link into the reader. **Why**: citations the user can't tap are decoration; the "jump to source" behavior is what makes library answers trustworthy and useful.

### 5. Suggested questions are generated on sheet open; "Where else" is retrieval-only

When the sheet opens with passage context, the generator produces 3 tap-to-ask suggestions from the passage (cached per passage text hash). "Where else is this discussed?" runs a library retrieval with the concept as the query and renders the jump-list directly — no generation step, so it stays fast and purely factual. **Why**: suggestions need fluency (generation), while cross-document tracing needs only ranking (retrieval).

### 6. Honest state from existing signals

Index freshness comes from the library indexer's unindexed-document count, shown as a quiet disclosure in Library scope. The mode indicator (`on-device` / `cloud` / `retrieval-only`) reads directly from the resolved `RagComposition.generatorKind`. In `none` (retrieval-only) mode the sheet returns matching passages with no generation and no network egress. **Why**: both signals already exist; surfacing them is UI work, not new plumbing, and it matches the app's privacy posture.

### 7. Rollout behind a feature flag

The new mobile Ask entry and sheet are gated by a feature flag in `settings.features` (following the existing `androidAppSearchIndex` precedent), default off until the UX is validated. Rollback is flag-off.

## Risks / Trade-offs

- [Risk] Retrieval + generation latency on mobile feels slow → Mitigation: progressive sheet states (retrieving → answering with skeleton), reuse the existing 60s `askLibrary` timeout, and keep "Where else" retrieval-only.
- [Risk] Generated answers with zero valid citations (validation drops fabricated refs) → Mitigation: defined empty state — the card shows the retrieved passages without a synthesized answer rather than failing silently.
- [Risk] Voice input permission denied → Mitigation: the mic control degrades to a disabled state with a hint; typing remains fully available.
- [Risk] Answer card obscures the passage being asked about → Mitigation: docked (not full-screen) card, document stays scrollable above it, swipe-down dismisses; collapsed state shows only the summary.
- [Risk] Scope picker confuses users about what is searched → Mitigation: one-line scope description under the picker ("Searches all 128 indexed documents") and the freshness disclosure.

## Migration Plan

1. Ship behind the feature flag, default off; enable in dev builds for UX review.
2. Validate: sheet open latency, retrieval citation round-trip, flashcard creation with sources, TTS read-aloud on device.
3. Enable flag by default; keep the old pill-menu Ask path as fallback for one release, then remove.

## Open Questions

- Exact placement of the no-selection "Ask about this page" entry (reader toolbar vs. floating button) — deferrable; the spec requires the entry point, not its position.
- The suggestion-generation prompt wording — deferrable; does not change specs or task breakdown.
