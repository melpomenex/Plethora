## ADDED Requirements

### Requirement: Dashboard presents a daily focus action
The system SHALL present a primary next action on the dashboard based on the user’s current work state, with its relevant count or context and a direct navigation action.

#### Scenario: Due reviews are available
- **WHEN** one or more review cards are due
- **THEN** the dashboard SHALL present starting review as the primary action and show the due-card count

#### Scenario: No reviews are due but reading can continue
- **WHEN** no review cards are due and a saved reading position is available
- **THEN** the dashboard SHALL present continuing that reading item as the primary action

#### Scenario: No actionable work exists
- **WHEN** the user has no due reviews, no resumable item, and no documents
- **THEN** the dashboard SHALL explain the empty state and provide one direct import or browse action

### Requirement: Dashboard separates action from supporting metrics
The system SHALL visually distinguish the daily action and workload context from secondary lifetime metrics, charts, and category summaries.

#### Scenario: Dashboard data is loaded
- **WHEN** dashboard statistics are available
- **THEN** the daily action SHALL appear before secondary analytical summaries in reading order

#### Scenario: Dashboard data is loading
- **WHEN** dashboard statistics are loading
- **THEN** the dashboard SHALL reserve the primary-action layout with a skeleton or equivalent stable loading treatment
