## 1. Shared document-jump helper

- [x] 1.1 Extract the `document-viewer` tab payload construction from `CommandCenter.openDocumentInTab` (`src/components/search/CommandCenter.tsx:1452`) into `src/utils/openDocumentAtLocation.ts` — same `documentId` / `highlightQuery` / `initialJump` / `jumpRequestId` / `autoPlay` fields, same fileType icon choice, same "reload documents and retry" fallback
- [x] 1.2 Call the helper from `CommandCenter.openDocumentInTab` so its behavior is unchanged
- [x] 1.3 Verify command-palette jumps still work for a PDF, an EPUB, and a transcript result (existing `exact-search-hit-navigation` behavior must not regress)

## 2. Chunk-to-location resolver

- [x] 2.1 Add `src/utils/resolveCitationLocation.ts` exporting `resolveCitationLocation(document, chunkText): ExactSearchHitLocation | null`, with quote normalization (whitespace-collapsed, case-folded prefix of ~120 chars) and a shorter-prefix retry on miss
- [x] 2.2 PDF branch: locate the quote in the document content and walk back to the nearest `id="page-N"` marker emitted by `src-tauri/src/processor/pdf.rs`; return `{ kind: "pdf", pageNumber, textQuote }`, or `null` when no page marker precedes the match
- [x] 2.3 EPUB branch: return `{ kind: "epub", textQuote }` when the quote is present in the document content
- [x] 2.4 HTML / markdown / text branch: return `{ kind: "html" | "markdown", textQuote }` per `fileType`
- [x] 2.5 Transcript-backed branch (youtube / audio / local video): find the segment containing the quote and return `{ kind, timeSeconds, segmentId, textQuote }` matching what `CommandCenter` builds for transcript hits
- [x] 2.6 Return `null` for a missing document, missing content, or an unmatched quote — never a guessed location
- [x] 2.7 Add a unit test covering: PDF page resolution, transcript timestamp resolution, quote-only resolution, and each `null` case

## 3. Structured citations on Q&A messages

- [x] 3.1 Add optional `citations?: RagHit[]` to the Document Q&A assistant message type and its session persistence shape
- [x] 3.2 In `src/components/tabs/DocumentQATab.tsx`, stop appending the markdown `**Sources:**` block to `content`; set `citations` from `ragResult.citations` instead, keeping `sourceDocuments` derived as it is today
- [x] 3.3 Confirm messages persisted without `citations` still render their answer unchanged and produce no empty sources list

## 4. Sources footer UI

- [x] 4.1 Add a sources footer component rendering one entry per citation: index, document title, passage quote, and resolved location label (page / timestamp / passage)
- [x] 4.2 Resolve each citation's location when the footer renders, memoized per `(documentId, chunkIndex)` for the session
- [x] 4.3 Make resolved entries activatable by click, tap, and keyboard, opening the document through the helper from task 1.1 with `initialJump` and the passage quote as `highlightQuery`
- [x] 4.4 Render unresolved entries as non-activatable with a stated reason (document unavailable / passage could not be located)
- [x] 4.5 Generate a fresh `jumpRequestId` per activation so activating a second source for the same document re-navigates
- [x] 4.6 Add i18n strings for the footer heading, location labels, and both unresolved reasons across all locale files

## 5. Copy behavior

- [x] 5.1 Update the answer copy-to-clipboard handler to append a plain-text sources list (title + known location per citation) so copied answers keep their sources
- [x] 5.2 Verify copying an answer with no citations produces the answer text alone

## 6. Verification

- [ ] 6.1 Ask a library-wide Q&A question and confirm each source opens its document at the cited passage, highlighted, for a PDF, an EPUB, an HTML/markdown document, and a transcript-backed document
- [ ] 6.2 Delete a cited document and confirm its source entry renders inert with the unavailable reason
- [ ] 6.3 Re-import a cited document with changed content and confirm the entry renders inert with the not-located reason rather than jumping to the wrong place
- [x] 6.4 Run `npm run lint` and the test suite
