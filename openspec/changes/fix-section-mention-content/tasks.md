## 1. Frontend: heading-level differentiation (D1)

- [x] 1.1 In `src/utils/sectionIndex.ts` `parseMarkdownHeadings`, replace the flat `level = 1` assignment for the `chapter|part|section` keyword family with differentiated base levels (`part` → 1, `chapter|ch.|chap.` → 2, `section` → 3). Keep Markdown `#{n}` and `<hN>` intrinsic levels and numeric-outline dotted depth unchanged.
- [x] 1.2 Add a post-pass that normalizes the lowest heading level in the document to 1 and remaps the others relatively, so keyword and Markdown/HTML levels share one scale when both appear.
- [x] 1.3 Add unit tests in `src/utils/sectionIndex.test.ts`: a document with `Part One`, `Chapter 1`, `Chapter 2` under it, and prose builds a tree where chapters are children of the part (verify via `flattenTree` breadcrumbs), and a flat `# A` / `# B` Markdown doc still resolves to exactly two level-1 sections.

## 2. Frontend: body-aware occurrence recovery (D2)

- [x] 2.1 In `recoverOutlineRangeFromText`, after collecting all title occurrences, score each by the non-heading body length it would produce (distance to the next heading, minus the matched heading line), rather than unconditionally taking `occurrences[occurrenceIndex]`.
- [x] 2.2 Keep the existing `occurrenceIndex` (same-title outline-node order) as the primary selector and fall back to body-length scoring only when the primary occurrence yields an empty or heading-only body, or when multiple occurrences exist and the primary is not in the body region.
- [x] 2.3 Add tests: (a) chapter title repeated in a front-matter TOC then again as the real heading resolves to the body occurrence; (b) two same-title outline chapters resolve to distinct body occurrences via `occurrenceIndex`.

## 3. Frontend: empty-body retry in resolver (D3)

- [x] 3.1 In `resolveSectionFocusedContext`, after a candidate passes `rangeIsCurrent`, compute the sliced body; if `stripMarkup(body)` is empty or shorter than the candidate's heading title, skip this candidate and continue scanning remaining sources (`structural.match`, then `recoverOutlineRangeFromText`'s next-best occurrence).
- [x] 3.2 Only when no candidate yields a real body, push the section to `unresolved` (preserve existing codes; use `unresolved` for the no-body case).
- [x] 3.3 Add tests: a section whose only range is a TOC line followed by another TOC line is reported `unresolved`; a section with one bad candidate and one good candidate resolves to the good candidate's body.

## 4. Frontend: richer unresolved diagnostics (D5)

- [x] 4.1 In `resolveSectionFocusedContext`, augment `SectionContextDiagnostic` so `ambiguous` entries carry the count of considered candidates (extend the type minimally; keep it optional/backward-compatible).
- [x] 4.2 Update the Assistant throw at `src/components/assistant/AssistantPanel.tsx:1238` to include the failure reason code (and candidate count when ambiguous); add an `assistant.sectionUnresolved` i18n key in `src/lib/i18n/locales/en.ts`.
- [x] 4.3 Mirror the same message change in `src/components/review/FlashcardStudioModal.tsx` (around the existing `flashcardStudio.sectionUnresolved` throw) and `src/components/tabs/DocumentQATab.tsx` if it has a parallel throw.

## 5. Backend: shared recovery helper + parity (D4)

- [x] 5.1 Extract the recovery logic inline in `get_document` (`src-tauri/src/commands/document.rs:703-782`: legacy EPUB-placeholder detection, `recover_browser_import_text`, and the Epub/Markdown/Html re-extract) into a `recover_document_content(doc: &mut Document, repo: &Repository) -> Result<bool>` helper that returns whether content changed and persists when it does.
- [x] 5.2 Refactor `get_document` to call the helper, preserving current behavior exactly.
- [x] 5.3 In `extract_document_text`, call `recover_document_content` before the non-empty short-circuit return at line 1005-1012, so it returns healed content. Leave the YouTube and HTTP-short-circuit paths unchanged.
- [x] 5.4 Add a Rust test asserting that a document whose stored `content` is the legacy EPUB placeholder returns the full body from both `get_document` and `extract_document_text` (use a small fixture or a mock repo), and that `extract_document_text` returns identical content to `get_document` after healing.

## 6. Integration coverage & verification

- [x] 6.1 Add an integration case in `src/features/documentQa/__tests__/sectionContextRequest.integration.test.ts`: a deep EPUB-style outline (`Part Three > Chapter 11`) over body text with a front-matter TOC resolves to the chapter body in both `userPromptContent` and `contextContent`, mirroring the existing "keeps a non-opening EPUB chapter isolated" test.
- [x] 6.2 Run `npm run lint`, `npm run typecheck` (or project equivalent), and `npm test` for the affected suites; run `cargo test` for the document command suite.
- [ ] 6.3 Manual verification: in the running app, open the reported EPUB, use `#` to focus `Part Three > Chapter 11: Darwin's Delay`, send "Summarize this chapter", and confirm the model's context contains the chapter body, not the title page, and that no "stale or ambiguous" error appears.

## 7. Root-cause fix: EPUB extractor + merge tiebreaker (added during apply)

Found while reproducing against the real "Moral Animal" EPUB: the original design
assumed the document text already carried line-anchored headings. It did not, for
two reasons that D1–D5 could not reach.

- [x] 7.1 `src-tauri/src/processor/epub.rs`: rewrite `extract_text_from_html` to be block-aware — emit newlines at `<p>/<div>/<h1>`–`<h6>/<li>` etc. boundaries instead of joining all whitespace to a single space, and drop `<style>`/`<script>` content entirely (previously raw CSS leaked into the body). The `#`-mention resolver's title regex is line-anchored, so flattened text made every heading invisible.
- [x] 7.2 Add Rust tests in `processor/epub.rs`: (a) headings (`<h1>`/`<h2>`/`<h3>`) land on their own lines and `<style>` CSS does not leak; (b) inline whitespace collapses but block breaks are preserved.
- [x] 7.3 `src/utils/sectionIndex.ts` `mergeOutlineWithHeuristics`: change the candidate sort tiebreaker from earliest-offset to longest-body. A chapter title that repeats in a page-numbered TOC, a detailed sub-section TOC, and the real body must merge onto the body candidate (longest range), not the first TOC match.
- [x] 7.4 Add a regression test in `sectionIndex.test.ts` reproducing the real three-occurrence shape (page-numbered TOC + sub-section TOC + body) and asserting the outline node resolves to the body.
- [x] 7.5 Verified end-to-end against the actual "Moral Animal" EPUB content dumped from the DB: Chapter 1 now resolves to its 29,897-char body (was 81 chars / TOC entry) and the focused context contains the real opening sentence "As for an English lady".

## 8. Self-healing for existing flattened EPUBs (added during apply)

The extractor fix (7.1) only runs at import time, so EPUBs already in the library
with flattened content stay broken. A DB audit showed 368 EPUBs: 366 with empty
content and 1 with non-empty-but-flattened content (the pre-block-aware extractor
joined every chapter to one long line). `recover_document_content` healed empty
and legacy-placeholder content but treated flattened content as "fine" because it
was non-empty. This group makes existing flattened documents self-heal on access.

- [x] 8.1 `src-tauri/src/commands/document.rs`: add `content_is_flattened(content)` detector. A document is flattened when its longest line exceeds ~5,000 chars (healthy books max ~800 chars/line) and total length is above a floor (so short single-line clippings are never flagged).
- [x] 8.2 Fold `is_flattened` into the `needs_content` checks in `recover_document_content`, so flattened Epub/Markdown/Html content triggers the same re-extraction path empty content uses — replacing the flattened text with properly-structured output from the new block-aware extractor.
- [x] 8.3 Guard re-extraction behind a source-file-exists check (`Path::new(&doc.file_path).exists()`), so a book on an unmounted drive (e.g. `/Volumes/external` offline) is never wiped — flattened content is better than none when the source is unreachable.
- [x] 8.4 Add a Rust test for `content_is_flattened`: detects old-extractor output (8,000-char lines), does not flag healthy multi-paragraph text, ignores short/None content.
- [x] 8.5 Confirm `recover_document_content` runs from both `get_document` and `extract_document_text` (already wired in group 5), so opening the document or building the section tree both trigger the heal.

## 9. Preserve audiobook section focus while typing (added during apply)

- [x] 9.1 Reset the Assistant and Document Q&A global section-token regex before and after boolean `test()` calls, so consecutive prompt edits cannot silently clear a still-visible `#{...}` selection.
- [x] 9.2 Add an Assistant regression test shaped like the reported audiobook: select timed transcript chapter `008`, type multiple edits after the token, generate cards, and assert the LLM context contains chapter 008 while excluding the foreword/full-transcript fallback.

## 10. Make the submitted section chip authoritative (added during apply)

- [x] 10.1 Add a pure send-time resolver that extracts `#{...}` tokens from the submitted prompt, rehydrates them from current authoritative sections, and uses pick-time state only to disambiguate duplicate titles.
- [x] 10.2 Update the Assistant send path to build selection/section context from the rehydrated prompt nodes and abort before the provider call when a visible chip is unresolved or ambiguous.
- [x] 10.3 Add pure and Assistant integration regressions for the exact production split-brain state: `#{008}` remains in the message while `selectedSectionNodes` is empty; assert only chapter 008 reaches the LLM and the foreword fallback is excluded.

## 11. Add deck-aware generated-card actions (added during apply)

- [x] 11.1 Preserve normalized card tags in `ChatFlashcardArtifact` and derive the intended deck from the real `deck:<name>` tag.
- [x] 11.2 Add compact, accessible `Create deck` / `Open deck` and copy-batch controls to the generated-card header, retaining existing per-card open/retry and expand behavior.
- [x] 11.3 Wire deck creation to a document-bound deck (falling back to tag filtering outside document context), and deck opening to Review's deck manager with that deck selected.
- [x] 11.4 Add normalization and component tests for deck derivation, create/open state, and copy activation.

## 12. Guarantee audiobook-title deck membership at save time (added during apply)

- [x] 12.1 Include the current document title in `DocumentViewerWrapper`'s document Assistant context; this was present for video context but missing for audiobooks/documents.
- [x] 12.2 Resolve a missing save-time title from the document store and then `get_document`, inject `document_id` plus `deck:<title>` into every card tool call, and fail closed rather than persisting an unassigned document card when all title sources fail.
- [x] 12.3 Upsert the matching title deck as document-bound after successful card creation and when restoring a conversation with successful historical card calls, so the just-created legacy untagged 008 cards are included on reopen as well.
- [x] 12.4 Update Rust `batch_create_cards` schema/execution to persist shared and per-card tags on every learning item, with a merge regression test.
- [x] 12.5 Add an Assistant integration regression with `metadata.title` intentionally absent: resolve `A New Theory of Intelligence` from the document record, assert the MCP save carries its deck tag, and assert the document-bound deck is created. Add the fail-closed inverse case.

## 13. Extend document-deck parity to Document Q&A (added during apply)

- [x] 13.1 Wire the shared generated-card collection in Document Q&A with copy and state-aware `Create deck` / `Open deck` actions, binding created decks to the message's source document.
- [x] 13.2 Resolve the document title from the document store or persisted record before initial saves and retries, inject `document_id` plus `deck:<title>`, fail closed when unavailable, and upsert a document-bound deck after success.
- [x] 13.3 Apply the same title-deck invariant to NotebookLM research-draft card saves and repair successful historical Document Q&A cards from stored document ownership.
- [x] 13.4 Add Document Q&A regressions proving its artifact header creates the title deck, changes to `Open deck`, exposes batch copy, and retries cards with document ownership plus the title tag.

## 14. Share authoritative audiobook chapters with Document Q&A (added during apply)

- [x] 14.1 Add a document-keyed media-section catalog, publish the audiobook viewer's transcript-backed chapters into it, and make `useDocumentSections` prefer that catalog across `#` mention surfaces.
- [x] 14.2 Rebuild an audiobook catalog in Document Q&A from stored chapters/timed transcript when no viewer is resident, with metadata and persisted-transcription fallbacks plus an explicit loading state that prevents a misleading partial list.
- [x] 14.3 Rehydrate Document Q&A's serialized title chips against the current catalog at send time and resolve mixed context correctly: timed chapters/selections use attached content, structural headings use canonical-text ranges.
- [x] 14.4 Add regressions proving the shared hook prefers viewer chapters, the fallback loader returns the complete catalog, Document Q&A lists every published chapter, and selecting `008` sends its transcript while excluding the foreword.

## 15. Fix Flashcard Studio audiobook context split (added during apply)

- [x] 15.1 Treat viewer-published media chapter text as valid Flashcard Studio document context, and reconstruct the audiobook catalog from stored metadata/transcript before falling back to the separate video-transcript service when stored document content is empty.
- [x] 15.2 Resolve Studio `media-transcript` selections through the mixed direct/structural resolver and skip canonical document loading for a direct-only timed chapter; preserve fresh-text loading and the one-time rebuild for structural headings.
- [x] 15.3 Add regressions proving chapter `008` sends its attached transcript, excludes the foreword, does not call document extraction, and that the catalog provides a usable full-context fallback.

## 16. Add Podcast Assistant card and resize parity (added during apply)

- [x] 16.1 Expand `batch_create_cards` into shared flashcard artifacts with persisted ids, merged shared/per-card tags, and per-card failure state; exclude the batch from generic JSON tool rendering.
- [x] 16.2 Reuse the shared collection's copy and state-aware deck action in Podcast Assistant, and report the actual number of cards in batch confirmation text.
- [x] 16.3 Connect Podcast View's outer chat shell to the Assistant's persisted 300–800 px width, add accessible pointer/keyboard resize semantics, and keep the mobile sheet full-width without the desktop handle.
- [x] 16.4 Add artifact, collection-safety, and shared resize regressions; run focused tests and TypeScript validation.

## 17. Isolate named decks and restore Anki source decks (added during apply)

- [x] 17.1 Derive unbound tagged decks as `filterType: tags`, keep document-bound decks scoped by document, and add a version-3 persisted-state repair for the invalid unbound tagged `all` shape.
- [x] 17.2 Make named-deck reconciliation a tag-filtered upsert so existing broken decks retain their ids while being repaired instead of returning early.
- [x] 17.3 Centralize Anki source-deck inference, self-heal missing decks from existing card-only imports in Review Home/Deck Manager, and make Documents drag/drop run the real card import rather than parse-only handling.
- [x] 17.4 Add deck membership, migration, reconciliation, and Anki inference regressions; run focused tests and TypeScript validation.
