## Purpose

Define a complete, locally persisted lifecycle for timestamp-linked video extracts: explicit queue intent, independent queue membership and scheduling, first-class queue identity, segment playback, independent review, reliable discovery, and matching native/browser behavior.

## ADDED Requirements

### Requirement: Creation persists an explicit queue intent

Creating a video extract SHALL validate and persist one canonical record whose queue intent is explicit and durable. The source document MUST exist and MUST be a video-bearing document (local video or YouTube). The title MUST be trimmed and non-empty. The time range MUST be finite, non-negative, strictly increasing, and no longer than 600 seconds. Duplicate titles SHALL be allowed because identity is the extract ID, not the title.

`add_to_queue` SHALL be an explicit input at every producer. Its API default SHALL be false; the creation dialog SHALL default the control to checked and SHALL always send the value. When `add_to_queue` is true and no initial review date is supplied, the extract SHALL be queued and immediately eligible as a new item. When an initial review date is supplied, creation SHALL be queued and SHALL use that date as its first eligibility instant; a date on the current UTC day SHALL mean "eligible now". When `add_to_queue` is false, the extract SHALL be saved as not queued with no scheduled date, regardless of whether an initial date was supplied; supplying both SHALL be rejected.

Creation MUST be atomic: on a deterministic validation or persistence failure no extract row, review event, queue row, or partial UI entry may remain. On success the command SHALL return the canonical persisted record, including `queue_status`, `next_review_date`, `collection_id`, and zero review counters. Creation MUST NOT be silently auto-retried after an uncertain transport result; the dialog SHALL reconcile by refreshing the source list so a committed row is visible and a second row is not created automatically.

#### Scenario: Add to Queue enabled without a date
- **WHEN** a user creates a valid titled extract with `add_to_queue = true` and no initial date
- **THEN** the persisted row is queued
- **AND** it has no next review date
- **AND** it is eligible as a new item immediately, not tomorrow

#### Scenario: Add to Queue disabled
- **WHEN** a user creates a valid titled extract with `add_to_queue = false`
- **THEN** the extract is persisted with queue status not queued and no next review date
- **AND** it remains visible in its source video's Extracts view and the library-wide Extracts view
- **AND** it is absent from ordinary queue selection

#### Scenario: Explicit future start date
- **WHEN** the user creates a valid extract with `add_to_queue = true` and a future calendar date
- **THEN** the extract is persisted as queued with that date
- **AND** it is excluded from eligibility before that date
- **AND** it becomes eligible on that date without another write

#### Scenario: Invalid source, title, or time range
- **WHEN** creation references a missing/non-video source, an empty title, a negative/zero-length/reversed range, or a duration over 600 seconds
- **THEN** creation fails with a specific error
- **AND** no extract or review history is created

#### Scenario: Duplicate title
- **WHEN** a user creates two extracts in the same video with the same title and different time ranges
- **THEN** both are saved with distinct IDs
- **AND** both remain distinguishable by time range in every listing

#### Scenario: Persistence failure
- **WHEN** the database or IndexedDB write fails after validation
- **THEN** the UI reports the failure
- **AND** no phantom card, queue item, or review event is shown

#### Scenario: Uncertain creation response
- **WHEN** the creation request's response is lost after the backend may have committed
- **THEN** the dialog does not silently submit the same creation again
- **AND** it refreshes the source list and reports the observed state
- **AND** at most one row exists for that attempt

### Requirement: Queue membership and scheduling are independent persisted concepts

A video extract SHALL persist a canonical `queue_status` with exactly two values: `not_queued` and `queued`. Queue membership MUST NOT be inferred from whether a review date exists at read time. `next_review_date` SHALL be interpreted only as follows:

- `not_queued`: never eligible for ordinary queue selection; a retained date is an inert resume hint and MUST NOT make the row eligible.
- `queued` with a date: eligible when the date is at or before the caller's eligibility cutoff, otherwise scheduled for the future.
- `queued` without a date: an unreviewed item that is eligible now as a new item.
- `queued`, reviewed, and without a date: an invalid legacy state; it MUST NOT become eligible and MUST be surfaced as needing a schedule in management views.

Removing an extract from the queue SHALL set `queue_status = not_queued` while preserving the row, title, time range, tags, source link, collection, memory state, review counts, seen timestamps, review dates, and review receipts. Re-adding SHALL set it back to queued without clearing history. If a reviewed extract has no retained date, re-adding SHALL make it eligible immediately; if it has a retained date, that date SHALL be reused unless the user explicitly chooses another date. Toggling membership MUST NOT change FSRS memory, review counts, last review date, seen timestamps, or receipts.

Eligibility SHALL be evaluated against an explicit cutoff supplied by the calling surface. The general queue uses the current instant; the existing "due today" surfaces use the end of the current UTC day, matching the established document/text-extract behavior. Calendar dates are stored as UTC instants.

#### Scenario: Remove from queue
- **WHEN** the user removes a queued, previously reviewed extract from the queue
- **THEN** its queue status becomes not queued
- **AND** all scheduling history and content remain unchanged
- **AND** it no longer appears in any ordinary queue surface

#### Scenario: Re-add a reviewed extract
- **WHEN** the user re-adds an extract that was reviewed before removal
- **THEN** its membership becomes queued
- **AND** its retained due date is reused when present, or it becomes eligible immediately when absent
- **AND** its FSRS state and review history are unchanged

#### Scenario: Reviewed row with no date
- **WHEN** a queued reviewed row has no next review date
- **THEN** it is not presented as due
- **AND** management views identify it as needing a schedule
- **AND** the user can make it eligible without discarding history

#### Scenario: Membership toggle does not grade
- **WHEN** the user toggles queue membership
- **THEN** no review event is written
- **AND** review counts and next review dates do not change except for the explicit eligibility date selected by the user

### Requirement: One eligibility policy feeds every queue producer

There SHALL be one authoritative server-side predicate for video-extract queue eligibility. It MUST require `queue_status = queued`, MUST require that the parent source document is active (not archived or dismissed), MUST exclude reviewed rows without a date, MUST include unreviewed rows without a date, and MUST include rows whose date is at or before the supplied cutoff. It MUST NOT contain a separate "new" query that can overlap the due set.

Every queue producer SHALL consume that same policy: the all-items queue, Due All, startup preview, next-item/page selectors, custom-queue composition, Scroll Mode source rows, DAQE candidate pools, playlist-interspersed queues, collection filters, and schedule/forecast counts. The policy MUST be applied before ordering and presentation limits. An item that is eligible but falls outside the first N displayed rows is a presentation-limit result, not a membership result.

Video extracts SHALL use the row's persisted collection. A non-default collection filter SHALL match only that collection; the default collection SHALL include rows assigned to the default collection and legacy/default-scoped rows. Unreviewed queued video extracts SHALL be classified as new (`is_new_item = true`) and SHALL NOT be duplicated in the due set. Priority presentation SHALL remain unchanged: an existing explicit video-extract priority wins; otherwise the row inherits its parent document's display rank, without mutating the parent's priority or the ranking algorithm.

The existing documents-only "Due Today" mode SHALL remain documents-only. Video extracts become visible in Due All and the reading queue, consistent with text extracts and learning items; this change MUST NOT redefine that mode.

#### Scenario: Newly queued extract is visible
- **WHEN** a user creates an extract with Add to Queue enabled and no future date
- **THEN** exactly one video-extract row is eligible in the all-items and Due All queues
- **AND** it is not duplicated between the new and due classifications

#### Scenario: Future item is excluded until its date
- **WHEN** a queued extract has a next review date after the cutoff
- **THEN** it is absent from eligible queue rows
- **AND** it is present in the schedule/forecast view for that date
- **AND** it becomes eligible at the first evaluation at or after that date

#### Scenario: Not-queued item is absent
- **WHEN** a saved extract has queue status not queued
- **THEN** no queue mode includes it
- **AND** the library-wide and source-document Extracts views still show it

#### Scenario: Collection boundary
- **WHEN** the active collection is not the default and an extract belongs to that collection
- **THEN** it is eligible in that collection's queue
- **WHEN** it belongs to another collection
- **THEN** it is not eligible and does not leak into the filtered queue

#### Scenario: Archived source
- **WHEN** an extract's source video is archived or dismissed
- **THEN** the extract is not returned as a queue candidate
- **AND** it remains discoverable in management views with an archived-source indication

#### Scenario: Presentation limit is not membership
- **WHEN** an eligible extract is not among the first N rows returned by a count-limited queue call
- **THEN** a membership query at the same cutoff still returns it
- **AND** increasing the limit eventually includes it

#### Scenario: Empty eligible set
- **WHEN** a collection has only saved/not-queued or future-scheduled video extracts
- **THEN** the queue returns no video-extract candidates
- **AND** the queue's existing empty state is shown without deleting or hiding the saved extracts

#### Scenario: Priority inheritance
- **WHEN** a video extract has no explicit queue priority
- **THEN** its displayed priority follows the parent document's existing display rank
- **AND** setting or clearing the extract's explicit priority does not change the parent's priority
- **AND** the ranking algorithm's output is otherwise unchanged

### Requirement: Rating an extract from any queue surface changes only the extract

A video extract SHALL retain the queue item type `video-extract` and its extract ID through normalization, rendering, action dispatch, rating, and persistence. The source document ID SHALL remain available only for playback, title, context, and navigation; it MUST NOT substitute for the reviewable entity.

Every rating path — Scroll Mode buttons, keyboard 1–4/0–5 equivalents, mobile gestures, dedicated source-panel review, and any future queue surface — SHALL dispatch to the video-extract rating operation. Rating an extract MUST change only that extract's `memory_state`, `review_count`, `reps`, `last_review_date`, `next_review_date`, and `date_modified`. It MUST NOT change the parent document's scheduling, review count, stability, difficulty, next reading date, last reviewed date, interval modifier, or priority, and MUST NOT add a parent activity/queue-time row. Existing reader-time recording for merely watching the source video is a separate interaction and MUST NOT be attributed to the rating intent.

A rating SHALL commit at most one review receipt and one counter increment per user intent. Reusing an operation ID with the same payload SHALL return the original result; reusing it with a different payload SHALL fail. A failed rating SHALL leave the extract and parent unchanged and SHALL NOT advance the session. Duplicate clicks, key repeats, or retries while the intent is pending SHALL not create a second review.

#### Scenario: Rate through Queue Scroll Mode
- **WHEN** a video extract is the current Scroll Mode item and the user presses Good
- **THEN** exactly one video-extract review event is committed
- **AND** the extract's review count increases by exactly one and its next review date updates
- **AND** the parent document's scheduling fields and review history are unchanged

#### Scenario: Double activation
- **WHEN** the user double-clicks Good or presses the rating key twice while the first request is pending
- **THEN** only one review event and one counter increment exist
- **AND** the session advances once

#### Scenario: Failed rating
- **WHEN** the rating transaction fails
- **THEN** the user sees an error
- **AND** the current extract remains current
- **AND** no review event, counter increment, or parent mutation is committed

#### Scenario: Later legitimate review
- **WHEN** the user rates the same extract again on a later eligible occasion with a new operation ID
- **THEN** exactly one additional review event and increment are committed
- **AND** earlier receipts remain intact

### Requirement: Queue actions target the extract, not its parent

Video-extract queue actions SHALL resolve the extract as the target. Details MUST show the extract's title, time range, memory/schedule, tags, source, and queue status. Postpone SHALL shift only the extract's next review date and preserve its history. Remove from queue SHALL change membership only. Delete SHALL delete only the extract while retaining immutable review receipts. No action reachable from a video-extract row may dismiss, archive, delete, or reschedule the parent video document.

#### Scenario: Details delete
- **WHEN** the user opens Details on a video-extract row and confirms Delete
- **THEN** only the extract is deleted
- **AND** the source video document still exists
- **AND** review receipts for the extract remain readable

#### Scenario: Dismiss or remove
- **WHEN** the user chooses the removal action on a video-extract row
- **THEN** the extract is removed from the queue by changing membership
- **AND** neither the extract nor the parent document is deleted
- **AND** an undo affordance restores membership when available

#### Scenario: Postpone
- **WHEN** the user postpones a queued video extract
- **THEN** its next review date moves by the computed interval
- **AND** its memory state, counts, seen timestamps, and parent document remain unchanged

### Requirement: Opening a queue item plays the intended segment

Opening a video-extract queue item SHALL resolve the source video and the extract, verify that the extract belongs to that source, seek to `start_time`, and preserve `end_time` as a playback bound. This behavior SHALL work for both YouTube and locally imported video using the existing platform players and permissions. The surface SHALL show the extract title and source context and SHALL NOT present the parent document's rating controls as a substitute.

Opening, selecting, or viewing the item alone MUST NOT mark it Seen and MUST NOT count as a successful recall. Seen SHALL be recorded only after the player confirms that playback actually advanced inside the selected segment with media ready. A playback or source-resolution failure MUST leave Seen and review history unchanged and MUST present a recoverable error with retry or return navigation.

#### Scenario: Local segment playback
- **WHEN** the user opens a local-video extract from the Queue
- **THEN** the local player opens the source at the extract start time
- **AND** playback is bounded by the extract end time
- **AND** Seen is persisted only after playback is confirmed

#### Scenario: YouTube segment playback
- **WHEN** the user opens a YouTube extract from the Queue
- **THEN** the embedded player seeks to the segment start
- **AND** the segment end remains the playback bound
- **AND** Seen is persisted only after the player reports playing inside the segment

#### Scenario: Failed playback
- **WHEN** the source file is missing, the YouTube player errors, or autoplay never produces playing media
- **THEN** the extract remains unseen
- **AND** no review event is written
- **AND** the user can retry or navigate back without losing the extract

#### Scenario: Source mismatch
- **WHEN** a queued extract ID resolves to an extract whose source document differs from the queue row's document
- **THEN** the segment is not opened
- **AND** an explicit source error is shown
- **AND** no seen or review state changes

### Requirement: Creation and review are immediately discoverable and reconciled

After a successful creation, the new extract SHALL appear immediately in its source video's Extracts view and in the library-wide Extracts view, with its title, time range, lifecycle status, queue status, and source. If it is queue-eligible, the active queue representation SHALL refresh without requiring an application restart. Reopening the app SHALL load the persisted row exactly once, with no duplicate entry.

A response from a load that started before a newer creation, deletion, rating, or membership change MUST NOT overwrite that newer committed state. Deletion SHALL remove the row from active lists and queue views; rating and seen changes SHALL reconcile to the canonical returned record.

#### Scenario: Create and see immediately
- **WHEN** a user saves a titled extract while the source video is open
- **THEN** the extract appears in the open Extracts view without reopening the video
- **AND** it appears in the library-wide Extracts view
- **AND** it appears once in the Queue when queued and eligible

#### Scenario: Stale list response
- **WHEN** an extract list request is still pending and the user creates, rates, or deletes an extract
- **THEN** the older response is discarded or merged so it cannot remove the new row or restore deleted state

#### Scenario: Delete then reload
- **WHEN** an extract is deleted and the list is refreshed or the app restarts
- **THEN** the deleted extract does not reappear
- **AND** its review receipts remain available as historical evidence

#### Scenario: Restart
- **WHEN** the app restarts after creation, playback, and rating
- **THEN** the extract's title, time range, queue status, seen timestamps, review counts, memory state, and next review date are intact

### Requirement: Native and browser adapters share one video-extract contract

The Tauri/SQLite and browser/IndexedDB adapters SHALL implement the same creation defaults, queue-membership rules, eligibility predicate, date semantics, collection ownership, status derivation, rating identity, and persistence guarantees. A behavior supported by one adapter SHALL be implemented or explicitly reported as unsupported by the other; a supported control MUST NOT silently do nothing or do the opposite.

#### Scenario: Same creation fixture on both adapters
- **WHEN** the same add-to-queue/date fixture is created in native SQLite and browser IndexedDB
- **THEN** both records have the same queue status, eligibility, and date semantics
- **AND** both appear in their respective eligible queue views

#### Scenario: Browser Add to Queue disabled
- **WHEN** the browser adapter creates an extract with `add_to_queue = false`
- **THEN** it is saved but not queued
- **AND** it is absent from browser queue responses

#### Scenario: Browser rating
- **WHEN** a browser user rates an extract from Scroll Mode
- **THEN** the browser adapter updates only the extract
- **AND** the parent document record remains unchanged
- **AND** the operation receipt prevents duplicate increments

### Requirement: Migration and archives preserve user data conservatively

The native schema upgrade SHALL be additive. It MUST add the queue status and collection columns/index without deleting or rewriting review history, receipts, titles, ranges, tags, source links, memory, counts, or known dates. Existing rows with a non-null next review date SHALL be backfilled as queued and SHALL retain that date, including future dates created by the old tomorrow bug. Existing rows with a NULL next review date SHALL be backfilled as not queued, because the old adapters used the date as the de-facto membership signal and NULL rows cannot be proven to be intended queue members. Collections SHALL be backfilled from the parent document, falling back to the default collection.

Collection archives SHALL carry queue status and collection. Older archives that lack these fields SHALL be normalized on restore by inferring membership from the presence of a date and the collection from the source document. Full-database backup/restore SHALL preserve the new columns. No restore or migration may fabricate review events, seen timestamps, or FSRS memory.

#### Scenario: Upgrade matrix
- **WHEN** a database containing dated-unreviewed, dated-reviewed, NULL-unreviewed, and NULL-reviewed extracts is upgraded
- **THEN** dated rows become queued with their dates preserved
- **AND** NULL rows become not queued
- **AND** all counts, memory, seen fields, receipts, and parent links are unchanged

#### Scenario: Old collection archive
- **WHEN** an archive exported before this change is restored
- **THEN** a row with a date is restored as queued
- **AND** a row without a date is restored as not queued
- **AND** its collection is restored from its source document

#### Scenario: New archive round trip
- **WHEN** a lifecycle archive is exported and restored after this change
- **THEN** queue status, collection, dates, seen state, counters, memory, and receipts compare equal

#### Scenario: Rollback without data loss
- **WHEN** an older binary opens a database after the additive migration
- **THEN** the new columns and rows are not deleted
- **AND** the rollback limitation (older clients may interpret NULL-date unqueued rows as new) is documented rather than hidden

### Requirement: Video extracts have explicit collection ownership

Every video extract SHALL have a collection ID copied from its source document at creation, unless the source itself has no collection, in which case the default collection SHALL be used. Reading, listing, queue filtering, archive export, and archive restore SHALL preserve that ownership. A missing legacy collection SHALL be backfilled from the parent; it MUST NOT be guessed from the title, tags, or active collection at read time.

#### Scenario: Create in a non-default collection
- **WHEN** an extract is created in a source video belonging to collection B
- **THEN** it is persisted in collection B
- **AND** it appears in collection B's Extracts view and queue
- **AND** it does not appear in collection A's queue

#### Scenario: Legacy default row
- **WHEN** a legacy extract's parent belongs to the default collection
- **THEN** the backfill assigns the default collection
- **AND** it remains visible under the default collection filter

### Requirement: Source-panel review sessions use the canonical candidate set

If the source video's Extracts panel offers a review session, that session SHALL offer only extracts that are queued and eligible under the canonical policy, plus unreviewed queued extracts allowed by the existing new-item limit. It MUST NOT pull in not-queued extracts merely because they have zero reviews. It SHALL submit through the same shared rating intent controller as Scroll Mode and SHALL NOT mutate the parent document.

#### Scenario: Not-queued extract excluded
- **WHEN** the source panel opens its review session
- **THEN** not-queued extracts are not presented as review candidates
- **AND** they remain visible in the ordinary list with their queue status

#### Scenario: Same intent controller
- **WHEN** the user rates an extract in the source-panel session
- **THEN** exactly one operation is submitted through the shared controller
- **AND** the same replay/idempotency rules apply as in Scroll Mode

#### Scenario: New-item budget
- **WHEN** the existing new-item limit is zero
- **THEN** unreviewed queued extracts are not presented in the source-panel review session
- **AND** they remain visible in the ordinary extract list and eligible in the main queue per that surface's own limits

#### Scenario: Reviewed-item budget
- **WHEN** the existing reviews-per-day limit is N
- **THEN** the source-panel session presents at most N reviewed due extracts
- **AND** the limit does not change their persisted eligibility or dates
