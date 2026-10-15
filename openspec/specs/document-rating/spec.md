# document-rating Specification

## Purpose
TBD - created by archiving change review-document-reading. Update Purpose after archive.

## Requirements

### Requirement: Document Review and Navigation
The system SHALL support rating documents during reading, which triggers rescheduling, immediate tactile haptic feedback, and navigation.

#### Scenario: User rates a document after reading
- **WHEN** the user selects a rating (Again, Hard, Good, Easy) via the `HoverRatingControls`, floating Rating Orbs, or keyboard shortcuts
- **THEN** the application should submit the rating to the backend with the time spent
- **AND** the application should emit grade-specific tactile haptic feedback through the device's vibration motors
- **AND** the backend should reschedule the document using FSRS
- **AND** the application should automatically navigate to the next document in the queue

### Requirement: Persistence of Scheduling Data
Document scheduling data MUST be persisted to the database. When a document has an `interval_modifier` other than 1.0, the computed FSRS interval SHALL be multiplied by the modifier before persisting.

#### Scenario: Document scheduling persistence
- **Given** a document is rated
- **When** the rating is processed
- **Then** the document's `next_reading_date`, `stability`, `difficulty`, `reps`, and `total_time_spent` should be updated in the database
- **And** the new schedule should be reflected in the Queue view

#### Scenario: Document with interval modifier
- **WHEN** a document with `interval_modifier = 2.0` is rated and FSRS computes a 10-day interval
- **THEN** the persisted `next_reading_date` SHALL be 20 days from now (10 * 2.0)

### Requirement: Tracking Reading Time
The system MUST track the time spent reading a document for accurate scheduling metrics.

#### Scenario: Time tracking
- **Given** the user opens a document
- **When** the user rates the document
- **Then** the time spent viewing the document since it was opened (or last rated) should be recorded and added to the document's `total_time_spent`

### Requirement: Rating-triggered relevance propagation
The system SHALL propagate relevance score updates to related items when a document is rated, ensuring the recommendation model reflects the latest user preferences.

#### Scenario: Good/Easy rating boosts similar items
- **WHEN** a user rates a document as Good (3) or Easy (4)
- **THEN** the system SHALL incrementally boost the relevance score of items sharing tags with the rated document
- **AND** the boost SHALL be proportional to the tag overlap (Jaccard similarity)

#### Scenario: Again/Hard rating reduces similar items
- **WHEN** a user rates a document as Again (1) or Hard (2)
- **THEN** the system SHALL incrementally reduce the relevance score of items sharing tags with the rated document
- **AND** the reduction SHALL be proportional to the tag overlap (Jaccard similarity)

#### Scenario: Rating updates tag affinity cache
- **WHEN** a user rates any item
- **THEN** the system SHALL update the in-memory tag affinity cache with the new rating
- **AND** the cache SHALL reflect the last 100 ratings for tag frequency computation

### Requirement: Algorithm-aware preview intervals
The review store SHALL pass the card's effective algorithm (per-card `algorithm_type` when set, falling back to the global `settings.learning.algorithm`) to the `previewReviewIntervals` API call, so that transparency panel and rating button intervals match the algorithm actually scheduling the card.

#### Scenario: Precision card previewed with FSRS global default
- **WHEN** the user's global algorithm is set to "fsrs" and the current card has `algorithm_type: "precision"`
- **THEN** `loadPreviewIntervals` SHALL pass `"precision"` to `previewReviewIntervals`
- **AND** the returned intervals SHALL be computed by the Precision algorithm

#### Scenario: Adaptive card previewed with FSRS global default
- **WHEN** the user's global algorithm is set to "fsrs" and the current card has `algorithm_type: "adaptive"`
- **THEN** `loadPreviewIntervals` SHALL pass `"adaptive"` to `previewReviewIntervals`
- **AND** the returned intervals SHALL be computed by the Adaptive algorithm

#### Scenario: Card with no per-card algorithm uses global default
- **WHEN** the current card has `algorithm_type: null` and the global setting is "fsrs"
- **THEN** `loadPreviewIntervals` SHALL pass `"fsrs"` to `previewReviewIntervals`

### Requirement: Relocatable and Persisted Rating Controls
The system SHALL support relocatable rating controls in the queue view, allowing the user to position the rating container on any edge of the viewport (top, bottom, left, right), snap it, and persist this setting across sessions.

#### Scenario: User drags the rating container to snap to an edge
- **WHEN** the user drags the rating panel and releases it near an edge of the viewport
- **THEN** the system SHALL calculate the nearest edge (top, bottom, left, or right) and snap the panel to it
- **AND** the system SHALL dynamically update the layout (vertical stack for left/right edges, horizontal row for top/bottom edges)
- **AND** the system SHALL save the new position to settings

#### Scenario: User changes rating controls position using directional UI controls
- **WHEN** the user selects a different position (top, bottom, left, or right) from the placement buttons on the panel or settings
- **THEN** the system SHALL immediately reposition the panel to that edge and update the layout and settings

#### Scenario: Rating controls position is persisted across sessions
- **WHEN** the user opens the queue view in a new session
- **THEN** the rating controls SHALL be initialized at the last saved edge position
