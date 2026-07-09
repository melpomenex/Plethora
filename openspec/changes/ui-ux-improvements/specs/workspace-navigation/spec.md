## ADDED Requirements

### Requirement: Users can find and switch open workspace tabs
The system SHALL provide a searchable workspace switcher that lists open tabs with their title, icon, active state, and pane context.

#### Scenario: User searches open tabs
- **WHEN** the user enters text in the workspace switcher
- **THEN** the list SHALL filter to matching open-tab titles

#### Scenario: User selects an open tab
- **WHEN** the user selects a tab from the workspace switcher
- **THEN** the system SHALL activate that tab in its existing pane without closing or moving other tabs

### Requirement: Users can recover recently closed tabs
The system SHALL expose recently closed tabs from the existing workspace history and allow a user to reopen one.

#### Scenario: User reopens a closed tab
- **WHEN** the user selects a recently closed tab from the switcher or recovery control
- **THEN** the system SHALL restore the tab using the existing reopen behavior

#### Scenario: No tab has been closed
- **WHEN** there are no recoverable closed tabs
- **THEN** the workspace switcher SHALL omit or disable the recovery section without showing an error
