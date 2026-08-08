## ADDED Requirements

### Requirement: Tab switching renders a bounded number of tab subtrees

The unit test suite SHALL assert, by counting component renders rather than by measuring elapsed time, that switching the active tab in a pane renders a number of tab subtrees that does not grow with the number of open tabs. Switching between two tabs SHALL render at most the outgoing and incoming tabs' subtrees; every other mounted tab's subtree SHALL NOT re-render.

Assertions in this capability SHALL use exact counts and SHALL NOT reference the clock, so that they hold identically on a fast developer machine and a loaded CI runner.

#### Scenario: Switching in a large workspace

- **WHEN** a pane holds 12 mounted tabs and the active tab changes from one to another
- **THEN** the render counters for the other 10 tabs are unchanged
- **AND** the assertion is an exact count, not a threshold or a duration

#### Scenario: Switch cost does not scale with tab count

- **WHEN** the same switch is performed in a workspace of 4 tabs and in a workspace of 12 tabs
- **THEN** the number of tab subtrees rendered is the same in both cases

### Requirement: Store updates do not wake hidden tabs through the workspace

The unit test suite SHALL assert that a change to the workspace's tab collection does not re-render the subtree of a mounted, inactive tab whose own identity and data are unchanged.

#### Scenario: Unrelated tab data changes

- **WHEN** one tab's data is updated in a workspace of 12 mounted tabs
- **THEN** only that tab's subtree re-renders
- **AND** the other mounted tabs' render counters are unchanged

#### Scenario: Pane chrome does not reconcile other panes

- **WHEN** a workspace is split into two panes and a tab is added to the first pane
- **THEN** the second pane's tab bar and tab content do not re-render

### Requirement: Existing tab behavior contracts are preserved under the invariants

The invariant tests SHALL be written so they cannot be satisfied by breaking the behavior the workspace already guarantees: a mounted tab's component state SHALL survive being switched away from and back to, and boot effects SHALL run for an active tab only.

#### Scenario: State survives a switch

- **WHEN** a user types into a mounted tab, switches to another tab, and switches back
- **THEN** the typed value is still present

#### Scenario: Boot effects remain active-only

- **WHEN** a workspace of tabs is rendered with one tab active
- **THEN** exactly one tab's active-gated boot effect has run

### Requirement: Invariants run in the standard unit test suite

The invariant tests SHALL execute as part of `npm test` and `npm run test:run`, and SHALL fail the run when violated. They SHALL NOT require the benchmark harness, the benchmark baselines, or a recorded baseline of any kind.

#### Scenario: A regression fails the ordinary test run

- **WHEN** a change makes tab switching re-render every mounted tab
- **THEN** `npm run test:run` fails and names the violated invariant
- **AND** the failure does not depend on `npm run bench` having been run

#### Scenario: No baseline maintenance

- **WHEN** an optimization legitimately reduces render counts
- **THEN** the affected invariant assertion is updated in the same change as an ordinary test edit
- **AND** no separate baseline file is involved
