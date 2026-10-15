# flashcard-review-session Specification

Defines what the Review tab's session queue contains and how items are loaded. The Review session is scoped to flashcards / learning items only — reading items (documents) are excluded under all conditions and are instead reviewed in the Queue / Optimal Queue tab.

## Purpose

The Review tab's session is a flashcard-style spaced-repetition experience: one card at a time, rated through the FSRS / SM-x scheduler. Reading items are a distinct, long-form activity that belongs in the Queue. Mixing the two broke the user's mental model and made sessions unpredictable.

## Requirements

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

### Requirement: Optional free-response capture before grading

The review session SHALL present an optional free-response input before revealing the
answer, but only when answer assessment is enabled and an assessment-capable provider is
available. The input SHALL be skippable, and the reveal/grade flow SHALL NOT change when it
is skipped or when the feature is disabled.

#### Scenario: Free-response answered before grading
- **WHEN** answer assessment is enabled and the user types a free-response answer before
  revealing the card answer
- **THEN** the system derives and displays a structured assessment alongside the revealed
  answer, and the grade buttons remain exactly the standard ones

#### Scenario: Feature disabled leaves review unchanged
- **WHEN** answer assessment is disabled or no provider is available
- **THEN** the review session behaves identically to the existing experience with no
  additional input or errors

### Requirement: Scheduling semantics unchanged by assessment

The review session's queue composition, grade submission, and scheduling SHALL remain exactly
as specified by the existing requirements. Free-response assessment SHALL be recorded as
separate metadata linked to the review result and SHALL NOT alter grade routing or scheduler
inputs.

#### Scenario: Grading with assessment present
- **WHEN** the user submits a grade on a card whose answer was assessed
- **THEN** the rating is routed through the flashcard scheduler exactly as without assessment,
  and the assessment is stored separately
