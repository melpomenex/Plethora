## ADDED Requirements

### Requirement: A resident tab cap bounds how many tabs stay mounted

The system SHALL enforce a maximum number of simultaneously mounted tabs across the workspace. When activating a tab would push the mounted count above the cap, the least recently active eligible tab SHALL be unmounted. The cap SHALL be evaluated on tab activation, not on a timer.

An unmounted tab SHALL behave exactly as a tab that has never been activated: it renders a placeholder, keeps its position and identity in the tab bar, and mounts again when next activated.

#### Scenario: Cap reached while opening tabs

- **WHEN** the resident cap is 8, eight eligible tabs are mounted, and the user activates a ninth tab
- **THEN** the ninth tab mounts
- **AND** the least recently active eligible tab is unmounted
- **AND** the mounted count is 8

#### Scenario: Evicted tab restores on reactivation

- **WHEN** the user activates a tab that was previously evicted
- **THEN** its content component mounts again
- **AND** it restores from its persisted tab data rather than showing an empty view

#### Scenario: Eviction does not run while idle

- **WHEN** the workspace sits untouched with the mounted count at or below the cap
- **THEN** no tab is unmounted
- **AND** no timer is scheduled to evaluate eviction

### Requirement: Only tab types declared restorable are evictable

Each tab type SHALL declare whether it is evictable. A tab whose type is not declared evictable SHALL NOT be unmounted by the cap, regardless of how long it has been inactive. When no eligible tab exists, the cap SHALL be a no-op and the mounted count SHALL be allowed to exceed it rather than evicting a tab that would lose state.

#### Scenario: Non-evictable tabs are never evicted

- **WHEN** the resident cap is exceeded and every inactive tab's type is not declared evictable
- **THEN** no tab is unmounted
- **AND** the newly activated tab mounts normally

#### Scenario: Eviction picks only from eligible tabs

- **WHEN** the least recently active tab's type is not evictable and a more recently active tab's type is
- **THEN** the evictable tab is unmounted
- **AND** the non-evictable tab stays mounted

#### Scenario: Unsaved work is not discarded

- **WHEN** a tab type holds state that would not survive an unmount and restore
- **THEN** that type is not declared evictable
- **AND** activating other tabs never destroys that state

### Requirement: Active tabs are exempt from eviction

A tab that is the active tab of any pane SHALL NOT be unmounted. In a split workspace, every pane's active tab SHALL be exempt simultaneously.

#### Scenario: Split panes keep both active tabs

- **WHEN** the workspace is split into two panes and the resident cap is exceeded
- **THEN** neither pane's active tab is unmounted

#### Scenario: Dragging a tab between panes

- **WHEN** a mounted tab is moved from one pane to another
- **THEN** the move does not evict it, and does not evict any other tab

> Note: moving a tab between panes re-mounts its content, because the tab is
> rendered under a different pane's subtree — behavior that predates the
> resident cap and is out of scope here. The requirement above is that eviction
> does not *add* to it.

### Requirement: The resident cap is user-configurable

The resident tab cap SHALL be exposed as a user setting with a documented default, and SHALL support a value that disables eviction entirely. Changing the setting SHALL take effect on the next activation without requiring a restart.

#### Scenario: Default leaves ordinary use untouched

- **WHEN** a user works with fewer mounted tabs than the default cap
- **THEN** no tab is ever unmounted
- **AND** behavior matches the workspace without this capability

#### Scenario: Eviction disabled

- **WHEN** the user sets the cap to the value that disables eviction
- **THEN** no tab is unmounted regardless of how many are mounted

#### Scenario: Lowering the cap

- **WHEN** the user lowers the cap below the current mounted count and then activates a tab
- **THEN** eviction brings the mounted count down toward the new cap, choosing eligible tabs least recently active first
