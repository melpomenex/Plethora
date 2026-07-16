## Context

The app has two parallel "queue" surfaces that the word "review" blurs together:

1. **The Review Session** (`ReviewTab` → `ReviewSession`) — the flashcard experience: one card at a time, rate it (Again/Hard/Good/Easy), FSRS/SM-x rescheduling. Driven by `src/stores/reviewStore.ts`.
2. **The Queue / Optimal Queue** (`QueueTab` → `ReviewQueueView`) — the list view of "what to study next," which natively hosts reading items (documents) in its `reading` mode and launches a scroll session. Driven by `src/stores/queueStore.ts`.

Today `reviewStore.loadQueue()` fetches **both** `getDueItems()` (flashcards) **and** `getDueDocumentsOnly()` (documents), maps the documents into `ReviewDocumentItem`, and **interleaves** them into a single session queue (`reviewStore.ts:215-330`). When the current card is a document, the answer is force-revealed and the rating is routed to `rateDocument` instead of the flashcard scheduler. This mixing is purely a frontend composition — the backend already keeps the two streams in separate commands (`get_due_items` returns only learning items; `get_due_documents_only` returns only documents).

## Goals / Non-Goals

**Goals:**
- The Review Session queue contains flashcards / learning items only — never documents.
- A user starting a review never lands on an auto-revealed document "card."
- Reading-item review remains fully available in the Queue (Optimal Queue) tab — unchanged.
- Remove the now-dead `ReviewDocumentItem` type, the interleaving logic, the `ReviewDocumentCard` component, and the `rateDocument` branch in `submitRating`, so the codebase does not carry unused branches.

**Non-Goals:**
- Changing the Queue / Optimal Queue behavior, filters, or modes.
- Changing any backend command, SQL query, or repository method.
- Changing FSRS / SM-x scheduling algorithms.
- Removing the `get_due_documents_only` backend command — it is still used by the Queue's `due-today` reading mode (`ReviewQueueView` → `loadDueDocumentsOnly`).
- Migrating stored sessions — in-flight `reviewedIds` that reference `doc:` ids simply won't match pending flashcards and become harmless no-ops.

## Decisions

### Decision 1: Frontend-only change, scoped to `reviewStore.loadQueue`
**Choice:** Drop the `getDueDocumentsOnly()` fetch and the document mapping/interleaving from `loadQueue()`. Reduce the session queue to the sorted `LearningItem[]` from `getDueItems()`.
**Rationale:** The backend already separates the streams — `get_due_items` (`src-tauri/src/commands/learning_item.rs:55`) returns only `LearningItem` rows. The interleaving exists only client-side. Touching the backend would be strictly wider blast radius for zero behavioral benefit.
**Alternatives considered:**
- *Backend filter flag on `get_due_items`* — unnecessary; the command already excludes documents by construction.
- *A user setting to toggle documents in review* — rejected; the user's intent is that reading items do not belong in the review queue at all, not that it's optional.

### Decision 2: Narrow the union, don't keep a never-used document variant
**Choice:** Replace `ReviewSessionItem = LearningItem | ReviewDocumentItem` with the session queue typed as `LearningItem[]`. Remove `ReviewDocumentItem`.
**Rationale:** Keeping a phantom variant forces every downstream consumer (`ReviewSession`, `submitRating`, `loadPreviewIntervals`) to keep a dead branch. Removing it lets TypeScript prove the remaining code is exhaustive.

### Decision 3: Delete `ReviewDocumentCard.tsx` and the document render branch in `ReviewSession.tsx`
**Choice:** Remove the component file and the conditional that renders it.
**Rationale:** Dead code rots and confuses future readers. The card has a single call site.

### Decision 4: Preserve the empty-session contract
**Choice:** When `getDueItems()` returns `[]`, behave exactly as today's empty-flashcards case — no session id, empty queue, no-due-cards UI. Do **not** fall back to documents to "pad" the session.
**Rationale:** Matches the corrected mental model and the proposal's explicit empty-state requirement.

### Decision 5: Leave stored-session `reviewedIds` untouched
**Choice:** No migration. `reviewedIds` may still contain `doc:<id>` entries from prior sessions; they simply never match a `LearningItem.id` going forward.
**Rationale:** The set is additive/filter-only; stale entries are inert. A migration would be disproportionate.

## Risks / Trade-offs

- **[Users who relied on reviewing documents from the Review tab]** → Mitigation: documents remain one tab away in the Queue (`reading` mode → "Start Optimal Session"). The change aligns the two surfaces with their distinct purposes; this is the intended behavior, not a regression.
- **[Dead-code removal touches several files]** → Mitigation: TypeScript will flag any missed branch at compile time (the narrowed union makes document branches type-errors), so verification is mechanical.
- **[Stale `reviewedIds` with `doc:` prefixes]** → Mitigation: inert by construction (Decision 5); no behavior change.
- **[Other call sites of `getDueDocumentsOnly`]** → Verified: the only other consumer is the Queue view via `queueStore`/`ReviewQueueView`, which is intentionally untouched. `reviewStore` is the only place mixing the two streams.

## Migration Plan

No data migration. Deploy is a frontend bundle change. Rollback is a revert of the commit — no schema or stored-state consequences.

## Open Questions

None. The backend boundary is clean and the change surface is contained to the frontend review store and its direct consumers.
