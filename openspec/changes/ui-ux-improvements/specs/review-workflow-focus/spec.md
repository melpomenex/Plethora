## ADDED Requirements

### Requirement: Review Home emphasizes starting a session
The system SHALL make the action that starts a review session the sole primary action on Review Home and SHALL show the relevant due count and estimated session context beside it.

#### Scenario: Review items are due
- **WHEN** Review Home has loaded due items
- **THEN** the start-review action SHALL be visually more prominent than deck, import, authoring, refresh, and manager actions

#### Scenario: No review items are due
- **WHEN** Review Home has no due items
- **THEN** the primary area SHALL explain that the user is caught up and offer a relevant next action without implying a review can start

### Requirement: Review setup actions are progressively disclosed
The system SHALL keep deck management, deck import, card creation, and refresh available through labeled secondary controls that are reachable by keyboard and touch.

#### Scenario: User opens review setup actions
- **WHEN** the user activates the review setup control
- **THEN** the system SHALL show the available setup actions with text labels and preserve their existing behavior

#### Scenario: Keyboard user navigates setup actions
- **WHEN** focus enters the review setup control
- **THEN** each exposed action SHALL be reachable and operable without a pointer
