## ADDED Requirements

### Requirement: NotebookLM authentication is verified fail-closed

The application SHALL treat a NotebookLM session as authenticated only on **explicit, affirmative** verification: the authentication check must complete successfully **and** its response must affirmatively report an authenticated session. Every other outcome SHALL be treated as not authenticated, including a non-zero exit status, an unparseable or missing response body, a response reporting an unauthenticated session, a timeout, and a missing or non-executable CLI.

The application SHALL NOT infer authentication from the absence of recognized error keywords in an error message.

#### Scenario: A check reporting an unauthenticated session is not treated as connected

- **WHEN** the authentication check completes successfully but reports that the session is not authenticated
- **THEN** the application treats the session as not authenticated
- **AND** no connected state is persisted

#### Scenario: An unrecognized failure is not treated as connected

- **WHEN** the authentication check fails with an error that matches no known authentication-failure pattern
- **THEN** the application treats the session as not authenticated

#### Scenario: A missing CLI is not treated as connected

- **WHEN** the NotebookLM CLI is not installed or not executable
- **THEN** the application treats the session as not authenticated
- **AND** the user is told the CLI could not be run

#### Scenario: A timeout is not treated as connected

- **WHEN** the authentication check does not complete within its timeout
- **THEN** the application treats the session as not authenticated

### Requirement: Disconnecting NotebookLM stays disconnected

After the user explicitly disconnects NotebookLM, the application SHALL remain disconnected until the user explicitly reconnects. No component SHALL initiate a connection as a side effect of mounting, rendering, polling, or re-checking authentication status.

#### Scenario: Disconnect is not undone by a background check

- **WHEN** the user disconnects NotebookLM
- **THEN** the connection state remains disconnected
- **AND** no automatic reconnection occurs

#### Scenario: Disconnect survives navigating away and back

- **WHEN** the user disconnects NotebookLM, navigates to another view, and returns
- **THEN** the connection state is still disconnected

#### Scenario: Reconnection requires an explicit user action

- **WHEN** the user disconnects and then chooses Connect
- **THEN** the application attempts to connect

### Requirement: Reported connection state matches verified reality

The NotebookLM view SHALL NOT display a connected state that has not been affirmatively verified. When the session is verified but has no notebooks, the view SHALL distinguish that from an unverified or failed session, so an empty notebook list is never presented as a healthy connection when it is in fact a failure.

#### Scenario: An unverified session is not shown as connected

- **WHEN** authentication could not be affirmatively verified
- **THEN** the view does not display a connected state
- **AND** the view explains that the session could not be verified

#### Scenario: A verified session with no notebooks is distinguishable

- **WHEN** the session is affirmatively verified and the account has no notebooks
- **THEN** the view shows a connected state
- **AND** it indicates that the account has no notebooks yet, rather than implying a failure

#### Scenario: A failed notebook listing is not shown as connected

- **WHEN** the session appears connected but the notebook listing fails
- **THEN** the view reports the listing failure
- **AND** it does not display an empty notebook list as a healthy connected state

### Requirement: Desktop releases include a self-contained NotebookLM runtime

Desktop release artifacts SHALL include the target-specific NotebookLM CLI
runtime, its Python dependencies, and the Playwright Chromium browser used by
the login flow. The runtime SHALL be packaged as application resources rather
than installed into the user's system Python environment on first use.

#### Scenario: A clean desktop install can launch NotebookLM without Python

- **WHEN** a user installs a desktop release on a machine with no NotebookLM CLI or Python environment
- **THEN** the app can launch the bundled NotebookLM CLI
- **AND** the app does not ask the user to install `notebooklm-py` before signing in

#### Scenario: The bundled runtime is present in the desktop artifact

- **WHEN** a macOS, Windows, or Linux desktop artifact is verified before release
- **THEN** its resources contain the target-specific NotebookLM runtime manifest, Python package, and Playwright browser
- **AND** its bundled NotebookLM sidecar is present

#### Scenario: NotebookLM data remains user-specific

- **WHEN** the bundled runtime is installed
- **THEN** authentication cookies and storage state remain in the app's per-user data directory
- **AND** the bundled browser profile is stored in that same app-owned directory
- **AND** an existing authenticated NotebookLM browser profile can be exported into the app storage state
- **AND** no credentials are included in the application bundle
