## ADDED Requirements

### Requirement: Review session queue contains only flashcards / learning items

The Review tab's session queue SHALL be populated exclusively from due flashcards / learning items (the `getDueItems` stream). The queue SHALL NOT include reading items (documents) under any condition. Reading-item review SHALL remain available in the Queue / Optimal Queue tab, which is a separate surface.

#### Scenario: Starting a review with only due flashcards

- **WHEN** the user opens the Review tab and starts a session while one or more flashcards are due and zero documents would otherwise have been interleaved
- **THEN** the session queue contains exactly the due flashcards, sorted by due date, and the first card presented is a flashcard

#### Scenario: Starting a review with due flashcards and due documents

- **WHEN** the user starts a review session while both due flashcards and due documents exist
- **THEN** the session queue contains only the due flashcards and SHALL NOT contain any document items
- **AND** no document card is ever presented during the session, even after all due flashcards are exhausted

#### Scenario: Empty review session

- **WHEN** the user starts a review session while zero flashcards are due (regardless of how many documents are due)
- **THEN** the session SHALL be empty and present the no-due-cards state
- **AND** the system SHALL NOT pad the session with documents

### Requirement: Reading items are reviewable only in the Queue

Reading items (documents) SHALL be reviewed through the Queue / Optimal Queue tab (its `reading` mode / "Start Optimal Session"), which remains unchanged. The Review tab SHALL NOT provide an alternate path to review documents.

#### Scenario: User reviews a reading item

- **WHEN** the user wants to review a due reading item
- **THEN** they do so from the Queue tab's reading mode, not from the Review tab's session

#### Scenario: Due documents still surfaced in the Queue

- **WHEN** documents are due and the user opens the Queue tab's reading mode with the `due-today` filter
- **THEN** those documents SHALL appear (the `get_due_documents_only` data path is unaffected by this change)

### Requirement: Document review code paths are removed from the review session

The review session's data model and UI SHALL NOT carry a document variant. Specifically: the `ReviewDocumentItem` type, the `ReviewDocumentCard` component, the document interleaving in `loadQueue`, the document branch in `submitRating` (the `rateDocument` call), and the auto-reveal-answer behavior keyed on a document being current SHALL be removed. Every card in a session SHALL be a flashcard routed through the flashcard scheduler.

#### Scenario: Submitting a rating during a review session

- **WHEN** the user submits a rating for the current card in a review session
- **THEN** the rating is routed to the flashcard scheduler (`submitReview`)
- **AND** the `rateDocument` path is never invoked from the review session

#### Scenario: Answer reveal behavior

- **WHEN** a new card becomes current in a review session
- **THEN** the answer SHALL NOT be auto-revealed based on the card being a document (there are no document cards)
