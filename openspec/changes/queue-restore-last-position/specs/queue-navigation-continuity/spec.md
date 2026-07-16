## ADDED Requirements

### Requirement: Queue nav entry point resolves to the most recently active queue-related tab
The system SHALL, when the user activates the "Queue" nav entry point (sidebar action, mobile bottom-nav button, or command palette action), reactivate whichever of the `"queue"` (list) or `"queue-scroll"` (Scroll Mode) tabs was most recently active among currently open tabs, rather than unconditionally opening the `"queue"` list tab.

#### Scenario: User was reading in Scroll Mode, navigates away, then clicks Queue
- **WHEN** a user has an open `"queue-scroll"` tab that was the most recently active tab of the two queue-related types, navigates to a different tab or nav section, and then activates the "Queue" nav entry point
- **THEN** the system reactivates the existing `"queue-scroll"` tab (not a new or existing `"queue"` list tab), and the document/position previously being viewed in Scroll Mode is still shown

#### Scenario: User was on the list view, navigates away, then clicks Queue
- **WHEN** a user has an open `"queue"` list tab that was the most recently active tab of the two queue-related types, navigates away, and then activates the "Queue" nav entry point
- **THEN** the system reactivates the existing `"queue"` list tab

#### Scenario: No queue-related tab is currently open
- **WHEN** neither a `"queue"` nor a `"queue-scroll"` tab is currently open and the user activates the "Queue" nav entry point
- **THEN** the system opens a new `"queue"` list tab, matching existing behavior

#### Scenario: Only Scroll Mode tab is open (list tab was closed)
- **WHEN** a `"queue-scroll"` tab is open but no `"queue"` list tab exists, and the user activates the "Queue" nav entry point
- **THEN** the system reactivates the existing `"queue-scroll"` tab
