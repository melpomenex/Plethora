## Why

When a user inserts a document section into the Assistant's context via the `#` mention menu, the model frequently receives only the document's title page / front matter instead of the selected chapter's body, and deep-nested sections (e.g. `Part Three > Chapter 11: DARWIN'S DELAY`) sometimes abort the send entirely with a "stale or ambiguous" error. This breaks the core promise of section mentions — "focus the model on exactly this chapter" — and was reported against an EPUB with a real three-level outline.

## What Changes

- **Heading-level recovery in the heuristic tree.** `parseMarkdownHeadings` currently assigns `level = 1` to every `chapter`/`part`/`section N` heading, flattening the hierarchy so it can never breadcrumb-match a deep PDF/EPUB outline. Headings will be assigned differentiated levels (`part` < `chapter` < `section`/numeric) so the heuristic tree mirrors the outline's depth and `mergeOutlineWithHeuristics` / `findStructuralMatch` can reconcile by breadcrumb.
- **Title-page/TOC-safe range recovery.** `recoverOutlineRangeFromText` will no longer accept a heading occurrence that is followed by no body text (a table-of-contents entry or a title-page label). It will pick the occurrence that yields the longest non-heading body, and will skip occurrences inside the document's front matter when a later occurrence exists, so resolved slices contain real chapter text rather than cover/TOC text.
- **Fall-back to structural body when a resolved range yields no body.** When a range resolves but its sliced body is empty or shorter than the heading line itself (a sign of a mis-resolved TOC/title hit), `resolveSectionFocusedContext` will retry the structural/outline recovery once against the next-best candidate before declaring the section unresolved.
- **Backend content-source parity.** `extract_document_text` will run the same recovery (legacy EPUB placeholder rewrite, browser-import `article_html` extraction) that `get_document` already runs, so the two commands return identical content and the section tree is never built from a short placeholder while the full body sits one call away.
- **Diagnostic surface for unresolvable mentions.** The "stale or ambiguous" error message will include the specific reason code (`ambiguous`, `unresolved`, `wrong-document`) and, where known, which candidate ranges were considered, turning a silent wrong-content outcome into an actionable one.
- **Submitted-chip payload integrity.** A visible `#{008}` chip is rehydrated from current authoritative transcript sections at send time, so the rendered chip and LLM payload cannot diverge; an unavailable/ambiguous chip blocks rather than falling back to the foreword/full transcript.
- **Deck-aware generated-card header and save invariant.** Assistant and Document Q&A card batches expose compact copy and state-aware `Create deck` / `Open deck` actions. Document card writes on both surfaces resolve the audiobook/document title through context, store, or database; persist `document_id` plus `deck:<title>` on every single/batch card; and upsert the matching document-bound deck. Missing titles fail closed rather than creating unassigned cards.
- **Cross-surface audiobook chapter parity.** The audiobook viewer publishes its authoritative transcript-backed chapter catalog by document id, and Document Q&A consumes the same catalog for its `#` picker (with a stored-metadata/transcript fallback when the viewer is not mounted). Document Q&A also resolves visible title tokens such as `#{008}` back to that catalog at send time and treats timed chapter content directly, never as a character range in flattened transcript text.

## Capabilities

### New Capabilities

(None — the affected behavior is already covered by `flashcard-studio-section-mentions`, which is explicitly described as identical to the document Assistant's resolution.)

### Modified Capabilities

- `flashcard-studio-section-mentions`: Tightens the section-resolution requirements so that a resolved section SHALL yield the actual chapter/part body text (not front matter or a TOC line), deep-nested outline sections SHALL resolve without a "stale or ambiguous" abort, and the document-content source used to build the section tree SHALL be consistent between `get_document` and `extract_document_text`. Adds scenarios for the deep-outline, title-page-occurrence, and short-content-source cases.

## Impact

- **Frontend**: `src/utils/sectionIndex.ts` (heading parser, tree builder, merge, recovery, mixed direct/structural resolver, submitted-token rehydration), `src/hooks/useDocumentSections.ts` and `src/stores/documentOutlineStore.ts` (shared per-document media chapter catalog), `src/components/assistant/AssistantPanel.tsx` (error message, payload integrity, and deck navigation), `src/components/assistant/ChatFlashcardCollection.tsx` plus `src/features/assistant/chatFlashcardArtifacts.ts` (artifact actions), and the parallel send paths in `src/components/review/FlashcardStudioModal.tsx` and `src/components/tabs/DocumentQATab.tsx`.
- **Backend (Rust)**: `src-tauri/src/commands/document.rs` (`extract_document_text` parity with `get_document` recovery; the existing `recover_browser_import_text` and EPUB-placeholder logic are reused, not duplicated, by extracting a shared recovery helper) and `src-tauri/src/mcp/tools.rs` (batch card tag persistence).
- **Tests**: new unit tests in `src/utils/sectionIndex.test.ts` (deep-outline EPUB, TOC-before-body, empty-body-retry) and an integration case in `src/features/documentQa/__tests__/sectionContextRequest.integration.test.ts`; a Rust test asserting `extract_document_text` heals a legacy EPUB placeholder identically to `get_document`.
- **No breaking API/DB changes.** The `extract_document_text` behavior change is a pure correctness fix (returns full body where it previously returned a placeholder); no schema or IPC contract changes.
