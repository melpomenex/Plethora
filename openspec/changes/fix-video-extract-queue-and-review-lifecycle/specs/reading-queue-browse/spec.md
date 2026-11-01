## ADDED Requirements

### Requirement: Video extract queue actions target the extract

The Reading Queue item action sheet and details surface SHALL treat a `video-extract` item as its own reviewable entity. The available actions SHALL be open segment, postpone (when queued), remove from queue, and delete extract. The action sheet MUST NOT offer a remove action that dismisses or archives the parent video, MUST NOT offer bulk selection until bulk commands support video extracts, and MUST NOT delete the parent document.

Details SHALL show the extract's title, time range, source video title, lifecycle status, queue status, due date, and current FSRS summary. Postpone SHALL change only the extract's next review date. Remove from queue SHALL change only membership and SHALL offer undo when the existing queue feedback pattern supports it. Delete SHALL confirm and delete only the extract; immutable review receipts remain.

After a successful action the sheet SHALL close, the queue SHALL refresh, and the row SHALL leave or move according to the committed eligibility. A failed action SHALL leave the queue usable and SHALL NOT change parent-document state.

#### Scenario: Video extract action sheet
- **WHEN** the action sheet opens for an eligible video extract
- **THEN** it offers open segment, postpone, remove from queue, and details/delete as applicable
- **AND** it does not offer start review, suspend, or bulk selection
- **AND** no action targets the parent video document

#### Scenario: Remove from queue and undo
- **WHEN** the user removes a video extract from the Reading Queue
- **THEN** the extract becomes not queued and leaves the active queue
- **AND** the source video and extract content remain
- **AND** undo restores queue membership without changing review history

#### Scenario: Postpone a video extract
- **WHEN** the user postpones a queued video extract
- **THEN** only its next review date moves
- **AND** the refreshed queue reflects the new position or absence
- **AND** the parent document's schedule is unchanged

#### Scenario: Failed video action
- **WHEN** a video-extract postpone, remove, or delete operation fails
- **THEN** the user sees an error
- **AND** the row remains available
- **AND** no parent-document mutation is performed

#### Scenario: Details delete
- **WHEN** the user confirms Delete in a video extract's Details
- **THEN** only the extract row is deleted
- **AND** the source video document still exists
- **AND** the extract's immutable review receipts remain
