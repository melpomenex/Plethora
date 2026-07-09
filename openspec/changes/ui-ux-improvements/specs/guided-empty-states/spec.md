## ADDED Requirements

### Requirement: Empty core surfaces explain the next step
The system SHALL provide contextual empty states for dashboard, queue, review, and document-library surfaces that explain why the surface is empty and offer one relevant primary action.

#### Scenario: Document library is empty
- **WHEN** the user has no documents in the active collection
- **THEN** the library SHALL explain how to add the first item and provide an import action

#### Scenario: Queue is empty
- **WHEN** the active queue has no items after applying its filters
- **THEN** the queue SHALL explain the current condition and provide an appropriate action such as changing filters, browsing documents, or importing content

#### Scenario: Review is complete
- **WHEN** Review Home has no due items
- **THEN** the empty state SHALL confirm completion and provide a relevant secondary path such as continuing reading or creating cards

### Requirement: Empty-state actions preserve existing workflow behavior
The system SHALL route each empty-state action through the existing import, navigation, or creation flow rather than creating a duplicate workflow.

#### Scenario: User activates an empty-state action
- **WHEN** a user selects the primary action from a contextual empty state
- **THEN** the system SHALL open the established workflow for that action
