## MODIFIED Requirements

### Requirement: Document Review and Navigation
The system SHALL support rating documents during reading, which triggers rescheduling and navigation. The inline rating-orb affordance (Again / Hard / Good / Easy / Dismiss) SHALL be presented only when the document was opened from a queue-review context; it SHALL be hidden when the document was opened from the Documents (library) view, even if that document is also present in the queue.

#### Scenario: User rates a document after reading from the Queue
- **Given** the user is viewing a document opened from the Queue
- **And** the document is in the queue
- **When** the user selects a rating (Again, Hard, Good, Easy) via the `HoverRatingControls` or keyboard shortcuts
- **Then** the application should submit the rating to the backend with the time spent
- **And** the backend should reschedule the document using FSRS
- **And** the application should automatically navigate to the next document in the queue

#### Scenario: Document opened from the Documents view hides rating orbs
- **Given** a document is present in the queue
- **And** the user opens that document from the Documents (library) view
- **When** the document renders in the reader
- **Then** the inline rating orbs (Again / Hard / Good / Easy / Dismiss) SHALL NOT be displayed
- **And** the application SHALL NOT trigger queue "advance to next item" behavior from this view

#### Scenario: Document opened from the Queue shows rating orbs
- **Given** a document is present in the queue
- **And** the user opens that document from the Queue view (including via queue prev/next navigation)
- **When** the document renders in the reader
- **Then** the inline rating orbs SHALL be displayed (subject to existing gates such as document type and view mode)

## ADDED Requirements

### Requirement: Rating Orb Origin Awareness
The document-viewer tab SHALL carry an open-origin signal indicating whether the document was opened from the library/Documents context or from the queue-review context. The viewer SHALL use this signal, together with existing gates, to decide whether to render the inline rating-orb affordance.

#### Scenario: Origin is carried when opening from Documents
- **WHEN** the user opens a document from the Documents view
- **THEN** the resulting document-viewer tab SHALL be marked as opened from the library/documents context

#### Scenario: Origin is carried when opening from the Queue
- **WHEN** the user opens a document from the Queue view
- **THEN** the resulting document-viewer tab SHALL be marked as opened from the queue context

#### Scenario: Origin signal is forwarded to the viewer
- **WHEN** a document-viewer tab created with an origin signal is rendered through the viewer wrapper
- **THEN** the origin signal (or the derived hide-rating-orbs flag) SHALL reach the underlying viewer component and SHALL NOT be dropped
