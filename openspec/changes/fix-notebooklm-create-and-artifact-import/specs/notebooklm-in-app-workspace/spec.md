## MODIFIED Requirements

### Requirement: User can manage notebooks and sources from Incrementum
The system SHALL provide in-app actions to list/create/select notebooks and add/manage sources using NotebookLM-supported source types. Notebook creation SHALL pass the user-supplied title directly to the creation call rather than reading it from component state, SHALL report both success and failure to the user, and SHALL indicate that creation is in progress while the call is outstanding.

#### Scenario: Create and select notebook
- **WHEN** the user creates a notebook from Incrementum and selects it as active
- **THEN** subsequent NotebookLM actions run against that notebook

#### Scenario: Title reaches the backend on the first attempt
- **WHEN** the user supplies a notebook title and confirms creation
- **THEN** the create call is invoked with that exact title without requiring a second attempt or a re-render

#### Scenario: Creation is prevented without a title
- **WHEN** the user confirms creation with an empty or whitespace-only title
- **THEN** the system does not call the backend and tells the user a title is required

#### Scenario: Creation failure is visible
- **WHEN** the backend create call returns an error
- **THEN** the system shows the user an error message describing the failure and leaves the panel usable

#### Scenario: Creation is in progress
- **WHEN** a create call is outstanding
- **THEN** the confirm control is disabled and shows a pending state until the call settles

#### Scenario: Creating from the empty state
- **WHEN** the user creates a notebook while no notebook is selected
- **THEN** the newly created notebook becomes the active notebook without further user action

#### Scenario: Title entry does not depend on the host webview
- **WHEN** the user is asked for a notebook title
- **THEN** the prompt is rendered by the application rather than by the webview's native dialog

#### Scenario: Add a source URL
- **WHEN** the user submits a URL source to the active notebook
- **THEN** the system queues source ingestion and shows source status to the user
