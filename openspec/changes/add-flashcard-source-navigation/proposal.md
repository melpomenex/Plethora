## Why

Flashcards in Plethora are frequently born from reading — an extract, a selection, an AI pass over a document section — yet during review the card is detached from the material that produced it. `add-review-source-context` shipped a passive "From: *Document title*" strip on review cards and explicitly deferred the next step: "No deep-linking into the reader from the context panel (future work)". Meanwhile every ingredient for that navigation already exists — extracts persist rich positional anchors (`selection_context`: PDF canonical word-ID anchors, EPUB CFI ranges, text offsets, audio-capture provenance; plus `page_number`), and the exact-search-hit work built a complete "open document at exact passage with visible highlight" pipeline (`ExactSearchHitLocation` → `openDocumentAtLocation` → per-viewer jump + highlight). What is missing is the connective tissue: cards carry no locator of their own, several creation pathways discard the positional data available at capture time, and no UI invokes the jump machinery from review.

This change closes that gap: a flashcard generated from source material becomes durably navigable back to the exact originating passage, with surrounding context, and a lossless return to the interrupted study session.

## What Changes

- **Provenance capture at creation time**
  - Persist the already-computed but ephemeral Studio section provenance (`SectionSourceReference`) onto saved AI-generated cards.
  - Add a nullable `source_reference` JSON column to `learning_items` holding a locator snapshot (existing `ExactSearchHitLocation`-shaped locator + originating excerpt + fingerprint) for cards created **without** an extract (Studio AI saves, assistant/MCP tool cards, browser-capture AI cards).
  - Extract-backed cards need no new data: their provenance remains `learning_items.extract_id → extracts.selection_context / page_number`, which is already durable.
  - Close two capture gaps where positional data is available but dropped: inline extraction (Ctrl+E) and Learn-This card creation already hold selection context that is not persisted on the card-facing path.
- **Source resolution service** — a single resolver that turns a card into a navigable target by trying, in order: extract structural locator → card `source_reference` locator → `ai_provenance` capture record → constrained quote match (reuse `resolveCitationLocation` semantics) → coarse page/section → "unavailable". Resolution is lazy (on activation, not on card render) and never silently lands on wrong text: below-confidence results degrade to coarse location with a visible notice, never a false highlight.
- **Review UX** — upgrade the existing `CardSourceContext` strip from passive text to the primary affordance: activating "From: *title*" (or pressing the new `V` shortcut) opens the source. No new clutter; the strip already hides itself when no source resolves. Deck-browser card context menu gains the same action. Zen mode's dead hold-Alt context peek is rewired to the same resolver.
- **Navigation & return** — jumping reuses `openDocumentAtLocation` (document-viewer tab, `initialJump` + highlight). The review tab stays mounted behind the document tab; a "Back to flashcard" return affordance in the viewer header re-activates it with queue position, flipped state, and session progress intact (review state lives in the global `reviewStore` and survives as long as the tab is not evicted — the origin review tab is made eviction-safe for the duration of the jump).
- **Failure states** — deleted/modified/corrupt sources degrade gracefully: "Source unavailable" panel with the cached excerpt, coarse-location fallback with an explanatory toast, never a dead button (affordance hidden when nothing resolves).
- **Persistence plumbing** — one SQLite migration (`ALTER TABLE learning_items ADD COLUMN source_reference TEXT`), sync via the existing delta-log whole-row payload (`#[serde(default)]`, `"content"` field group apply + upsert INSERT), collection-archive import INSERT lists, browser/PWA type parity. No server changes; nothing backfilled for legacy cards (they resolve dynamically from their existing extract linkage or remain source-less).

### Out of scope (future enhancements)

- Manually attaching a source to an existing card; multi-source cards (schema keeps one primary anchor); hover source-preview popovers; source history/provenance inspector; backfilling `selection_context` onto legacy extracts; syncing `ai_provenance`.

## Capabilities

### New Capabilities

- `flashcard-source-navigation`: Flashcard provenance — capture-time source anchoring, lazy resolution ladder, review-surface "view source" affordance, exact-passage navigation with highlight, study-state-preserving return navigation, and degradation for stale/missing sources across desktop and mobile.

### Modified Capabilities

- None. `exact-search-hit-navigation` and `extract-source-navigation` behaviors are consumed as-is; the review-session queue contract in `flashcard-review-session` is unchanged.

## Impact

- **Rust**: `src-tauri/src/database/migrations.rs` (migration 116), `src-tauri/src/models/learning_item.rs` (`source_reference` field), `src-tauri/src/database/repository.rs` (create/update/read paths), `src-tauri/src/sync/full_state.rs` (field-group apply + upsert), `src-tauri/src/commands/review.rs` (new `resolve_card_source` command alongside `get_card_source_context`), `src-tauri/src/commands/collection_archive.rs` (import INSERT lists), `src-tauri/src/mcp/tools.rs` + `src-tauri/src/commands/learning_item.rs` (accept optional provenance input).
- **Frontend**: `src/components/review/CardSourceContext.tsx` + `ReviewCard.tsx` (affordance), `src/components/review/ReviewSession.tsx` + `src/components/common/KeyboardShortcuts.tsx` (`V` shortcut), new `src/utils/cardSourceNavigation.ts` (resolution + jump orchestration), `src/components/review/ZenReviewMode.tsx` (rewire ContextPeek), `src/components/review/FlashcardStudioModal.tsx` (`handleSaveSelected` persists section provenance), `src/components/viewer/DocumentViewer.tsx` (return-to-review header affordance), `src/stores/tabsStore.ts` (origin-tab eviction guard), `src/types/` + `src/api/` (types, wrappers), i18n locale files.
- **Compatibility**: nullable column + `#[serde(default)]` — old clients ignore the field; no sync server change; backup unaffected (DB-level); collection-archive export automatic via serde, import needs the explicit INSERT update.
