## Why

Issue #6's video-extract work delivered independent FSRS state, seen timestamps, and retry-safe review receipts, but the product lifecycle is still broken end to end. A user can create a titled extract, save it, and then find it in neither the Queue nor the Documents surfaces. The current "Add to Queue" control actively contradicts its label, and Queue Scroll Mode can rate, dismiss, or delete the **parent video** when the user believes they are acting on the **extract**.

The prior change's tests pass because they exercise the dedicated card component and repository transactions in isolation; they never mount Scroll Mode's `handleRating`, the queue producers, or the library discovery path. A green suite can therefore coexist with the parent-document mutation and invisibility reported here.

This change closes that lifecycle gap without redesigning FSRS, ranking, or cloud sync. It makes extract creation, queue membership, discovery, playback, rating, persistence, and cross-platform behavior one coherent contract.

## What Changes

- Replace the contradictory creation scheduling with an explicit, persisted queue-membership state and an optional initial review date.
- Make "Add to Queue" mean *eligible now* by default, allow an explicit future start date, and keep "not added" saved but outside ordinary queue selection.
- Add conservative migration semantics for existing rows; preserve every title, time range, parent link, memory state, review count, receipt, and collection.
- Make video extracts first-class queue items: one server-side eligibility predicate, no due/new duplication, collection and parent-status filtering, and correct ordering/limit semantics.
- Preserve video-extract identity through queue normalization, Scroll Mode, details, dismissal, postponement, deletion, and rating. Rating an extract SHALL update only that extract.
- Open the actual source segment from the Queue with start/end bounds for both YouTube and local video, and mark Seen only after confirmed playback.
- Refresh the source video's Extracts panel, the library-wide Extracts view, and the Queue immediately after creation/rating/removal; use the existing React Query cache and queue store instead of ad-hoc window events.
- Extend the existing library-wide and per-document Extracts surfaces to include video extracts. Do **not** create duplicate root Document rows.
- Bring the browser/IndexedDB adapter to parity for creation intent, membership, eligibility, queue visibility, rating identity, collection ownership, and archive compatibility.

## Verified root causes

| Class | Finding | Evidence |
|---|---|---|
| **Verified** | Native creation with `add_to_queue=true` sets `next_review_date` to tomorrow. The queue asks only for dated-due rows plus `review_count=0 AND next_review_date IS NULL` rows, so the new extract is in neither set today. | `src-tauri/src/commands/video.rs:664-668`, `src-tauri/src/database/repository.rs:7059-7107` |
| **Verified** | Native creation with `add_to_queue=false` leaves a NULL date and zero reviews, which the "new" query selects. The checkbox therefore behaves opposite to its label for new extracts. | Same anchors |
| **Verified** | The browser adapter uses the opposite default: `addToQueue !== false` produces an immediately due date, and `false` produces no date. Desktop and PWA disagree. | `src/lib/browserVideoExtracts.ts:94-108` |
| **Verified** | `video_extracts` has no `collection_id` column even though the model exposes one. Inserts omit it, reads always fall back to the default collection, and non-default-collection queues filter every video extract out. | `src-tauri/src/database/migrations.rs:1020-1049`, `src-tauri/src/database/video_extract_repository.rs:424-452`, `src-tauri/src/models/video_extract.rs:16-19` |
| **Verified** | Queue Scroll Mode converts a video extract into `type: "document"` with a `videoExtractId`. `handleRating` therefore calls `rateDocumentEngaging(parentDocumentId, ...)`. | `src/pages/QueueScrollPage.tsx:1377-1387`, `:3575-3582` |
| **Verified** | The same conversion makes Details/Delete target the parent document, Dismiss dismiss a parent document, active-time tracking write to the parent document, and `advanceAfterRemoval` mark the parent document ID as removed. | `src/pages/QueueScrollPage.tsx:1880-1898`, `:2208-2219`, `:3727-3748`, `:2840-2845` |
| **Verified** | The browser queue builders (`get_queue`, `get_due_queue_items`) assemble documents, text extracts, and learning items but never video extracts. | `src/lib/browser-backend.ts:2786-3043` |
| **Verified** | Successful creation closes the dialog but neither viewer refreshes its extract list; `VideoExtractsList` loads only on mount/document change. | `src/components/viewer/LocalVideoPlayer.tsx:1086-1090`, `src/components/viewer/YouTubeViewer.tsx:1119-1122`, `src/hooks/useVideoExtractList.ts:13-52` |
| **Verified** | The main Queue opens a video-extract row as the parent video with no segment focus; optimal Scroll Mode never builds video-extract items at all. | `src/components/tabs/QueueTab.tsx:33-75`, `src/pages/QueueScrollPage.tsx:930-940`, `:1545-1575` |
| **Verified** | `DueVideoExtractsReview` has tests but no production call site. Passing tests for that component do not exercise the Queue. | `src/components/video/VideoExtracts.tsx:605-666`, repository-wide search |
| **Verified** | Native creation accepts an empty title and does not verify that the parent is a video; the browser adapter rejects both. | `src-tauri/src/commands/video.rs:633-675`, `src/lib/browserVideoExtracts.ts:99-101` |
| **Verified** | `postpone_item` and the learning-item bulk paths do not understand `video-extract`; postpone/removal either fail as "Item not found" or are absent. | `src-tauri/src/commands/queue_bulk.rs:250-298`, `:1156-1210` |
| **Likely** | Some users created extracts before the seen/receipt work and have NULL-date rows whose original queue intent is unrecoverable. The migration policy below treats only dated rows as queued and leaves NULL-date rows saved but unqueued. | Reproduced via legacy fixture |
| **Design ambiguity** | `next_review_date = NULL` currently means "new and queued", "never scheduled", and "removed" at different call sites. This change resolves it with an explicit membership field rather than overloading the date further. | `repository.rs`, browser builder, UI status logic |

## Suspected defects not reproduced / already correct

- **Dedicated card double submission is already fixed.** `VideoExtractCard` emits an intent and `useVideoExtractReview` owns the single operation; the child no longer calls the backend and then its parent callback. This change reuses that controller and does not rewrite it.
- **The repository's rating transaction is already parent-independent.** `review_video_extract` updates only `video_extracts` and writes one receipt; `rate_document_engaging` does not touch child extracts. The bug is that Scroll Mode calls the latter instead of the former.
- **Seen is already playback-confirmed in the current controller.** `useVideoExtractPlayback.confirm` requires the playing time to be inside the segment; mere selection does not mark Seen. The missing pieces are arming it from the Queue and cancelling it on local media errors.
- **The current due and new video queries do not double-count a row.** Their predicates are disjoint; the defect is that a future-dated new row matches neither. The single candidate predicate is still required to prevent future drift and to add membership.
- **Not-queued extracts were not a persisted state before this change.** The migration must infer intent from date presence; it cannot recover an explicit "unscheduled" choice that was never stored.

## What is already correct and must be preserved

- `first_seen_at` / `last_seen_at` and the New / Seen · Not reviewed / Reviewed labels.
- Independent video-extract memory state, `review_count`, `reps`, `last_review_date`, and `next_review_date` after a rating.
- `rate_video_extract`'s UUID operation receipt, replay/conflict behavior, transaction rollback, and parent-document independence in the repository layer.
- Local backup/restore and collection archive support for video lifecycle rows and receipts.
- The shared `useVideoExtractReview` intent controller and its same-operation retry behavior.
- Document/text-extract/learning-item scheduling and the DAQE/FSRS ranking algorithms.

## Scope and non-goals

**In scope:** creation intent, queue membership, eligibility, discoverability, segment navigation, extract-only rating dispatch, action ownership, cache reconciliation, native/browser parity, additive migration.

**Non-goals:** changing FSRS/FSRS-7, changing urgency ranking or priority mathematics, changing document/text-extract scheduling, cloud sync protocols, creating standalone root Document rows for extracts, global search redesign, bulk move/suspend/lifecycle support for video extracts, and making video extracts participate in auto-postpone execution (the existing explicit "unsupported video extract" skip remains). `get_queue_stats` is already a learning-item-only counter for every type; correcting that broader statistic is out of scope, and this change verifies counts from the actual queue responses instead of silently treating the statistic as all-type truth.

## Capabilities

### New Capabilities

- `video-extract-queue-lifecycle`: explicit creation intent, persisted queue membership, one eligibility policy, extract-preserving queue/rating/action identity, segment playback, discoverability, native/browser parity, and additive migration.

### Modified Capabilities

- `queue-item-type-routing`: video extracts remain video extracts in Queue and Scroll Mode, are governed by the Extracts item-type selection, and open the source segment rather than the parent document.
- `reading-queue-browse`: video-extract action-sheet and details actions operate on the extract (open segment, postpone, remove from queue) and never dismiss/delete the parent.
- `extracts-library-view`: the library-wide and per-document Extracts views include video extracts with source, time range, lifecycle/queue status, playback, and queue membership controls.
- `forecast-query-optimization`: the server-side video-extract queue filter becomes the canonical membership/eligibility predicate instead of the obsolete `review_count = 0 AND next_review_date IS NULL` condition.

## Impact

- **Rust/Tauri:** `models/video_extract.rs`, `database/video_extract_repository.rs`, `database/repository.rs`, `database/migrations.rs`, `commands/video.rs`, `commands/queue.rs`, `commands/queue_bulk.rs`, `commands/algorithm.rs`, `commands/auto_postpone.rs`, `mcp/tools.rs`, `issue6_test_support.rs`.
- **Frontend:** video-extract API/types and query hooks; `VideoExtracts.tsx`; `QueueScrollPage.tsx`; `QueueTab.tsx`; `DocumentViewer`, `DocumentViewerWrapper`, `YouTubeViewer`, `LocalVideoPlayer`; `ExtractsTab`, `DocumentExtractsTab`; queue types/order/action modules; i18n.
- **Browser/PWA:** `browserVideoExtracts.ts`, `browser-backend.ts`, `database.ts` (IndexedDB v9), collection archive validation.
- **Persistence:** additive migration adding `queue_status` and `collection_id` plus an eligibility index; no review history, receipt, memory, title, time range, or source link is rewritten.
- **Risk:** historical NULL-date rows can only be preserved conservatively; they are saved and discoverable, not silently enrolled. Older clients that ignore the new fields may continue to interpret NULL dates by their old rules; no destructive rollback is authorized.
