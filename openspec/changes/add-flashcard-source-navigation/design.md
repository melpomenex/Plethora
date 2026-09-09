## Context

Verified current state (file:line references from investigation):

- **Cards carry only `extract_id` / `document_id`.** `learning_items` (src-tauri/src/database/migrations.rs:109-137, extended through migration 115) has no positional column. All precise locators live on the extract: `extracts.selection_context TEXT` (migration 029, migrations.rs:942) holds `SelectionContext` (src/types/selection.ts) — `PdfSelectionContext` incl. the v2 canonical word-ID anchor, `EpubSelectionContext` with `cfiRange`, `TextSelectionContext` with char offsets — plus `extracts.page_number` and `source_url`.
- **The jump pipeline exists end-to-end**: `ExactSearchHitLocation` (src/types/searchHit.ts: pdf/epub/html/markdown/youtube/audio) → `openDocumentAtLocation(documentId, {highlightQuery, initialJump}, addTab)` (src/utils/openDocumentAtLocation.ts:78) → `document-viewer` tab payload → per-viewer jump+highlight: PDF text-layer `mark.pdf-search-highlight-target` + `pendingNavRef` + restoration window (PDFViewer.tsx:908-1250), EPUB `initialCfi` display + search annotations + tolerant full-book quote search (EPUBViewer.tsx:1814, 2360-2433; src/utils/epubQuoteSearch.ts), HTML iframe `scrollHtmlFrameToInitialHit` mark insertion (DocumentViewer.tsx:6416-6477), youtube/audio `initialSeekTime` + `initialTranscriptSegmentId`. `initialJump` suppresses stored-position restore (DocumentViewer.tsx:3665-3671).
- **Quote-fallback matching exists**: src/utils/resolveCitationLocation.ts (normalized 120→60-char prefix matching over document content; `\f` page separators for PDF; transcript segments for media), used by `openLibrarySource.ts` for RAG citations — the closest precedent for this feature.
- **Display-only source context shipped**: `get_card_source_context` (src-tauri/src/commands/review.rs:124-200) + `CardSourceContext` rendered at ReviewCard.tsx:750; it resolves document title / 200-char extract snippet / page_number / source_url, returns null when the document row is gone. Its proposal explicitly defers deep-linking ("future work"). It does a full `get_all_learning_items()` scan per call (review.rs:142-146).
- **Capture gaps**: FlashcardStudio computes `SectionSourceReference` (documentId, sectionIds, labels, contentHash, char ranges — src/utils/sectionIndex.ts:33-40) for `#`-section generation but `handleSaveSelected` (FlashcardStudioModal.tsx:3526-3680) never persists it. Assistant/MCP card tools (`create_qa_card`, src-tauri/src/mcp/tools.rs:669-800) accept only `document_id`; chat artifacts carry an optional `source?: SectionSourceReference` (src/features/assistant/chatFlashcardArtifacts.ts:25) that is dropped. Inline extraction (Ctrl+E, DocumentViewer.tsx:2096-2131) and Learn-This (src/components/learn/acceptLearnThis.ts) hold selection context that doesn't reach the card-facing path (Learn-This writes passage+selectionContext into the `ai_provenance` table instead — migrations.rs:2758-2771; not synced).
- **Dead precedents to retire/repurpose**: ZenReviewMode hold-Alt `ContextPeek` (ZenReviewMode.tsx:242-276) reads `item.context` fields no code ever sets — always null. The legacy review page (src/routes/review.tsx:398-443) renders a "Source jump" button gated on a `source_anchor` field (src/api/review.ts:321) that the Rust model never populates, dispatching a `plethora:source-jump` CustomEvent with no listener.
- **Tab/return mechanics**: tabs stay mounted once activated unless evicted by the resident cap (TabContent.tsx:206-251; `DEFAULT_RESIDENT_TAB_CAP = 8`, tabsStore.ts:355); review session state lives in the global `reviewStore` (queue, currentIndex, isAnswerShown) and survives tab switches, but `ReviewTab` unmount resets the session (ReviewTab.tsx:50-60, arena grade excepted). `openDocumentAtLocation` uses a fresh `jumpRequestId`, and `findReusableTab` keys on the whole data payload, so each jump currently opens a new tab rather than retargeting an open one.
- **Sync/migration machinery**: delta-log sync with whole-row serde payloads; adding a `#[serde(default)]` field to `LearningItem` (src-tauri/src/models/learning_item.rs:50-104) flows into payloads automatically; incoming applies need the column added to the `"content"` group UPDATE in sync/full_state.rs (`apply_learning_item_groups`, `upsert_learning_item` INSERT); collection-archive import uses explicit INSERT column lists (src-tauri/src/commands/collection_archive.rs ~280 and ~643); migrations are appended to `MIGRATIONS` (next ordinal: 116). No server change is needed — payloads are opaque ciphertext.

## Goals / Non-Goals

**Goals:**

- One resolution path shared by every review surface (card strip, shortcut, deck browser, Zen).
- Capture provenance at creation time wherever the origin is already known in memory.
- Zero false highlights: degrade visibly, never silently.
- Study-session continuity across the round trip.
- Offline-first: resolution and navigation are pure local reads.
- Minimal schema/sync surface; no server work; no legacy backfill.

**Non-Goals:**

- Manually attaching sources to existing cards; editing provenance.
- Multi-source cards (single primary anchor in v1; the JSON envelope can later hold a list without another migration).
- Backfilling `selection_context` onto legacy extracts or rewriting extract capture for every pathway (queue-scroll RSS, extension captures) — those extract-backed cards still resolve at coarse level via page/quote.
- Image-occlusion cards: `document_id`-only coarse open is not wired for occlusion sets in v1 (no text locator exists); their strip keeps today's display-only behavior when no text source resolves.
- New telemetry.
- Fixing the legacy `src/routes/review.tsx` page beyond leaving it inert (it is not the active review surface).

## Decisions

### D1 — Provenance home: extracts stay the primary anchor; one nullable card column for anchor-less cards

`learning_items.extract_id → extracts.selection_context/page_number → documents` **is** the Flashcard → SourceAnchor → Document chain the feature needs; extracts are already durable and synced. Rather than copying locator data onto every card:

- Extract-backed cards (the majority: viewer selections, Learn-This, generator, cloze/QA-from-extract) get navigation **for free** from existing linkage. No capture work, no migration for them.
- Cards created without an extract (Studio AI saves from `#`-sections, assistant/MCP tool cards, browser-capture AI cards) get a nullable `source_reference TEXT` JSON column on `learning_items` (migration 116).

Alternatives rejected:
- *Separate `card_source_references` table*: sync is a closed entity whitelist — a new table needs a new `EntityType`, payload builder, merge arm, tombstone semantics, server whitelist entry, and both archive-import paths (the `image_asset` path). Not justified for a 1:1 child record.
- *Locator on every card*: duplicates data already durable on extracts and invites divergence.

`source_reference` envelope (v1) — reuses existing formats, adds nothing novel:

```jsonc
{
  "version": 1,
  "document_id": "<uuid>",
  "locator": { "kind": "pdf", "pageNumber": 42, "textQuote": "…" },  // ExactSearchHitLocation
  "excerpt": "exact originating quote (≤300 chars)",
  "section_label": "Chapter 4 · Memory Systems",   // optional, shown in the strip
  "fingerprint": "<sha256-16 of source text at capture>",  // staleness detection
  "captured_at": "2026-09-08T…"
}
```

For Studio saves the locator is built from the `SectionSourceReference` already in hand (`kind:"html"|"markdown"`, `scrollPercent` from section char range over document content, `textQuote` = excerpt); for video/transcript tools `kind:"youtube"|"audio"` with `timeSeconds` + `segmentId`.

### D2 — Resolution: one frontend orchestrator, lazy, mirroring `openLibrarySource`

New `src/utils/cardSourceNavigation.ts`: `resolveCardSource(item): Promise<CardSourceResolution>` and `openCardSource(item, tabs)`.

Ladder (each step returns a confidence-tagged result; a step that "succeeds" wrongly is worse than a visible downgrade):

1. **Extract structural locator** — fetch extract (by `extract_id`), parse `selection_context`: PDF → `{kind:"pdf", pageNumber: pages[0].pageNumber, textQuote: excerpt}`; EPUB → `{kind:"epub", cfi: cfiRange, textQuote}`; text surfaces → `{kind:"html"|"markdown", scrollPercent: startOffset/contentLength, textQuote}`; `AudioCaptureProvenance` → `{kind:"audio"|"youtube", timeSeconds: audioTimestampSec}`. Exact anchor ⇒ high confidence.
2. **Card `source_reference.locator`** — validated (`version === 1`, document exists, kind known); malformed ⇒ treated as absent (spec: corrupt provenance ignored safely).
3. **`ai_provenance` capture record** — read `metadata_json` for `target_kind="learning_item", target_id=item.id` (Learn-This path already stores passage + selectionContext there); new read-only command `get_learning_item_ai_provenance` (the table currently has write-side commands only).
4. **Constrained quote match** — stored excerpt via the existing `resolveCitationLocation` semantics bounded to the coarse region (PDF page text via `\f` splits; document content for html/markdown; EPUB tolerant search `epubQuoteSearch.ts`). Unique match ⇒ navigate + highlight; multiple matches ⇒ navigate to coarse location only, no highlight (spec: no false highlight); no match ⇒ coarse location + "exact passage not found" toast.
5. **Coarse only** — `page_number` or document start.
6. **Unavailable** — document row missing ⇒ unavailable panel with excerpt; card anchor corrupt and no extract ⇒ affordance hidden.

Resolution runs **on activation only** (spec: lazy). The strip's existing `get_card_source_context` fetch (title/snippet/page) remains the render-time gate for showing the affordance; that command is extended with `extract_selection_context` passthrough is **not** needed — the resolver re-reads the extract via the existing extracts API on activation. The per-call full `get_all_learning_items()` scan in `get_card_source_context` (review.rs:142-146) is replaced with a direct indexed SELECT (small fix, keeps per-card render cost flat).

Rust-side resolution was considered and rejected: all quote-matching machinery (`resolveCitationLocation`, `epubQuoteSearch`) plus viewer-specific locator semantics already live in TS; `openLibrarySource.ts` proves the pattern.

### D3 — UX: the existing strip becomes the affordance; direct jump; `V` shortcut

Chosen: **upgrade `CardSourceContext`** from passive text to the primary control, acting as a **direct jump** (no preview popover).

- **What the user clicks**: the strip row itself — `BookOpen` icon + "From: *Document title* (p. N)" (+ `section_label` when present) + a trailing `ArrowSquareOut` affordance icon and the `V` kbd hint on desktop (ShortcutTooltip). Rendered as a `<button>` with `aria-label="View source: <title>"` (`aria-expanded` stays on the disclosure chevron, which remains for the snippet). The row already sits below the question (ReviewCard.tsx:750), is full-width (≥44px touch target on mobile), and already hides itself when nothing resolves — zero added clutter, and it appears **before** reveal (metadata, not a spoiler).
- **Alternatives considered**: header icon-button next to Edit/TTS (too small a target on mobile, invisible affordance for a first-class feature); preview-popover-then-jump (extra tap, popover positioning cost with no floating-ui dependency in the repo, interrupts study flow — rejected for v1; the strip's existing expand-snippet disclosure already serves the "peek" need); hover-only (a11y violation).
- **Naming/i18n**: action label "View source" — new `review.viewSource` key across en/fr/ja/zh/de/es (the legacy `review.sourceJump` key stays untouched). Unavailable state strings under `review.source.*`.
- **Keyboard**: `V` registered in `DEFAULT_SHORTCUTS` as `review.viewSource` (KeyboardShortcuts.tsx) and handled in ReviewSession (free key — review bindings are Space/1-4/Cmd-combos/Escape; vim family is reading-mode only).
- **Surfaces**: ReviewCard strip + `V` (primary); DeckManager card context menu entry (reuses `CardContextMenu` + resolver); Zen mode: rewire the dead `ContextPeek` to show the resolved snippet on hold-Alt **and** support `V` to jump. Search results / scroll-mode inline items / card editor: follow-ups, same orchestrator.
- **States**: resolving (brief, only on activation — inline spinner in the strip); navigating; unavailable (strip persists, activation opens the unavailable panel with excerpt instead of navigating).

### D4 — Navigation, tab reuse, and the return path

- **Jump**: `openCardSource` calls `openDocumentAtLocation(documentId, {highlightQuery: excerpt, initialJump}, addTab)` unchanged for the open-new-tab case, plus one extension for **tab reuse**: before adding, look for an existing `document-viewer` tab with the same `documentId` (`tabsStore`); if found, `updateTab(id, {data: {...data, initialJump, highlightQuery, jumpRequestId: fresh, reviewReturn}})` and activate it (TabContent's data-reference memo re-renders and the viewer re-jumps — the established `patchTabData` pattern, QueueScrollPage.tsx:429-432). This fixes "needless duplicates" without touching `findReusableTab` semantics for other callers.
- **Return**: the tab payload carries `reviewReturn: true` when the jump originated from review. `DocumentViewer`'s header renders a "Back to flashcard" ghost button (existing header-button style; `min-h-[44px]` on mobile) that activates the review tab (`setActiveTab` + store is untouched — `reviewStore` still holds queue/index/isAnswerShown). Mobile: edge-swipe back and the same button. Focus is restored to the card container (`reviewFocus.ts` convention). Desktop keyboard: the button is focusable; no new global shortcut (tab switching is Ctrl+Tab-native).
- **Eviction guard**: while a `reviewReturn` document tab is open, the origin review tab is added to a small `protectedTabIds` set consulted by the resident-cap eviction pass (tabsStore), cleared on return/close of the reader tab. This closes the one path that would destroy the session (`ReviewTab` unmount → `resetSession`, ReviewTab.tsx:50-60) without changing cap behavior generally.
- **State guarantees**: queue order/index/isAnswerShown/progress counters are `reviewStore` state — preserved verbatim by tab keep-alive; no persistence changes needed. Explicit exits (user closes review) behave as today.

### D5 — Capture points (creation-time, only where origin is already in memory)

| Pathway | Change |
|---|---|
| Studio `handleSaveSelected` (FlashcardStudioModal.tsx:3526) | If draft carries `sourceContext` (`SectionSourceReference`, stamped at :3491-3496) or `extractId`, write `source_reference` (from section ref) — extends the `CreateLearningItemInput` already sent through `create_learning_items_batch`. |
| MCP/assistant tools (`create_qa_card`/`create_cloze_card`/`batch_create_cards`, mcp/tools.rs:669-800) | Optional `source` argument (documentId + optional section/quote/timestamp); AssistantPanel passes the artifact's existing `source` field (chatFlashcardArtifacts.ts:25); browser-sync-server AI-card paths (browser_sync_server.rs:3377-3405) store their known `sourceUrl`-based context the same way. |
| Inline extraction Ctrl+E (DocumentViewer.tsx:2096-2131) | Pass the live `selectionContext` (already in scope) into `createExtract` so the extract anchors the card — no card schema involved. |
| Extract-backed generator / cloze / QA / Learn-This | No change (linkage already correct; Learn-This additionally gains resolution via D2 step 3). |
| Manual / paste / imports / NotebookLM / automation API | No change — no anchor written (spec: creation without provenance keeps working). |

Backfill for existing cards: **none** (spec + task requirement). Category behavior falls out of the ladder: (1) extract+`selection_context` → exact today; (2) extract without context → quote/page fallback; (3) neither → affordance hidden, except Learn-This cards which resolve via `ai_provenance`. No writeback, no fuzzy migration, no sync churn.

### D6 — Persistence, sync, and migration mechanics

- **Migration 116** (`migrations.rs`, appended): `ALTER TABLE learning_items ADD COLUMN source_reference TEXT;` — nullable, no backfill (precedent: 042/079/115).
- **Model**: `LearningItem.source_reference: Option<String>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`-style tolerance; `row_to_learning_item` uses tolerant `try_get(...).ok()` (repository.rs:279-347); added to the explicit INSERTs in `create_learning_item` / `create_learning_items_batch` (repository.rs:2894-3130) and the update path; `CreateLearningItemInput` gains the optional field (commands/learning_item.rs:231-290, :312-364).
- **Sync**: whole-row serde payload picks the field up automatically; add the column to the `"content"` field-group UPDATE in `apply_learning_item_groups` and to `upsert_learning_item`'s INSERT (sync/full_state.rs:431+, :795-943); the capture write path stages `learning_item_payload_with_fields(&item, &["content"])` + `mark_dirty` (outbox pattern, repository.rs:3396). Old clients: serde ignores unknown fields; `sync_fields` filtering drops nothing new. **No server change** (opaque ciphertext; `SYNC_TABLE_KINDS` unchanged).
- **Collection archive**: add `source_reference` to both import INSERT column lists (collection_archive.rs ~280, ~643); export picks it up via serde automatically. Backup: nothing (DB-level `VACUUM INTO`).
- **Browser/PWA parity**: TS `LearningItem` type (src/types/document.ts:337) + `browser-backend.ts` passthrough for demo mode.
- **TS type**: `CardSourceReference` in src/types/ (mirrors the envelope; discriminated from `SelectionContext`).

### D7 — Highlight rendering: reuse the search-highlight machinery, nothing new

Per viewer, `highlightQuery` + `initialJump` already produce verified-text highlights: PDF text-layer `mark.pdf-search-highlight-target` centered via `scrollIntoView({block:"center"})`; EPUB `epub-search-highlight-active` annotation at the displayed CFI; HTML iframe `<mark data-search-highlight="true">` inserted by text-node walking (no innerHTML — excerpt injection is inert by construction; React escapes the strip/unavailable panel). v1 keeps these persistent-until-next-navigation (existing behavior); a timed pulse (XThread precedent, XThreadViewer.tsx:103-125) is a follow-up. Reduced motion / e-ink: existing `:root[data-reduced-motion]` and `data-display-mode="eink"` CSS already forces instant scroll and static styling; no new animation is introduced.

### D8 — Performance

Render-time cost is unchanged: the strip's existing context fetch continues to gate affordance visibility (its scan → indexed SELECT fix keeps it O(1)); `source_reference` is one nullable column already present in the row. Activation-time cost is bounded: extract fetch by id, quote matching restricted to one page/section (EPUB tolerant search runs only on activation and only when steps 1-3 miss). No AI calls, no network, no full-document parse at render (spec: lazy resolution).

## Risks / Trade-offs

- **[Quote match lands on a different occurrence] →** bounded region + uniqueness requirement before highlighting; disambiguation via page/CFI when stored; otherwise coarse navigation with no highlight (spec-enforced).
- **[Tab reuse edge cases: split panes / background tabs] →** reuse targets the first matching `document-viewer` tab in any pane and activates it; if none, add. No change to singleton semantics of other tab types.
- **[Eviction guard leaks protection] →** protected ids cleared on reader-tab close, return, or review exit; set is runtime-only (never persisted), so worst case after a crash is a normal cap eviction.
- **[EPUB quote search cost on activation for large books] →** accepted: runs once per activation, off the render path, and only when CFI resolution already failed; `epubQuoteSearch` is the same path the palette uses today.
- **[HTML offset drift after document reparse/reimport] →** `fingerprint` + normalized quote match detect staleness; fallback is coarse scroll + explicit notice, never a wrong highlight.
- **[source_reference size] →** excerpt capped at 300 chars (same bound as `passageAroundSelection`), single locator object; envelope ≤ ~1-2 KB.
- **[ReviewTab reset on responsive-shell remount] →** existing arena-pending exception aside, the eviction guard covers the source-jump case; general shell-remount reset behavior is unchanged (out of scope).
- **[Legacy `routes/review.tsx` dead button confuses testing] →** left untouched; the i18n key stays; implementation must target ReviewTab surfaces, and the dead `plethora:source-jump` event is explicitly not a supported contract.

## Migration Plan

1. Ship migration 116 (additive ALTER) with the model/repository/sync/archive-import updates in the same change; nothing reads the column before it exists (tolerant reads).
2. Older clients receiving synced payloads ignore the unknown field; newer clients receiving payloads from older clients see `source_reference: null`.
3. Rollback: column is inert if unused; no data destruction. Revert = stop writing + ignore on read; a future cleanup migration may drop it.
4. Capture goes live pathway-by-pathway (Studio first, then MCP tools, then Ctrl+E); each is independently shippable behind the same schema.

## Open Questions

- Whether the DeckManager **preview panel** (in addition to the context menu) should also carry the affordance — cheap, but visual design sign-off was not available; defaulting to context-menu-only in v1.
- Exact visual treatment of the unavailable panel (inline expanded strip vs. modal) — spec fixes the content (excerpt + unavailable message); final styling follows the existing `ItemDetailsPopover` patterns during implementation.
