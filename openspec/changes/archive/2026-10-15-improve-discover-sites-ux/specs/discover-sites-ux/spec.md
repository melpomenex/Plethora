## ADDED Requirements

### Requirement: View Mode Toggle (Grid vs. List)
The system SHALL support toggling the display of discovered sites between a rich Grid view and a compact List view.

#### Scenario: Toggle view mode
- **WHEN** the user toggles the view mode from Grid to List
- **THEN** the discovered sites layout SHALL change to a compact list where each item is rendered in a single horizontal row showing the title, domain, category badge, feed availability, and quick actions.

### Requirement: Individual Checkbox and Bulk Selection
The system SHALL allow users to select multiple discovered sites using checkboxes on individual items and a master checkbox for bulk actions.

#### Scenario: Select multiple items
- **WHEN** the user clicks checkboxes on multiple discovered sites
- **THEN** those items SHALL enter a selected state, and a floating Bulk Actions Bar SHALL appear at the bottom of the viewport showing the count of selected items and action buttons.

### Requirement: Floating Bulk Actions Bar
The system SHALL display a floating Bulk Actions Bar at the bottom of the page when one or more items are selected, containing buttons to subscribe to or dismiss all selected items at once.

#### Scenario: Bulk subscribe selected items
- **WHEN** the user clicks the "Subscribe to Selected" button in the Bulk Actions Bar
- **THEN** the system SHALL subscribe to all selected feeds in the background, update their status to "Subscribed", clear the selection, and hide the Bulk Actions Bar.

### Requirement: Category-Level Quick Subscribe
The system SHALL provide a button to subscribe to all discoverable feeds in the currently selected category or the main feed groups with one click.

#### Scenario: Quick subscribe to all category feeds
- **WHEN** the user clicks the "Subscribe to All" button next to a category header or title
- **THEN** the system SHALL subscribe the user to all unsubscribed feeds in that category sequentially and update their statuses to "Subscribed".

### Requirement: Hide Subscribed Filter Toggle
The system SHALL provide a filter option to show/hide feeds to which the user has already subscribed.

#### Scenario: Toggle Hide Subscribed filter
- **WHEN** the user enables the "Hide Subscribed" filter
- **THEN** all sites that the user has already subscribed to SHALL be hidden from the visible list.
