## ADDED Requirements

### Requirement: Notebook listing failures surface as typed errors

The NotebookLM CLI provider SHALL NOT convert a notebook-listing failure into an empty list. An auth-shaped listing failure SHALL surface as a typed not-authenticated error; any other listing failure SHALL surface as a generic listing error. A listing that succeeds with zero notebooks SHALL return an empty list, indistinguishable from a genuine empty account only in that one case.

#### Scenario: Auth failure during listing is surfaced, not silenced
- **WHEN** the NotebookLM CLI `list` command fails with an auth-shaped error (for example expired cookies, 401, "not logged in")
- **THEN** the provider returns a not-authenticated error and the frontend receives a failure result rather than an empty notebook list

#### Scenario: Genuine empty account still returns an empty list
- **WHEN** the NotebookLM CLI `list` command succeeds and returns zero notebooks for an authenticated account
- **THEN** the provider returns an empty list and the frontend treats it as a healthy connected-but-empty state, not an error

#### Scenario: Non-auth listing failure surfaces as an error
- **WHEN** the NotebookLM CLI `list` command fails for a reason that is not auth-shaped (for example runtime crash, timeout, non-JSON output)
- **THEN** the provider returns a listing error and the frontend receives a failure result rather than an empty notebook list

### Requirement: Connection health reflects the live session state

The NotebookLM health check SHALL report the connection state from the result of a live verification of the CLI session, not from a persisted "connected" flag. A session whose verification fails SHALL be reported as not connected, even if a connection or login previously succeeded.

#### Scenario: Expired session is not reported as connected
- **WHEN** a user previously connected but the CLI session verification now fails (for example cookies expired or were revoked)
- **THEN** the health check reports the session as not connected

#### Scenario: Verified session is reported as connected
- **WHEN** the CLI session verification succeeds
- **THEN** the health check reports the session as connected

### Requirement: Needs-reauthentication UI state

The NotebookLM page SHALL distinguish three outcomes after a connection check: connected with notebooks, connected but empty (a healthy new account), and needs-reauthentication (listing failed due to auth, or the session is not verified). The page SHALL NOT render a "Connected" badge while in the needs-reauthentication state.

#### Scenario: Auth failure during connection check enters needs-reauthentication
- **WHEN** the connection check finds the listing failed due to auth (or the session is not verified despite a prior connection)
- **THEN** the page enters a needs-reauthentication state and does not show the green "Connected" badge

#### Scenario: Healthy empty account stays connected-but-empty
- **WHEN** the connection check verifies the session and listing succeeds with zero notebooks
- **THEN** the page remains in the connected state and shows the connected-but-empty prompt to create a first notebook

#### Scenario: Listing failure with notebooks absent is not shown as a healthy connection
- **WHEN** listing fails for any reason while no notebooks have been loaded
- **THEN** the page does not display a "Connected" badge over an empty workspace

### Requirement: Reachable Re-authenticate CLI action

The NotebookLM page SHALL provide a Re-authenticate CLI action that is reachable whenever the page is in the needs-reauthentication state or a listing failure has occurred. Activating it SHALL trigger the existing CLI login flow.

#### Scenario: Re-authenticate action is offered on needs-reauthentication
- **WHEN** the page is in the needs-reauthentication state
- **THEN** a Re-authenticate CLI action is visible and activating it starts the CLI login flow

#### Scenario: Re-authenticate action is offered on a non-auth listing failure
- **WHEN** a non-auth listing failure occurs
- **THEN** a Re-authenticate CLI action is offered alongside the error message so the user can retry authentication
