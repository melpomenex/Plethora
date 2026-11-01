## ADDED Requirements

### Requirement: Video extracts are discoverable in the existing Extracts surfaces

The library-wide Extracts tab SHALL list video extracts from all source videos in the active collection, grouped by source video and ordered most recently created first within each group. Each entry SHALL show the extract title, time range, source video title, lifecycle status (New / Seen · Not reviewed / Reviewed), and queue status (Not in queue / Queued · due now / Queued · scheduled date). The per-document Extracts view opened from a video document SHALL show that video's video extracts in addition to its text extracts.

Video extracts MUST NOT be inserted into the root Documents collection as duplicate standalone documents merely to make them visible. The existing Documents grid, document counts, and text-extract counts SHALL retain their current meaning.

Each video extract entry SHALL offer: play/open the source segment, add to or remove from the queue, delete with confirmation, and — for a queued row scheduled after the current cutoff — an explicit "Review now" action that makes it eligible immediately without changing its history. Title/notes/tag editing is not added by this change; any future edit control MUST update the same canonical row and every open surface. Entries whose source video is archived or missing SHALL be shown with an explicit source-state indication where the row still exists, and queue-changing actions SHALL be disabled for an archived source while the extract remains readable.

Creating, editing, rating, deleting, or changing membership SHALL update all open Extracts surfaces without requiring a restart. A late list response MUST NOT overwrite a newer committed mutation.

#### Scenario: Library-wide video extracts
- **WHEN** the Extracts tab loads for a collection containing video extracts
- **THEN** it shows a video-extracts section grouped by source video
- **AND** each row shows the title, time range, source, lifecycle status, and queue status

#### Scenario: Per-document extracts
- **WHEN** the user opens "View extracts" for a video document
- **THEN** the view lists that video's video extracts
- **AND** text extracts from the same document remain available in their existing section

#### Scenario: No root document duplication
- **WHEN** a video extract is created
- **THEN** no new root Document row is created
- **AND** the Documents grid continues to list only the source video document

#### Scenario: Create while viewing the source
- **WHEN** the user creates an extract from the video viewer
- **THEN** it appears immediately in the source video's Extracts view
- **AND** it appears immediately in the library-wide Extracts view

#### Scenario: Review a future-scheduled extract now
- **WHEN** a queued video extract is scheduled after the current cutoff and the user chooses "Review now"
- **THEN** its next review date is set to the current instant
- **AND** its memory, counts, seen timestamps, collection, and receipts are unchanged
- **AND** it becomes eligible in the queue immediately

#### Scenario: Archived source
- **WHEN** a video extract's source is archived
- **THEN** the row remains discoverable with an archived-source indication
- **AND** its play and queue actions explain why they are unavailable
- **AND** the extract is not returned as a live queue candidate

#### Scenario: Empty and failure states
- **WHEN** the collection has no video extracts
- **THEN** the video-extracts section shows an explanatory empty state rather than a blank area
- **WHEN** loading video extracts fails
- **THEN** a retry control is shown and the text-extract section remains usable
