## ADDED Requirements

### Requirement: Scroll Mode Launch in Queue Order
The system SHALL support launching Scroll Mode using the exact sequential order and filtering of the active Reading Queue list items.

#### Scenario: User launches Scroll Mode from Queue header
- **WHEN** the user clicks the "Scroll Mode" button in the Queue header
- **THEN** the system SHALL open a Scroll Mode session populated with the visible items of the Reading Queue in their exact displayed sequence without applying variety mixing reordering.

#### Scenario: User launches Optimal Session
- **WHEN** the user clicks the "Start Optimal Session" button in the Queue header
- **THEN** the system SHALL open a Scroll Mode session using the FSRS and variety-mixed optimal session ordering.

### Requirement: Distinct UX Labeling for Scroll Mode
The system SHALL provide distinct visual subtext, labels, and tooltips for the "Scroll Mode" button to clearly differentiate it from "Start Optimal Session".

#### Scenario: Hovering or viewing Scroll Mode button in Queue header
- **WHEN** the user views or hovers over the "Scroll Mode" button in the Queue header
- **THEN** the interface SHALL display subtext and a tooltip indicating that Scroll Mode follows the exact Queue List order.
