## ADDED Requirements

### Requirement: Interactive tab navigation is protected from real-time sync work

When real-time sync is enabled, non-urgent sync follow-up work SHALL run cooperatively and SHALL yield to active user input. Activating a tab SHALL NOT synchronously wait for a full sync projection, document-store reload, file-registration sweep, or workspace snapshot serialization before updating the active tab.

#### Scenario: Rapid tab switching with sync backlog

- **WHEN** the user rapidly switches among open tabs while real-time sync has queued background work
- **THEN** each active-tab change is applied without waiting for the entire queued sync workload to drain
- **AND** non-urgent sync work yields while input is pending
- **AND** the tab surface remains interactive throughout the switch sequence

#### Scenario: Tab workspace persistence is deferred safely

- **WHEN** the user switches tabs repeatedly within the persistence debounce window
- **THEN** the workspace snapshot is serialized and written at most once after the burst settles
- **AND** the latest tab/pane state is flushed when the page becomes hidden or is unloaded where the platform permits
- **AND** the serialized snapshot shape remains restorable by the existing session loader

### Requirement: Remote sync projections are coalesced without data loss

The sync runtime SHALL coalesce redundant UI refresh work caused by a burst of remote updates while applying the latest valid remote state and eventually draining all queued projections after interactive input subsides.

#### Scenario: Remote document burst arrives during tab navigation

- **WHEN** multiple remote document updates arrive while the user is switching tabs
- **THEN** the runtime does not perform one full Documents-store reload per remote key
- **AND** the latest valid rows are projected using the existing conflict/clock rules
- **AND** the Documents store is refreshed after the burst in a bounded number of reloads

#### Scenario: Sync work drains after input subsides

- **WHEN** the user stops switching tabs and the app is visible
- **THEN** queued non-urgent sync projections and refresh work resume
- **AND** all successfully received updates are eventually applied or retried according to existing sync error handling
- **AND** no update is discarded solely because it was deferred for responsiveness
