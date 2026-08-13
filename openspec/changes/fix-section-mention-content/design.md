## Context

The `#` section-mention feature lets a user focus the Assistant (and Flashcard Studio) on a specific chapter/part of a document. The resolved section text is the only document context sent to the LLM, so a wrong resolution is not a minor degradation — it is the entire prompt being wrong.

The pipeline, concentrated in `src/utils/sectionIndex.ts`, is:

1. `loadDocumentQaText` fetches the canonical document text (frontend: `sectionContextRequest.ts:6-17`).
2. `useDocumentSections` / `buildSectionsSnapshot` build a section tree by merging a PDF/EPUB **outline** (authoritative structure, but no body text — `convertPdfOutlineToSectionNodes` / `convertEpubTocToSectionNodes` create nodes with `content: ""` and `hasAuthoritativeRange: false`) with a **heuristic heading tree** (`parseMarkdownHeadings` → `buildTreeFromHeadings`, which has real `startChar`/`endChar` ranges into the body text).
3. At send time, `resolveSectionFocusedContext` reconciles the picked outline node back to a body range and slices `fullContent.slice(startChar, endChar)` to produce the prompt context.

The reported bug ("model only gets the title page", and "stale or ambiguous" on deep outlines) traces to three concrete defects in this pipeline, plus a content-source asymmetry in the Rust backend.

### Observed defects

1. **Heading levels are collapsed.** `parseMarkdownHeadings` (`sectionIndex.ts:173-176`) assigns `level = 1` to *every* `part`/`chapter`/`section N` heading. The heuristic tree is therefore flat even when the document has a real `Part > Chapter` hierarchy. Outline-to-heuristic matching (`mergeOutlineWithHeuristics` breadcrumb scoring at lines 361-368, and `findStructuralMatch` at 514-520) requires the ancestor breadcrumb to match, so a deep EPUB outline (`Part Three > Chapter 11`) can never match a flat heuristic tree. The outline node stays `hasAuthoritativeRange: false`.

2. **Title-page/TOC occurrence is chosen as the body.** When the merge fails, `recoverOutlineRangeFromText` (lines 532-573) regex-finds the title in `fullContent` and uses the matched position as `startChar`. If the chapter title also appears in a front-matter table of contents or on a title page (common in EPUBs and PDFs), that occurrence is matched first; the resulting `slice(start, end)` yields the TOC/title-page text — exactly the "only the title page" symptom. The `occurrenceIndex` heuristic (line 549) only disambiguates among *same-title outline nodes*, not among *all title occurrences in the body*.

3. **No empty-body guard.** When a resolved range yields a body shorter than its own heading line (a TOC entry followed by the next TOC entry), nothing catches it. The resolver returns `ok: true` with near-empty or wrong content instead of retrying against a better candidate.

4. **Backend content-source asymmetry.** `get_document` (`commands/document.rs:697-785`) self-heals legacy EPUB placeholders and sparse browser-extension imports (via `recover_browser_import_text`, line 787-801) and *persists* the full text. But `extract_document_text` (line 1005-1012) returns whatever is in the DB as soon as `content.trim()` is non-empty — including the placeholder string and short browser text. The frontend's `loadDocumentQaText` early-returns on the first non-empty `getDocument().content`, so whether the section tree is built from full or short text depends on whether the row has been pre-healed.

## Goals / Non-Goals

**Goals:**

- A resolved section mention SHALL deliver the actual chapter/part body text to the LLM, not front matter, a TOC line, or a title page.
- Deep-nested outline sections (Part > Chapter > …) SHALL resolve on the first send without a "stale or ambiguous" abort.
- The document text used to build the section tree SHALL be identical regardless of whether it came from `get_document` or `extract_document_text`.
- The fix SHALL be additive to the existing resolution engine — no change to the IPC contract, DB schema, section token syntax (`#{title}`), or the persisted `SectionNode` shape beyond optional diagnostic fields.

**Non-Goals:**

- Reworking the section tree interaction model or token syntax. The popup gains a loading state and a shared authoritative data source, but selection, filtering, and keyboard behavior remain unchanged.
- Changing how documents are imported or extracted at the source. Browser/EPUB extraction quality is a separate concern; this change only makes the *recovery* that already exists in `get_document` available to `extract_document_text`.
- Multi-document mention spanning. Already unsupported; remains so.
- Replacing the regex-based heading parser with a structural parser. We extend it, not replace it.

## Decisions

### D1. Differentiate heading levels in `parseMarkdownHeadings`

Assign a level per keyword family so the heuristic tree carries depth: `part` → level 1, `chapter`/`ch.`/`chap.` → level 2, `section` → level 3, Markdown `#{n}` and `<hN>` keep their intrinsic levels, numeric outlines (`1.2.3`) keep their dotted depth. When intrinsic Markdown/HTML levels coexist with keyword levels, normalize keyword-derived levels into the same scale (treat the shallowest heading in the document as level 1 and remap others relatively), preserving the tree's *relative* depth even if absolute numbers shift.

- *Why over alternatives:* the merge and structural-match functions already key on breadcrumb depth (lines 364-366, 518-520); giving the heuristic tree real depth makes those paths work unchanged. Alternatives considered: (a) teach `mergeOutlineWithHeuristics` to ignore breadcrumbs when the heuristic tree is flat — rejected because it would increase ambiguous matches and silently merge a Part heading with a same-titled Chapter; (b) drive the tree purely from the outline and recover ranges separately — rejected because the outline has no body offsets, which is the original problem.

### D2. Body-aware occurrence selection in `recoverOutlineRangeFromText`

When the title regex yields multiple occurrences, score each by the length of the non-heading body text it would produce (i.e. `endChar - startChar` minus the heading line), and prefer the occurrence that yields the most body text. Additionally, when occurrences exist both before and after the document's first substantial body block, prefer the one inside the body (an occurrence whose following text is not itself another short TOC line). Keep the existing `occurrenceIndex` as a tiebreaker for same-title outline nodes.

- *Why:* the failure mode is specifically "TOC/title occurrence wins over the real heading". Body-length is a robust, content-derived signal that a human editor's chapter heading is followed by prose. Alternatives considered: (a) strip a detected front-matter/TOC region before recovery — fragile, document-dependent; (b) require the occurrence to be followed by a minimum word count — too coarse for short sections; (c) use the outline's `pageNumber` (PDF) — not available for EPUB and not reliable for reflowable text.

### D3. Empty-body retry inside `resolveSectionFocusedContext`

After a candidate range resolves and passes `rangeIsCurrent`, compute the sliced body. If the body (after `stripMarkup`) is empty, or shorter than the heading's own title text, treat the candidate as unresolved for this pass and continue scanning the remaining candidate sources (`structural.match`, then `recoverOutlineRangeFromText`'s next-best occurrence). Only if no candidate yields a real body does the section become `unresolved`. This turns silent wrong-content into either correct content or an explicit, actionable failure.

- *Why:* it is the cheapest place to catch the mis-resolution without changing the caller. The diagnostic codes already exist (`unresolved`, `ambiguous`); reusing them keeps the error path uniform. Alternative considered: post-validate in the component — rejected because three components call the resolver; the guard belongs in the single shared engine.

### D4. Shared backend recovery helper for `get_document` and `extract_document_text`

Extract the recovery logic currently inline in `get_document` (EPUB-placeholder detection + `recover_browser_import_text` + the `Epub/Markdown/Html` re-extract) into a `recover_document_content(&mut doc, &repo) -> Result<bool>` helper (returns whether it changed content). Call it from both `get_document` and, *before* the short-circuit return at `extract_document_text:1005-1012`, from `extract_document_text`. The short-circuit then returns healed content. No DB write happens if there is nothing to heal.

- *Why:* the two commands must agree on content, and the frontend's early-return on `getDocument().content` makes `extract_document_text` parity the only way to guarantee the section tree is built from full text. Extracting a shared helper avoids the duplication that *caused* this drift. Alternative considered: make the frontend always call `extract_document_text` instead — rejected because it would force re-extraction semantics (and side effects like YouTube transcript fetches) on every QA load and is the heavier call. Keeping `get_document` as the primary source and making `extract_document_text` heal identically is the smaller, safer change.

### D5. Richer "stale or ambiguous" diagnostics

Surface the existing `code` (`wrong-document` / `ambiguous` / `unresolved`) and, for `ambiguous`, the count of considered candidates, in the error message at `AssistantPanel.tsx:1238` and the matching throw in `FlashcardStudioModal.tsx`. Use the i18n key already present (`flashcardStudio.sectionUnresolved`) for the Flashcard path and add a parallel `assistant.sectionUnresolved` key. No new control flow.

- *Why:* the current message is identical for "wrong document", "multiple matches", and "no current range", making support triage and future regression reproduction hard. The information already exists in `FocusedSectionContextResult.unresolved`; only the presentation is missing.

### D6. Keep the selected section attached while editing after a `#` mention

The Assistant and Document Q&A input handlers use a global `SECTION_REGEX` for
multi-token match/replace operations. Before boolean token checks with
`RegExp.test`, reset `lastIndex` to zero and reset it again afterward. A global
regular expression is stateful: without this reset, consecutive keystrokes after
inserting `#{008}` alternate between finding and missing the same visible token.
The miss clears the selected `SectionNode`, so generation silently falls back to
generic document context while the UI still appears focused on the chapter.

- *Why:* keep the existing token grammar and global replace behavior, but make
  presence checks deterministic. A separate non-global regex would also work;
  explicit resets are the smallest change and mirror Flashcard Studio's existing
  guarded check.

### D7. Make the submitted section chip authoritative at send time

Resolve every `#{...}` token in the submitted prompt back to the current viewer
section list immediately before building LLM context. The pick-time React
`selectedSectionNodes` array is retained only as a disambiguation hint; it is no
longer the sole source of the payload. If a visible token cannot be resolved, or
matches multiple current sections without a selected-node disambiguator, abort
before the provider call with an actionable message. Never treat that state as
an unscoped request and fall back to full-document content.

- *Why:* the chat bubble renders its `Transcript > 008` chip from the serialized
  message token, while the old send path read a separate state array. That made
  it possible for the UI and payload to disagree even after fixing the known
  global-regex state leak. Rehydrating from the exact submitted message creates
  one source of truth and makes the visible chip a testable context contract.

### D8. Give generated-card artifacts deck-aware primary actions

On both the beside-document Assistant and Document Q&A surfaces, preserve
normalized card tool-call tags on each chat artifact and derive its
deck from the real `deck:<name>` tag. The artifact header shows a compact batch
copy action plus one primary action: `Create deck` when that named deck is not
in `useStudyDeckStore`, changing to `Open deck` as soon as it exists. Creating a
deck binds it to the current document (and retains the title tag for portable
membership); opening it
selects that deck, switches Review to the deck manager, and activates the Review
tab. A document-bound deck uses `filterType: "all"` so it includes every card
owned by that audiobook, including legacy cards whose title tag was previously
omitted; a non-document deck remains tag-filtered.

- *Why:* generated cards already carry their intended deck tag, so the artifact
  should expose the next action in place without inventing a second ownership
  model. A single state-aware primary button avoids competing CTAs in the narrow
  chat rail; copy is the only secondary batch action because it is useful,
  reversible, and does not navigate away. Sharing one artifact component keeps
  this interaction identical between the Assistant and Document Q&A.

### D9. Resolve the document deck before persisting generated cards

Every document viewer supplies `metadata.title` in its Assistant context. The
Assistant and Document Q&A card execution paths still resolve defensively
through the title sources available to each surface: context metadata when
present, the document store, then `get_document`. Before invoking a
card tool it injects both `document_id` and `deck:<normalized document title>`.
If a document id exists but no title can be resolved, that card write fails
closed instead of creating an unassigned card. After a successful write, the
same title/document pair is upserted into the study-deck store. The Rust
`batch_create_cards` tool persists shared top-level tags on every card (merged
with per-card tags), matching the single-card tools. On conversation restore, a
successful historical card tool call also upserts the document-bound title deck;
this makes already-saved untagged cards visible through their `document_id`.
Document Q&A applies the same rules to initial execution, per-card retry, and
NotebookLM research-draft saves, and repairs successful historical Q&A card
calls from their stored document ownership.

- *Why:* the reported 008 retry produced correct cortical-column cards, proving
  section scoping was fixed, but the database rows had `tags = []`. The document
  wrapper had omitted `metadata.title`, and the batch backend ignored normalized
  top-level tags entirely. Deck membership must be part of the save invariant,
  not a best-effort UI step after an otherwise successful write.

### D10. Share the audiobook's authoritative chapter catalog across surfaces

Publish transcript-backed `media-transcript` sections from the audiobook viewer
into a document-keyed in-memory catalog. `useDocumentSections` gives that
catalog precedence over heuristic headings, so the beside-audiobook Assistant
and Document Q&A render the same chapter list and stable section identities.
When Document Q&A opens without a resident viewer, rebuild the same catalog from
the audiobook's stored chapters and timed transcript, falling back to parsed
media metadata and persisted Whisper segments. While that catalog loads, show a
specific `Loading transcript chapters…` state instead of a misleading partial
heading list.

At send time, Document Q&A rehydrates serialized title tokens such as `#{008}`
against the current catalog. Timed chapters and live selections use their
attached authoritative content directly; only structural document headings are
resolved through character offsets in canonical document text.

- *Why:* the Assistant received chapters directly from `AudiobookViewer`, while
  Document Q&A independently parsed flattened `documents.content`. That created
  different picker inventories. Copying the chapter rows alone would still fail:
  Document Q&A serialized a title token but looked it up as an internal id, then
  attempted to resolve range-less timed chapters against flattened text. One
  catalog plus mixed direct/structural resolution makes parity a data contract,
  not duplicated presentation.

### D11. Let Flashcard Studio use transcript-backed audiobook context directly

When the selected audiobook has viewer-published media sections, Flashcard
Studio joins their transcript text as a valid full-context fallback instead of
reporting that document context failed to load. If no viewer catalog is resident
and stored document content is empty, Studio reconstructs the catalog through
the same stored audiobook metadata/transcript loader used by Document Q&A before
falling back to the legacy video-transcript request.

At send time, Studio resolves `media-transcript` and live-selection nodes with
`resolveMixedSectionFocusedContext`. A request containing only direct-content
nodes never calls `get_document` or `extract_document_text`; structural headings
still load fresh canonical text and retain the existing one-time tree rebuild.

- *Why:* the `#` menu and the red context banner read different sources. The
  menu could correctly show all audiobook chapters from the shared catalog while
  the banner and send path separately required `documents.content`, then tried
  to resolve range-less timed chapters as character ranges. Treating the catalog
  as authoritative context makes the picker, validation, and provider payload
  agree.

## Risks / Trade-offs

- **[Heading-level remap could shift existing trees]** → The `documentSectionCache` is keyed by content hash, so changing the parser invalidates caches and rebuilds trees for every open document on next load. Mitigation: this is correct (the old tree was wrong); the rebuild is bounded and already happens on any content change. Add a unit test asserting that a flat `# A / # B` Markdown doc still resolves to the same two sections (just with corrected relative levels).
- **[Body-aware occurrence selection may pick a later, also-valid occurrence]** → For documents where a chapter title legitimately repeats in the body (e.g. an epigraph), the longest-body heuristic could pick the second occurrence. Mitigation: keep `occurrenceIndex` as the primary key for same-title outline nodes and only fall back to body-length scoring when it fails; add a test for the repeated-title case.
- **[Empty-body retry hides genuinely missing content]** → A real section that is empty in the source (e.g. a part-divider page) would now be reported `unresolved` instead of silently sent empty. Mitigation: that is the desired behavior — an empty section provides no context, and surfacing it is better than sending a blank block. Document this in the spec scenario.
- **[`extract_document_text` now writes to the DB]** → Calling `extract_document_text` will, in the placeholder/short-browser cases, persist healed content. Mitigation: `get_document` already does exactly this and it is idempotent; the helper only writes when content actually changes. The YouTube and HTTP-short-circuit paths are untouched and remain side-effect-free reads.
- **[Regex heading parser limitations remain]** → Documents with no recognizable headings still rely on `buildHeuristicParagraphSections`. This change does not weaken that fallback.
- **[A manually typed chip can now resolve]** → Exact `#{title}` text resolves just like a picker-created chip. Ambiguous duplicate titles are blocked unless the pick-time selection identifies one, so this does not introduce arbitrary matching.
- **[Deck names can collide]** → Deck existence uses case-insensitive exact names derived from the persisted `deck:` tag. Existing unrelated decks are never renamed or overwritten; the store's normal deduplication rules remain in force.
- **[Title lookup can fail]** → A document card is not persisted when all three title sources are unavailable. This is intentionally fail-closed: the artifact reports the actionable error and can be retried once document metadata is available, avoiding another saved-but-unassigned card.
- **[Viewer catalog is ephemeral]** → The shared catalog is intentionally not persisted because it duplicates large transcript content. Document Q&A reconstructs it from existing audiobook metadata/transcript storage after restart; when neither source has timed data, it falls back to the normal document heading catalog after loading completes.
- **[Catalog text may omit untimed audio]** → Flashcard Studio uses the joined catalog only when canonical document content is absent. Every available timed chapter remains represented, and section-focused sends use only the selected chapter's attached text.

## Migration Plan

1. Land frontend `sectionIndex.ts` changes (D1–D3) + tests behind the existing build; no flag needed — the resolver is pure and fully tested.
2. Land the Rust shared helper (D4) + test; both commands now heal identically.
3. Land diagnostics (D5).
4. Manual verification against the reported EPUB (deep outline), a PDF with a front-matter TOC, and a short-content browser import.

Rollback: revert the commits; no data migration is involved (any DB rows healed by D4 are strictly improvements and need not be reverted). The section tree cache is content-keyed and self-heals.

## Open Questions

- Should the Assistant also retry with a freshly rebuilt tree when the *empty-body* guard fires (today it retries only when `!focused.ok`)? Tentatively yes, but the retry already runs once on failure and D3 makes the body-aware resolution the primary path, so the second retry may be redundant — to be confirmed during implementation.
