# listening-session-inbox Specification

## Purpose
Specifies the deferred review workflow for hands-free listening sessions ("Remember now, organize later"), batch triage UI, and daily listening analytics aggregation.

## ADDED Requirements

### Requirement: Deferred Review Session Recording
The system SHALL aggregate all hands-free extracts, bookmarks, interesting marks, and confusing marks captured during a continuous listening period into a unified `ListeningSession` record.

#### Scenario: Session items collected while listening
- **WHEN** user listens to an Audio Edition for 40 minutes and saves 3 extracts and 1 confusing marker
- **THEN** the system SHALL create an active `ListeningSession` containing all 4 items with their timestamps, source text, and marker types

### Requirement: Listening Session Inbox Review Interface
The system SHALL surface a prominent "Review Listening Session" notice or shelf badge when the user returns to the app after a listening session containing unreviewed items.

#### Scenario: User opens app after commute
- **WHEN** user opens Plethora after concluding a listening session
- **THEN** the system SHALL present the Listening Session Inbox displaying each captured passage with source context and one-click triage buttons

### Requirement: Rapid Inbox Item Triage
The system SHALL provide rapid triage actions for each item in the session inbox:
- Keep Extract: Saves the item as a permanent library extract
- Add Note: Attaches an incremental annotation to the extract
- Create Flashcard: Opens Flashcard Studio for instant card creation
- Ask Plethora: Sends the passage to Document Q&A for explanation
- Discard: Removes the unneeded item from the inbox.

#### Scenario: Confusing passage explained from inbox
- **WHEN** user clicks "Explain this" on a confusing marker in the inbox
- **THEN** the system SHALL send the passage to Document Q&A with an explanation prompt and allow saving the resulting insight as a note or flashcard

### Requirement: Daily Listening Analytics Aggregation
The system SHALL record cumulative listening time, chapters finished, and extracts captured into daily study statistics, integrating with Plethora's existing reading stats and workload calendar.

#### Scenario: Listening time counted in daily stats
- **WHEN** a 35-minute audio listening session concludes
- **THEN** the system SHALL add 35 minutes to the user's daily audio study stats in `DailyReadingStats`
