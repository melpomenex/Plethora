## ADDED Requirements

### Requirement: Core actions use a shared hierarchy
The system SHALL provide reusable primary, secondary, tertiary, and destructive action styles with consistent labels, icon placement, disabled treatment, and focus indicators.

#### Scenario: Core surface renders actions
- **WHEN** dashboard, review, queue, document, toolbar, or mobile navigation actions are rendered
- **THEN** each action SHALL use the shared hierarchy appropriate to its intent

#### Scenario: Primary and destructive actions coexist
- **WHEN** a surface includes a routine primary action and a destructive action
- **THEN** the routine action SHALL remain visually distinct and the destructive action SHALL not be styled as the default path

### Requirement: Essential controls work beyond hover and color
The system SHALL make essential actions visible or available on keyboard focus and touch, and SHALL communicate control state with text or iconography in addition to color.

#### Scenario: Keyboard focus reaches a control
- **WHEN** a user navigates to an interactive core control with a keyboard
- **THEN** a visible focus indicator SHALL identify the focused control

#### Scenario: Status is conveyed in a core surface
- **WHEN** a core surface communicates progress, availability, or a trend
- **THEN** the status SHALL include a non-color cue

### Requirement: Summary surfaces use restrained metric grouping
The system SHALL use cards only for interactive or clearly grouped summaries and SHALL use spacing or dividers for secondary read-only information.

#### Scenario: Dashboard metrics are displayed
- **WHEN** metrics and supporting analysis are rendered on the dashboard
- **THEN** they SHALL not all use equal visual elevation or compete with the daily focus action
