## Why

Document Q&A answers end with a `**Sources:**` footer that is plain markdown text (`[1] **Title** (score 0.83)`). It names the document but not where in it, and nothing is clickable — the user has to open the document and hunt for the passage the answer came from. The app already has exact-hit navigation (`ExactSearchHitLocation` + `DocumentViewer.initialJump`) used by the command palette; the Q&A footer just doesn't use it.

## What Changes

- Retrieval citations are carried on the chat message as structured data (document id, chunk index, chunk text, score) instead of being flattened into the answer's markdown text.
- The sources footer is rendered as an interactive list: numbered entry, document title, a short quote from the cited chunk, and a location label (page number, chapter/section, or timestamp) where one can be resolved.
- Clicking a source opens the cited document in a tab and jumps to the cited passage, with the passage highlighted — the same behavior as activating an exact hit in the command palette.
- The location of a cited chunk is resolved from the chunk text at click time (no re-indexing, no schema migration): PDF-derived documents resolve to a page, EPUB/HTML/markdown resolve to a text quote, transcript-backed documents resolve to a timestamp.
- When a location cannot be resolved (the passage no longer matches, or the document was deleted), the source stays visible and states why it cannot be opened rather than opening the document at an arbitrary position.

Non-goals: the NotebookLM chat's `sources` list (opaque strings with no document identity) and the mentioned-document (`@doc`) answer path, which produces no retrieval citations, are unchanged.

## Capabilities

### New Capabilities
- `qa-source-citations`: how Document Q&A presents retrieval citations and navigates from a cited source to the exact passage in the source document.

### Modified Capabilities
<!-- None. exact-search-hit-navigation covers command-palette results only; its requirements are unchanged and its navigation primitives are reused as-is. -->

## Impact

- `src/components/tabs/DocumentQATab.tsx` — stop appending the markdown `Sources:` block; store `citations` on the assistant message and render the interactive footer.
- Chat message type / session persistence for Document Q&A — messages gain an optional `citations` field (older persisted messages without it keep rendering as today).
- New shared helper for "open document at location" so the Q&A footer and `CommandCenter.openDocumentInTab` build the same tab payload (`documentId`, `highlightQuery`, `initialJump`, `jumpRequestId`).
- New chunk-to-location resolver keyed off document `fileType` and existing content (PDF-converted HTML carries `id="page-N"` markers; transcripts carry timed segments).
- Reused unchanged: `src/types/searchHit.ts`, `src/types/extractNavigation.ts`, `DocumentViewer` jump/highlight props, `src/api/rag.ts` `RagHit`.
- i18n: new strings for the sources footer and the unresolvable-source message.
