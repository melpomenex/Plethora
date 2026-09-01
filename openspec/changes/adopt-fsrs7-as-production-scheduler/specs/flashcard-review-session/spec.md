## MODIFIED Requirements

### Requirement: Flashcard-only review session
The review session's data model and UI SHALL NOT carry a document variant. Specifically: the `ReviewDocumentItem` type, the `ReviewDocumentCard` component, the document interleaving in `loadQueue`, the document branch in `submitRating` (the `rateDocument` call), and the auto-reveal-answer behavior keyed on a document being current SHALL be removed. Every card in a session SHALL be a flashcard routed through the FSRS-7 scheduler.

#### Scenario: Flashcard rating
- **WHEN** user rates a flashcard in review session
- **THEN** the rating is routed to FSRS-7 (`submitReview` with four-button rating 1–4)

#### Scenario: No legacy scheduler in session
- **WHEN** user reviews any card in production
- **THEN** Precision, Adaptive, or Classic schedulers are not invoked
