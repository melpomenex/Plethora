## ADDED Requirements

### Requirement: A tab's content mounts on first activation

A tab's content component SHALL NOT be mounted while the tab has never been active. When a tab becomes active for the first time, its content component SHALL mount. Once mounted, a tab SHALL remain mounted when it becomes inactive, so that its component state survives switching away and back.

While a tab is unmounted, the workspace SHALL still render a stable placeholder in the tab's position so that tab order and identity are unaffected.

#### Scenario: Session restore mounts one tab per pane

- **WHEN** a workspace of 12 tabs in a single pane is restored with one tab active
- **THEN** exactly one tab content component is mounted
- **AND** the other 11 tabs' components have not run any mount effect

#### Scenario: First activation mounts the tab

- **WHEN** the user activates a tab that has never been active in this session
- **THEN** that tab's content component mounts
- **AND** its mount effects run once

#### Scenario: State survives after first mount

- **WHEN** the user activates a tab, enters state into it, switches away, and switches back
- **THEN** the tab was not unmounted in between
- **AND** its state is intact

#### Scenario: Every pane's active tab mounts in a split

- **WHEN** the workspace is split into two panes, each with its own active tab
- **THEN** both active tabs are mounted
- **AND** the inactive tabs in both panes remain unmounted until first activated

### Requirement: First activation does not fire a reactivation

A tab mounting for the first time SHALL be treated as an initial active render, not as a transition from inactive to active. Work registered to run when a tab is reactivated SHALL NOT run on the tab's first mount.

#### Scenario: No duplicate work on first activation

- **WHEN** a tab that registers both mount work and reactivation work is activated for the first time
- **THEN** its mount work runs once
- **AND** its reactivation work does not run

#### Scenario: Reactivation still fires on a later switch

- **WHEN** that same tab is switched away from and then activated again
- **THEN** its reactivation work runs
- **AND** its mount work does not run again

### Requirement: Each tab has its own loading and error boundary

Each mounted tab SHALL be wrapped in its own suspense boundary and its own error boundary. A tab whose content is still loading SHALL show a loading indicator in its own area only, and SHALL NOT replace or blank the content of any other tab or pane. A tab whose content throws during render SHALL show an error state in its own area only, with a way to retry, and SHALL NOT unmount or blank its pane or any other tab.

#### Scenario: One tab loading does not blank the pane

- **WHEN** a background tab's content is mounted and has not finished loading while another tab is active and rendered
- **THEN** the active tab's content stays on screen
- **AND** the loading indicator is confined to the loading tab

#### Scenario: One tab throwing does not kill the pane

- **WHEN** a mounted tab's content component throws during render
- **THEN** that tab shows an error state with a retry affordance
- **AND** the pane, its tab bar, and every other tab remain functional

#### Scenario: Retry remounts only the failed tab

- **WHEN** the user retries a tab that showed an error state
- **THEN** that tab's content is mounted again
- **AND** no other tab is remounted
