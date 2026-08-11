# Tag Surface Inventory

Checked-in audit for openspec change **unify-tag-editing-and-align-schedule-grid**
(capability `cross-surface-item-tag-editing`).

Every user-facing tag presentation for a **persisted document, extract, or
learning item** must be classified below as one of:

- `inline` — uses the shared `ItemTagEditor` (removable chips + add input)
- `compact` — uses the shared `CompactTagEditor` (trigger opens the editor)
- `form` — already-editable via an existing create/edit/import form (allowed to
  keep its form-specific layout)
- `rss` — RSS relational tag system (separate API/store; read-only from the
  item-tag perspective)
- `derived` — internal/derived tag detection (not a user-facing tag chip)
- `exception` — allowed informational context: must remain non-mutating and is
  documented here

Anything classified `exception` MUST be listed below or the inventory
regression check (`src/lib/tagEditing/__tests__/inventory.test.ts`) fails.

---

## Shared editor core (new)

| Surface | File | Item type | Class |
|---|---|---|---|
| Inline editor | `src/components/common/ItemTagEditor.tsx` | document/extract/learning-item | `inline` (shared) |
| Compact trigger/popover | `src/components/common/CompactTagEditor.tsx` | document/extract/learning-item | `compact` (shared) |
| Mutation adapter | `src/lib/tagEditing/mutationAdapter.ts` | — | persistence path |
| Optimistic hook | `src/hooks/useItemTagEditor.ts` | — | state path |
| Notification + store reconciliation | `src/lib/tagEditing/itemTagEvents.ts`, `storeReconciliation.ts` | — | sync path |

## Adopted persisted-tag surfaces

| Surface | File:line | Item type | Class |
|---|---|---|---|
| Item details popover (Queue + Review Queue) | `src/components/common/ItemDetailsPopover.tsx` | document/extract/learning-item | `inline` (rss branch stays read-only) |
| Schedule expanded details (Agenda + Data grid) | `src/components/schedule/ScheduleItemDetails.tsx` | document/extract/learning-item | `inline` |
| Document library row / compact row / library card | `src/components/documents/DocumentsView.tsx` (`TagsInline` → `CompactTagEditor`) | document | `compact` |
| Document inspector | `src/components/documents/DocumentsView.tsx` (inspector tags) | document | `inline` |

## Already-editable persisted-tag editors (retained forms)

| Surface | File | Item type | Class |
|---|---|---|---|
| Document bulk tag bar | `src/components/documents/DocumentsView.tsx` | document | `form` |
| Document library card "Add Tag" | `src/components/documents/DocumentsView.tsx` | document | `form` |
| Extract create/edit dialog | `src/components/extracts/EditExtractDialog.tsx`, `CreateExtractDialog.tsx`, `PasteExtractDialog.tsx` | extract | `form` |
| Extract quick creator | `src/components/extracts/ExtractCreator.tsx` | extract | `form` (kept its input; mutation via shared adapter path where possible) |
| Card preview edit tab | `src/components/review/CardPreviewPanel.tsx` | learning-item | `form` |
| Inline card editor | `src/components/review/InlineCardEditor.tsx` | learning-item | `form` |
| Deck Manager bulk retag | `src/components/review/DeckManager.tsx` | learning-item | `form` |
| Graph node detail | `src/components/graph/NodeDetailPanel.tsx`, `NodeDetailView.tsx` | document/extract | `form` |
| Queue bulk tags | `src/components/queue/BulkActionBar.tsx` | mixed | `form` |

## Passive persisted-tag presentations (must adopt)

| Surface | File:line | Item type | Class |
|---|---|---|---|
| Extract inbox item | `src/components/extracts/ExtractInbox.tsx` | extract | `compact` |
| Extracts list item | `src/components/extracts/ExtractsList.tsx` | extract | `compact` |
| Saved web extract list | `src/components/tabs/WebBrowserTab.tsx` | extract | `compact` |
| Video extract card | `src/components/video/VideoExtracts.tsx` | video extract (separate `video_extracts` table) | `exception` — read-only chips (separate data model, like RSS; shared mutation path does not apply) |
| Learning cards list | `src/components/learning/LearningCardsList.tsx` | learning-item | `compact` |
| Review card session header | `src/components/review/ReviewCard.tsx` | learning-item | `compact` |
| Card preview footer | `src/components/review/CardPreviewPanel.tsx` | learning-item | `compact` |
| Deck Manager card row | `src/components/review/DeckManagerCardRow.tsx` | learning-item | `compact` |
| Semantic Graph selected node | `src/components/review/SemanticGraphPanel.tsx` | learning-item/document/extract | `compact` |
| Card search results | `src/components/documents/DocumentsView.tsx` (`CardSearchResults`) | learning-item | `compact` |

## Allowed exceptions (non-mutating by design)

These surfaces render tags but MUST NOT invoke the shared mutation path.

| Surface | File | Reason |
|---|---|---|
| RSS article tags | `src/components/media/RSSReader.tsx`, `TagManagementView.tsx`, `TagInput.tsx` | RSS uses the separate relational tag system (`stores/tagsStore.ts`, `api/rss-tags.ts`); editable only inside the RSS system |
| Import previews (pre-persistence) | `src/components/import/ImportPreview.tsx`, `ImportDialog.tsx`, `WebArticleImportDialog.tsx`, `MarkdownBundlePreview.tsx` | Source/import metadata that has not become an Incrementum item yet; tags apply at import |
| Import source metadata | `src/components/media/YouTubeImport.tsx`, `AudiobookImportDialog.tsx` | Assigns internal tags (`audiobook`, `audio`, genre) at creation; not user-editable metadata |
| Delete confirmation summaries | `src/components/extracts/DeleteConfirmDialog.tsx` | Destructive confirmation summary — must not mutate |
| Export/print output | `src/components/queue/ExportQueueDialog.tsx`, `src/components/review/DeckManager.tsx` (JSON export) | Output-only views |
| AI-suggested tags | `src/components/import/TagSuggestions.tsx` | Derived suggestions applied at import time |
| `deck:*` internal tool tags | `src/components/assistant/AssistantPanel.tsx`, `src/components/tabs/DocumentQATab.tsx` | Internal deck-membership tags injected into card-creation tool calls |
| Clip/quick-add internal tags | `src/components/common/ClipboardQuickAddWatcher.tsx`, `src/components/viewer/DocumentViewer.tsx` (cloze), `FlashcardStudioModal.tsx` drafts | Pre-persistence or internal bookkeeping tags (`clipboard`, `cloze`) |

## Derived / internal tag detection (not rendered as chips)

- `DocumentsView.getCardTypeLabel` — `image-occlusion` tag → card type label
- `DocumentViewer` — `audiobook`/`audio` tags → file-type inference
- `FlashcardScrollItem` — `kindle` tag gates flashcard-create buttons
- `routes/review.tsx` — `typed:*`, `interaction:*`, `input:handwriting` → interaction type
- `ReviewHome` — `anki-import` tag → deck name derivation
- `SimilarContent` — matched-tag similarity (shows matched tags, derived)
- `QueueScrollPage` — `item.tags?.[0]` category fallback
- `MainLayout` vim-mode — `setNextDeckTag`
- `CommandCenter`/`GlobalSearch` — tag search indexes/filters (query-level)

## Not item tags (different concepts)

- Deck `tagFilters` (`stores/studyDeckStore.ts`, `ReviewHome.tsx`, `DeckStatsPanel.tsx`) — persisted deck membership filters, not item tags
- Session/queue tag filter chips (`SessionCustomizeModal`, `ReviewQueueView.availableTags`, `GlobalSearch`, `GraphFilters`) — filter controls, not item tags
- Graph legend labels — static legend text
