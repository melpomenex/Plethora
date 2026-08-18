## ADDED Requirements

### Requirement: An empty notebook list is reported only from a verified empty envelope

The NotebookLM listing command SHALL return an empty notebook list only when the CLI's output is a parseable envelope that affirmatively contains zero notebooks. Any non-empty output that cannot be parsed as a known notebook-list envelope SHALL be returned as an error carrying the raw output (truncated), and SHALL NOT be converted into an empty list. Entries within a parseable envelope that lack the required identifier fields SHALL be reported in the error rather than silently dropped.

#### Scenario: Exit-zero non-JSON stdout is an error, not an empty list

- **WHEN** the notebook listing CLI exits successfully but its stdout is not valid JSON for a known envelope
- **THEN** the command returns an error that includes the raw CLI output
- **AND** the frontend shows its error state with the re-authenticate action
- **AND** no connected state is set from this outcome

#### Scenario: A verified empty account remains a healthy state

- **WHEN** the listing returns a parseable envelope with zero notebooks
- **THEN** the view shows a connected state
- **AND** it communicates that the account has no notebooks yet, distinguishable from a failure

#### Scenario: Unknown JSON shape is an error

- **WHEN** the listing output parses as JSON but matches no known envelope shape
- **THEN** the command returns an error rather than an empty list

### Requirement: Login success requires verification

Every NotebookLM login strategy SHALL verify the resulting session (affirmative authentication check or successful listing) before reporting success to the user, and SHALL NOT persist a connected flag from an unverified login.

#### Scenario: Unverified login is not reported as success

- **WHEN** a login strategy copies or creates credentials without completing a verification step
- **THEN** the login is not reported as successful until verification passes
- **AND** the persisted connection state does not claim connected

### Requirement: The Connected status never hides a failed listing

The NotebookLM view SHALL NOT display a Connected badge over a session whose notebook listing has not succeeded. A listing that fails or times out SHALL surface the failure and the re-authenticate action instead of an empty-but-connected workspace. The listing timeout SHALL be long enough (or configurable) that a CLI cold start (browser bootstrap) is not routinely reported as a timeout error.

#### Scenario: Listing timeout presents an error, not connected-empty

- **WHEN** the notebook listing does not complete within the configured timeout on a cold CLI start
- **THEN** the view reports the timeout as an error with a retry affordance
- **AND** does not display a Connected badge for that session
