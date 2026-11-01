## Context

See `proposal.md` for the reported failure, verified root causes, and scope. This design covers how to make the existing video-extract feature a first-class queue and learning surface without changing FSRS, ranking, or cloud sync.

Current flow, as verified in source:

1. `CreateVideoExtractDialog` sends `add_to_queue` and the Tauri/browser adapter writes a `video_extracts` row.
2. The native adapter turns `add_to_queue=true` into `next_review_date = now + 1 day`; the browser adapter turns it into `now`.
3. `get_video_extracts_by_document` returns the row to the source viewer, but `useVideoExtractList` only fetches on mount/document change and neither viewer refreshes after creation.
4. The queue builders chain `get_due_video_extracts(now)` and `get_new_video_extracts()`; the latter requires `review_count = 0 AND next_review_date IS NULL`.
5. Queue Scroll Mode converts the row to `type: "document"` with `videoExtractId`, so rating, details, dismiss, delete, time tracking, and session removal all target the parent document.
6. The browser queue builders omit video extracts entirely.
7. `DueVideoExtractsReview` is tested but has no production call site.

### Relationship to the prior Issue #6 change

The unarchived `fix-issue-6-scheduling-and-learning-workflows` change remains valid. Its `video-extract-review-lifecycle` delta owns seen/reviewed semantics, independent FSRS state, and the retry-safe rating transaction. This change does not rewrite those requirements; it routes the real Queue, creation flow, and discovery surfaces into them. The only behavioral maturations are (a) the source-panel review candidate filter, which changes from "all extracts with zero reviews" to the canonical queued-eligible policy, and (b) Seen is explicitly confirmed by playing media inside the segment (matching the current `useVideoExtractPlayback` implementation), not by merely selecting/opening the row. At archive time both capability specs coexist without contradiction: one defines review state/commit semantics, the other defines creation, queue membership, identity routing, discovery, playback, and cross-platform integration.

## Goals / Non-Goals

**Goals:**

- One persisted queue-membership model that means the same thing in native and browser adapters.
- Creation intent that matches the checkbox, with an optional future start date.
- A single eligibility predicate used by every queue, schedule, and forecast reader.
- Extract identity preserved through queue normalization, rendering, actions, playback, rating, and persistence.
- Immediate, race-safe discovery in the source viewer and the existing library-wide Extracts view.
- A conservative additive migration that never rewrites review history.

**Non-Goals:**

- Any change to FSRS/FSRS-7, DAQE urgency terms, priority rank semantics, document/text-extract scheduling, or queue ordering policy.
- Cloud sync protocol or server changes.
- Creating root Document rows for video extracts.
- Extending global search, bulk move/suspend/lifecycle commands, or auto-postpone execution to video extracts.
- Applying the global `newCardsPerDay` policy to the entire reading queue. The existing composition shares and source-panel new-item limit remain the applicable limits.

## Canonical model

### Persisted fields

| Field | Type | Meaning |
|---|---|---|
| `queue_status` | `'not_queued' \| 'queued'` | Explicit membership. Never inferred from the date at read time. |
| `next_review_date` | nullable UTC instant | Meaningful only when `queue_status='queued'`: NULL means an unreviewed item eligible now; otherwise the first eligibility instant. When `not_queued`, a retained value is inert. |
| `collection_id` | string | Copied from the source document at creation; backfilled from the parent for legacy rows. |
| `first_seen_at`, `last_seen_at` | nullable UTC instants | Unchanged from the prior issue #6 work. Playback only. |
| `memory_state`, `review_count`, `reps`, `last_review_date` | existing | Unchanged review history. Membership toggles never touch them. |

### Derived states

| Condition | Eligibility | Lifecycle label | Queue label |
|---|---|---|---|
| `not_queued` | never | New if `review_count=0` and unseen; Seen · Not reviewed if seen and `review_count=0`; Reviewed if `review_count>0` | Not in queue |
| `queued`, `review_count=0`, date NULL | eligible now | New / Seen · Not reviewed | In queue · new |
| `queued`, `review_count=0`, date <= cutoff | eligible | New / Seen · Not reviewed | In queue · due |
| `queued`, date > cutoff | not eligible | New / Seen · Not reviewed or Reviewed | In queue · scheduled |
| `queued`, `review_count>0`, date <= cutoff | eligible | Reviewed | In queue · due |
| `queued`, `review_count>0`, date NULL | not eligible (legacy anomaly) | Reviewed | Needs schedule |

`is_new_item` remains `review_count == 0`, independent of whether the row is currently due. "New" is a lifecycle label, not an eligibility state.

### Lifecycle transitions

| From | Event | To |
|---|---|---|
| (none) | Create with `add_to_queue=false` | Saved, not queued, New if unseen |
| (none) | Create with `add_to_queue=true`, no future date | Queued, unreviewed, eligible as new |
| (none) | Create with `add_to_queue=true`, future date | Queued, unreviewed, scheduled |
| Queued scheduled | Eligibility cutoff reaches the date | Queued and eligible (still New if never reviewed) |
| Queued/not queued, unseen | Successful bounded playback | Seen · Not reviewed; no review event |
| Queued, eligible | User rating | Reviewed; one receipt; memory/count/next date updated; remains queued |
| Reviewed | Next review date reached | Eligible (due) again |
| Any | Remove from queue | Saved, not queued; history and content preserved |
| Not queued | Add to queue | Queued; retained date reused or made eligible per the rules |
| Any | Delete extract | Row absent from discovery/queue; receipts retained |
| Any | Parent archived/dismissed | Row saved and discoverable; not queue-eligible |
| Any | Parent deleted | Native cascade removes the row; browser filters it; receipts retained |

Opening, selecting, or viewing a segment is not a successful recall and MUST NOT create a review event, increment a counter, change memory, or set a next review date. Only an explicit rating does that. A reviewed item remains `Reviewed` even if it was never seen (legacy rows), and a seen item remains `Seen · Not reviewed` until a rating commits.

### Invariants

1. `queue_status='not_queued'` rows are never returned by an ordinary queue candidate query.
2. New-created `queued` rows with `review_count=0` may have NULL date. New-created reviewed rows may not.
3. A queued row with a date uses that date for eligibility; the date is never used to infer membership in the new code.
4. Removing from the queue preserves the date as an inert resume hint and preserves all history.
5. Re-adding a reviewed row without a retained date makes it eligible immediately; re-adding an unreviewed row without a date keeps it new/eligible now.
6. Toggling membership or editing content never changes memory, counts, last review, seen timestamps, or receipts.

## Decisions

### D1. Persist an explicit two-state queue membership field

Add `queue_status` rather than another boolean whose meaning depends on the caller. A boolean would reproduce the ambiguity of `next_review_date = NULL`; reusing `is_dismissed` would conflate "never added" with "hidden by the user" and the video table has no such column. A separate membership table is unnecessary because only this entity needs the relation and the queue already reads entity rows directly.

Use a typed Rust enum (`VideoExtractQueueStatus`) serialized as `not_queued`/`queued`, and a TypeScript union with the same literals. Parse unknown/missing values on legacy archive import as `not_queued` unless the archive normalization rule below says otherwise.

**Rejected:** making NULL date mean both "new" and "not queued"; adding `is_dismissed`; adding a generic queue-membership table; storing a tri-state that includes future scheduling states (future scheduling is already represented by the date).

### D2. Resolve creation intent in one pure domain function

Add a pure function that maps `(add_to_queue, initial_review_date, now)` to `(queue_status, next_review_date)`:

| Input | Result |
|---|---|
| `false` | `not_queued`, NULL |
| `true`, no date | `queued`, NULL |
| `true`, date on the current UTC day | `queued`, NULL (eligible now) |
| `true`, future date | `queued`, start of that UTC day |
| `true`, date before the current UTC day | validation error |
| `false` with a date | validation error |

Place it beside the video-extract model/repository so the Tauri command, MCP tool, and tests call the same function. The repository creation method loads the parent document, validates that it exists and is `video`/`youtube`, trims and validates the title, copies the parent collection, applies the intent, and inserts in one transaction. Do not duplicate this logic in `commands/video.rs` and `mcp/tools.rs`.

`add_to_queue` remains `Option<bool>` for wire compatibility, but canonical resolution uses `unwrap_or(false)`. The creation dialog sends an explicit boolean and defaults to checked. The MCP schema may document a true default, but the tool must pass `true` explicitly; it must no longer create tomorrow's date.

**Rejected:** subtracting one day from the old tomorrow behavior; setting `next_review_date = now` for every queue creation; using the UI default as the API default for all callers.

### D3. Separate scheduling from membership; add a membership command

New repository/command operations:

- `set_video_extract_queue_membership(extract_id, queued, initial_review_date?)`
- `postpone_video_extract(extract_id, days)`
- `get_video_extract_review_candidates(document_id?, cutoff?)`
- `get_all_video_extracts(collection_id?)`

Membership rules:

- `queued=false`: set `not_queued`; leave `next_review_date` unchanged (inert). Reject an `initial_review_date`.
- `queued=true` with an explicit date: validate and set it.
- `queued=true`, no explicit date, retained date exists: reuse it.
- `queued=true`, no explicit date, no retained date, `review_count=0`: keep NULL (new/eligible now).
- `queued=true`, no explicit date, no retained date, `review_count>0`: set `now` so the item is eligible rather than invalid.

The command must read/update/read in one transaction and return the canonical row. It must not touch memory, counts, seen timestamps, or receipts. Postpone requires `queued=true`, shifts the date (or starts from `now` when the queued item is new with NULL), and preserves history. The frontend computes the smart-postpone interval from the queue item's memory fields and calls this command with the resulting day count.

The browser adapter implements the same operations in one IndexedDB transaction.

**Rejected:** treating membership removal as dismissal/archival; clearing FSRS state on removal; deleting the row on removal; delegating video postponement to the learning-item branch of `postpone_item`.

### D4. One SQL predicate, consumed everywhere

Add `Repository::get_video_extract_queue_candidates(cutoff)`:

```sql
SELECT ve.*
FROM video_extracts ve
JOIN documents d ON d.id = ve.document_id
WHERE ve.queue_status = 'queued'
  AND COALESCE(d.is_archived, 0) = 0
  AND COALESCE(d.is_dismissed, 0) = 0
  AND (
    (ve.next_review_date IS NULL AND ve.review_count = 0)
    OR (ve.next_review_date IS NOT NULL AND ve.next_review_date <= ?1)
  )
ORDER BY ve.next_review_date ASC, ve.id ASC
```

Replace both `get_due_video_extracts` + `get_new_video_extracts` chains in `commands/queue.rs` with this one call. The two old methods must not remain as alternate policies; either delete them or make `get_due_video_extracts` a deprecated thin wrapper that calls the candidate method. Update all callers and tests in the same task.

Collection filtering remains in the existing queue assembly (`collection_allows`) but now reads the real row value. In `get_due_queue_items_from_repo_at`, the preliminary title-collection pass must also use `collection_allows` rather than strict `collection_id == cid`, so legacy/default-scoped video and text extracts do not render as "Unknown Video". Parent active filtering is in SQL so archived/dismissed videos cannot leak through any producer. The library query (`get_all_video_extracts`) is separate and never applies eligibility.

Update:
- `get_queue_items_from_repo` and `get_due_queue_items_from_repo_at` (single call, no chain, one `doc_ids` pass).
- `get_startup_queue_preview_from_repo`, `get_next_queue_item`, `get_queue_items`, `get_queued_items`, `get_queue_with_playlist_intersperse`, and `due_candidate_pool` through the same builders.
- `get_workload_forecast_grouped`: add `queue_status='queued'` and parent-active conditions to the video date/overdue counts.
- `auto_postpone` candidate and scheduled-date queries: add `queue_status='queued'`.
- Browser `get_queue` / `get_due_queue_items`: add one video-extract pass with the same predicate, parent-active filter, collection filter, and no duplicate pass.

`get_due_documents_only` remains documents-only. Video extracts are not added there.

`get_queue_stats` remains learning-item-only in this change; it is a pre-existing cross-type counting limitation, not a video-specific regression. The queue views and tests compute counts from returned queue rows.

### D5. Eligibility, ordering, and presentation limits are distinct

Eligibility is the SQL predicate above. Ordering remains `QueueSelector::sort_queue_items_at` (due bucket first, then canonical priority, due date, deterministic ID tiebreak). Presentation limits (`get_queue_items(count)`, the 50-row startup preview, and the first render) are applied after ordering.

No test may infer "not in the queue" from a count-limited call. Acceptance tests call the candidate method at an explicit cutoff to prove membership, then call the presentation method to prove visibility and ordering.

Priority behavior is unchanged: a video extract's explicit `queue_external_priorities` slider wins, otherwise it inherits the parent document's rank; `priority_display_slider` keeps the existing readback and the row's `stability`/`difficulty` are now populated from its memory state for details and smart postpone. No ranking math, manual-priority semantics, or parent priority mutation changes.

### D6. Preserve video-extract identity in Scroll Mode

Extend `QueueItem` (Rust DTO and `src/types/queue.ts`) with video playback metadata:

- `entity_title: Option<String>` — the extract title, distinct from the combined source title.
- `start_time: Option<f64>`, `end_time: Option<f64>` — only meaningful for `item_type='video-extract'`.

Keep `entity_id` as the extract ID and `document_id` as the parent source ID. `extract_id` remains NULL for video rows so no existing document/extract action confuses the two.

Extend the `ScrollItem` union with a real `"video-extract"` variant:

```ts
interface VideoExtractQueueRef {
  id: string;
  title: string;
  documentId: string;
  sourceTitle: string;
  startTime: number;
  endTime: number;
  reviewCount: number;
  nextReviewDate?: string;
  firstSeenAt?: string | null;
}

type ScrollItem =
  | { type: "video-extract"; videoExtract: VideoExtractQueueRef; ... }
  | ...existing variants;
```

Remove the `videoExtractId?: string` side-channel from the document variant. Add a `toVideoExtractScrollItems` builder; make `toDocumentScrollItems` explicitly ignore non-document queue rows.

Treat video extracts as Extracts for every type gate:

- `gateScrollItemsByType`: `video-extract` → `itemTypes.extracts`.
- `gateScrollItemsByComposition`: `video-extract` → `composition.extracts > 0`.
- `selectByQuotaInOrder`: `video-extract` → `extracts`.
- `orderScrollItemsByCombinedCriterion` / `PrioritizableScrollItem` and `queueScrollKeyboard` type unions include `"video-extract"` as a topic.
- Sequential partition puts video extracts in `extractPool`, not `documentPool`.
- Optimal path builds eligible video items from `allQueueItems` (or the custom subset) and appends them to the extract pool before composition.

**Rejected:** keeping `type: "document"` plus a side-channel; representing the extract as the source document and relying on a parent-ID guard; creating a new ScrollItem type that bypasses composition.

### D7. Rating dispatch is type-first and extract-only

In `QueueScrollPage.handleRating`, check `currentItem.type === "video-extract"` before the document branch:

```ts
if (currentItem.type === "video-extract") {
  const result = await videoReview.rate(currentItem.videoExtract.id, rating);
  if (!result) return; // pending/deduped intent
  setRatedVideoExtractIds(prev => new Set(prev).add(currentItem.videoExtract.id));
  setItemsReviewedThisSession(n => n + 1);
  advanceAfterRemoval(currentItem.id);
  return;
}
```

Use the existing module-level `useVideoExtractReview` controller, not a new API call. This preserves one operation ID per intent, replay of an uncertain response, conflict rejection, and the single-event backend transaction. Do not call `rateDocumentEngaging`. Do not call the dedicated `VideoExtractCard` handler from Scroll Mode.

The same branch must be reached by:
- rating buttons via `ScrollOverlayControls.onRate`;
- keyboard 1–4 / 0–5 via `resolveScrollRatingKey` and `rateCurrentItemRef`;
- mobile rating controls that call `onRate`;
- any future queue surface.

Track `ratedVideoExtractIds` for rebuild suppression, add a `canPresentItem` case for `video-extract`, and add a barrier-filter case in `applySessionItems`. Emit the existing generic `review.card-graded` feedback for the rating and the existing `review.session-completed` when the last item is rated. Do not emit `queue.document-rated` or any parent-document-scoped feedback from this branch.

### D8. Every queue action targets the extract

- `detailsTarget` / `buildDetailsTarget`: add a `video-extract` variant with the extract ID, title, tags, and source title. `ItemDetailsPopover` loads it with `getVideoExtract`; use `null` stats (video extracts have no item-stats row) and do not mount the tag/category editors for this type; render tags read-only.
- `handleDetailsDelete`: `deleteVideoExtract(id)` only.
- `handleDismiss`: for `video-extract`, call the membership command with `queued=false`, show an undo that re-adds it, and advance. Never call `dismissDocument`.
- `handleDetailsPostpone` / `postponeItemSmart`: add a `video-extract` branch using the queue item's stability/difficulty/reps and `postpone_video_extract`.
- `handleActionRemove` / action-sheet actions: video → remove membership; no suspend/dismiss.
- `getQueuePrimaryAction` / labels: add an `open-video-extract` action so the sheet says "Open segment", not "Open document".
- `getQueueItemSheetActions` / `getQueueSecondaryActions`: video → open segment, postpone, remove from queue; omit select/suspend/dismiss.
- Bulk selection: exclude video-extract rows from bulk selection until bulk commands support them. Do not pass video IDs to learning-item bulk commands.
- Audit every queue presentation, including `src/routes/queue.tsx` and `QueueContextMenu`: its primary action opens the segment, its delete/postpone callbacks use the video commands, and its shared `canPostpone`/context-menu capability tables include `video-extract`. Do not leave a second, older queue surface that still opens the parent document or routes delete through `bulkDeleteItems`.

`advanceAfterRemoval` currently adds `removedItem.documentId` for every item. For `video-extract`, add `videoExtract.id` and **do not** add the parent document ID. Otherwise rating one segment marks the whole source video removed from the session.

`queueTimedTarget` returns `null` for video extracts in this change. Queue-level unrated time is not written to the parent document's `item_activity`; extending item-stats types to video extracts is out of scope. The `DocumentViewer`'s existing reading-session tracker may still record genuine source-video reading time while the segment plays; that is a separate reader interaction and is not part of the rating transaction. The rating/action tests snapshot scheduling fields around the mutation and assert no parent activity row is created by the rating call.

### D9. Playback uses the source player with an explicit segment

Add `focusedVideoExtractId?: string` to `DocumentViewer` and `DocumentViewerWrapper`. On document load, fetch the extract, verify `extract.document_id === currentDocument.id`, and pass:

- `initialSeekTime = extract.start_time`
- `initialEndTime = extract.end_time`
- `armedExtract = extract`
- `autoPlayOnOpen = true` when a segment was explicitly opened

`LocalVideoPlayer` gains `initialSeekTime`, `initialEndTime`, `autoPlayOnOpen`, and `armedExtract`. Its saved resume position is ignored when an explicit segment is present; the segment start wins. It sets `activeExtractStartTime/EndTime` so the existing bounded/loop playback logic applies, and calls `attemptPlay` after metadata is ready. It calls `cancelExtractPlayback()` on media element error and on source-resolution failure. `YouTubeViewer` gains `initialEndTime` and `armedExtract`; `initialSeekTime` and `autoPlayOnOpen` already exist. Its existing poll/seek effect enforces the end bound.

`useVideoExtractPlayback(documentId, armedExtract?)`:

- Arming is intent; no seen write on selection.
- `confirm(seconds)` requires a pending extract for this document and `start - 0.25 <= seconds <= end`.
- After `markVideoExtractSeen` succeeds, patch the video-extract query cache and invalidate; do not dispatch ad-hoc window events.
- A failed mark keeps pending or reports a recoverable error; a failed playback never calls `markVideoExtractSeen`.
- Changing documents or opening a different extract cancels the previous pending intent.

When a focused extract resolves, `DocumentViewer` renders a compact segment banner above the media showing the extract title and time range, with a "View full video" action that clears the focus and leaves the player on the full source without a queue mutation. It renders a recoverable error banner when the focused extract cannot be resolved or belongs to another document. The source video still opens, but no seek/seen action occurs. Existing player error surfaces handle missing files/YouTube failures.

When opened from the Queue, pass `hideRatingOrbs: true` so the parent video's document rating controls cannot be used as a substitute. The source panel's extract rating controls and Scroll Mode's overlay remain the rating surfaces.

### D10. Cache invalidation uses React Query plus the queue store

`@tanstack/react-query` is already installed and the app wraps the tree in `QueryClientProvider` (`src/main.tsx`). Use it rather than adding a new global store or more window events.

New/extended hooks:

- `useVideoExtractList(documentId)` → `useQuery(["video-extracts", "document", documentId])`.
- `useAllVideoExtracts(collectionId)` → `["video-extracts", "all", collectionId ?? "default"]`.
- `useVideoExtractReviewCandidates(documentId?, now?)` → `["video-extracts", "candidates", documentId ?? "all"]`.
- `useCreateVideoExtract`, `useDeleteVideoExtract`, `useUpdateVideoExtract`, `useSetVideoExtractQueueMembership`, `usePostponeVideoExtract` mutations.

On mutation success:

1. `await queryClient.cancelQueries({ queryKey: ["video-extracts"] })`.
2. Apply the canonical returned record to the affected `byDocument`/`all` caches with `setQueryData` (append/update/remove). For delete, remove by ID.
3. `invalidateQueries({ queryKey: ["video-extracts"] })` for server reconciliation.
4. If the queue has completed its first load, call `useQueueStore.getState().reloadForCurrentMode()`; otherwise increment the store's query revision so the next load starts after the mutation.

Add a `queryRevision` to `queueStore` (or include a mutation revision in `dedupeLoad` keys) so `reloadForCurrentMode` cannot reuse an in-flight pre-mutation load. The old load's eventual response must be ignored or discarded by the newer generation.

Remove the `video-extract-reviewed` and `video-extract-seen` window events from `useVideoExtractReview`, `useVideoExtractList`, and `useVideoExtractPlayback`. Query cache updates are the single client source of truth; server rows remain the durable source of truth.

The creation dialog calls the mutation. `onCreate` remains only for closing/toasting/navigation. `VideoExtractsList` and `ExtractsTab` observe the cache; no viewer-local refresh flag is needed.

**Rejected:** a bespoke video-extract Zustand store (duplicates query cache); scattered `window.dispatchEvent` events (already caused the list to miss creations); full app reload after creation.

### D11. Discoverability uses the existing Extracts information architecture

Do not insert video extracts into `documents`. Extend the existing surfaces:

- **Source video panel:** already renders `VideoExtractsList`; query cache makes it immediate.
- **Per-document Extracts:** `DocumentExtractsTab` adds a `Video extracts` section below the text extract list, using the same `documentId`.
- **Library-wide Extracts:** `ExtractsTab` adds a `Video extracts` section grouped by source video, using `useAllVideoExtracts(activeCollectionId)`. It keeps the existing text-extract groups and error/empty states.
- **Documents grid:** unchanged. The "View extracts" context action now shows both text and video extracts for the selected document.

`VideoExtractCard` gains a queue-status line, an add/remove queue control, and — for a queued row scheduled after the cutoff — an explicit "Review now" control that calls the membership command with `initial_review_date = now`. The library section reuses the card with `onPlay`, `onDelete`, `onToggleQueue`, and `onReviewNow`. Play opens a `document-viewer` tab with `focusedVideoExtractId`. Delete confirms and invalidates queries. Title/notes/tag editing is out of scope for this change; the card's existing optional `onEdit` hook may be wired later without changing this contract.

If the source document is archived, the row remains with an "Archived source" marker and disabled queue/play actions; queue queries exclude it. If the source row is missing (browser soft delete), the row is filtered from live lists rather than rendered as an orphan.

### D12. Keep the source-panel review mode, but bound it by the canonical candidates

Do not claim the Queue is fixed because `DueVideoExtractsReview` passes tests. Keep the component only as an explicit source-panel mode:

- `VideoExtractsList` shows a "Review ready (N)" control when the canonical candidate query returns eligible extracts.
- The section uses the same `useVideoExtractReview` controller and the same candidate set. It does not re-fetch all extracts and apply `review_count === 0` client-side.
- It respects the existing `reviewsPerDay` for reviewed due items and `newCardsPerDay` for unreviewed queued items.
- It passes `onPlay` to the card so the user can seek the segment in the player behind the panel.
- When the list has no eligible candidates, the control is absent (not a dead empty section).

This preserves the prior change's "dedicated review session" requirement without creating a second queue or a second rating transaction.

### D13. Browser parity uses the same policy, not a copied UI heuristic

Add to `browserVideoExtracts.ts`/`browser-backend.ts`:

- `get_video_extracts` (existing), `get_all_video_extracts`, `get_video_extract_review_candidates`.
- `create_video_extract` with the shared creation intent rule, parent file-type check, collection copy, and trimmed title.
- `set_video_extract_queue_membership`.
- `postpone_video_extract`.
- `rate_video_extract` (existing; preserve new fields when spreading).
- `mark_video_extract_seen` (existing; preserve new fields).

`browser-backend.get_queue` and `get_due_queue_items` add the same video candidate pass. Use the parent document for the active/collection check. Map the same queue DTO fields (`entity_title`, `start_time`, `end_time`, `entity_id`, `reps`, stability/difficulty).

IndexedDB version advances from 8 to 9. In `onupgradeneeded`, normalize existing `video_extracts` rows: infer `queue_status` from the presence of `next_review_date`, and copy `collection_id` from the parent document (default if absent). The store schema itself does not change. Reads also apply the same inference so an interrupted upgrade cannot hide rows.

Browser `deleteDocument` remains a soft delete; video children are filtered from queue/library reads when the parent is `_deleted`. Do not hard-delete receipts.

### D14. Migration and archive compatibility

Native migration (next number after the current head; the inspected head is 135, so this is expected to be 136):

```sql
ALTER TABLE video_extracts ADD COLUMN queue_status TEXT NOT NULL DEFAULT 'not_queued'
  CHECK (queue_status IN ('not_queued', 'queued'));
ALTER TABLE video_extracts ADD COLUMN collection_id TEXT NOT NULL
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE video_extracts
SET collection_id = COALESCE(
  (SELECT d.collection_id FROM documents d WHERE d.id = video_extracts.document_id),
  '00000000-0000-0000-0000-000000000001'
);
UPDATE video_extracts SET queue_status = 'queued' WHERE next_review_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_extracts_queue_eligibility
  ON video_extracts(queue_status, next_review_date);
```

Do not update `next_review_date`, `review_count`, `memory_state`, seen fields, or receipts. Do not convert today's/old tomorrow dates. If SQLite rejects `ADD COLUMN ... CHECK` in the implementation environment, use an additive table rebuild with the same final schema and copy every column; never drop rows.

Archive format:

- `VideoExtractLifecycleArchive` gains a Rust `format_version: u32` field with serde default 0; because the archive struct is `rename_all = "camelCase"`, the wire/TypeScript field is `formatVersion`. New exports set 2.
- On restore of a version <2 archive, clone each extract and set `queue_status = next_review_date.is_some() ? queued : not_queued`; resolve `collection_id` from the archived parent (or default). Then insert.
- Browser `validateVideoLifecycleArchive` accepts the optional version and applies the same normalization before writing.
- New archives carry both fields and round-trip exactly.
- `get_video_extract_lifecycle` includes the new fields.

Rollback: the columns are additive. An older binary ignores them and keeps using the old date semantics. Older builds may show NULL-date unqueued rows as new; this limitation must be stated in release notes, not hidden. Do not delete the columns or events on downgrade.

### D15. Validation and error behavior

- Native and browser creation errors are specific: source missing, source not video, title required, end after start, duration limit, future-date invalid, not-queued-with-date invalid.
- The UI displays server/browser error text in the dialog; no success toast on failure.
- Membership, postpone, delete, rating, and seen commands return the canonical row or a typed error. The UI keeps recoverable state on failure.
- A failed queue reload does not roll back a committed mutation; the canonical mutation result is already in cache and an error toast asks the user to retry the refresh.
- `mark_video_extract_seen` remains idempotent for first_seen and updates last_seen.

## Queue producer checklist

| Producer | Required change |
|---|---|
| `get_queue` / `get_queued_items` | Use the single candidate method; include `video-extract` rows once. |
| `get_due_queue_items` | Same; cutoff = end of UTC day; no due/new chain. |
| `get_startup_queue_preview` | Candidate rows participate in the bounded preview; don't treat truncation as ineligibility. |
| `get_next_queue_item` / `get_queue_items` | Operate on the same queue; no separate video query. |
| `get_due_documents_only` | Unchanged: documents only. |
| `get_queue_with_playlist_intersperse` | Base queue already includes video rows; interspersion must not duplicate/drop them. |
| `due_candidate_pool` | Same candidate set. |
| Schedule / `get_workload_forecast_grouped` | Count only queued, active-parent rows. |
| Auto-postpone discovery | Count only queued rows; keep the existing "unsupported video extract" skip. |
| Browser `get_queue` / `get_due_queue_items` | Add the video pass with the same predicate and collection/parent filters. |
| Browser `get_auto_postpone_candidates` | Include queued video rows as unsupported candidates, or keep their existing explicit skip; do not count unqueued rows. |
| Queue stats | Unchanged; document the existing learning-item-only limitation. |
| Custom/saved queues | Store queue item IDs; video IDs remain stable and are filtered by `queue_status` on refresh. |

## Rating and session sequence

1. User rates in Scroll Mode.
2. `handleRating` sees `type === "video-extract"`.
3. `useVideoExtractReview.rate(extractId, rating)` gets/creates one operation ID, marks pending, calls `rate_video_extract`.
4. Repository transaction writes one receipt, updates only the extract, commits.
5. Controller updates/invalidates video-extract queries and returns the result.
6. Scroll Mode adds the ID to `ratedVideoExtractIds`, increments the session count, calls `advanceAfterRemoval(extractId)` once.
7. `advanceAfterRemoval` records only the extract ID (not the parent document ID), so sibling segments and the source video remain present in the session.
8. On failure no step 6/7 occurs; the intent remains retryable with the same operation ID.

## Playback and seen sequence

1. Queue row opens a `document-viewer` tab or embedded viewer with `focusedVideoExtractId`.
2. Viewer loads the source document and the extract; verifies the parent relationship.
3. Player receives `initialSeekTime`, `initialEndTime`, `armedExtract`, and autoplay.
4. Player seeks and attempts playback. Selection alone does not write seen.
5. On playing media inside the segment, `useVideoExtractPlayback.confirm` calls `mark_video_extract_seen`.
6. Cache patches/invalidates; the list shows Seen · Not reviewed.
7. Media/source failure cancels pending; no seen/review write.

## Risks / Trade-offs

- **Legacy intent uncertainty** → Date presence is the only reliable historical signal; dated rows stay queued with their dates, NULL rows stay saved but unqueued. The library view gives users a visible recovery path with membership and "Review now" controls.
- **Old bug-created tomorrow dates remain tomorrow** → Preserve them; do not mass-reschedule. The UI shows the scheduled date and offers immediate eligibility.
- **Queue refresh races** → Query cancellation/canonical cache writes plus a queue-store query revision; tests use deferred old loads.
- **Identity regressions** → One `video-extract` variant, type-first dispatch, and a regression test that snapshots the parent before/after rating and actions.
- **Browser upgrade** → Lazy read normalization plus an explicit v9 cursor backfill; old archives infer membership.
- **Autoplay blocked** → Segment is seeked and ready; Seen requires actual playing media. The user can press play.
- **Extra queue fields** → Three small optional fields per video row; no benchmark change expected. Run the existing queue benchmark gate if the shared queue payload is measured.
- **Two review surfaces** → Source-panel session is explicitly bounded by the same candidate policy and controller; it is not a second queue.
- **Stats mismatch** → `get_queue_stats` remains cross-type incomplete; changing it is out of scope and would affect documents/text extracts too.

## Migration Plan

1. Capture native SQLite and browser IndexedDB fixtures containing dated-unreviewed, dated-reviewed, NULL-unreviewed, NULL-reviewed, future-dated, archived-parent, and receipt rows; record every field before upgrade.
2. Add migration 136 (or the next available number) additively; verify the CHECK constraint and correlated collection backfill on a scratch database.
3. Deploy model/repository/command/queue/MCP changes; keep old command argument compatibility via optional fields.
4. Update the browser adapter and bump IndexedDB to 9; verify the upgrade cursor and lazy read fallback.
5. Extend archive export/import with `formatVersion = 2` on the wire (`format_version` in Rust) and legacy normalization.
6. Rehearse full-database backup/restore and collection archive round trips. Assert no fabricated events and no changed dates/counters.
7. Rehearse rollback with an older binary: data remains; NULL-date unqueued rows may appear as new in the old client. Document, do not delete.
8. Only then enable the UI creation/membership controls and run the end-to-end workflow.

## Open Questions

None. The core policies (membership semantics, legacy classification, date boundaries, identity, rating ownership, cache ownership, and IA placement) are decided above. Platform execution availability (Windows/macOS/Android/iOS) is a verification limitation, not a design question.
