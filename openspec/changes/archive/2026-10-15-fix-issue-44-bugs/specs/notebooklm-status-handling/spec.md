## ADDED Requirements

### Requirement: NotebookLM status synchronization
The NotebookLM integration status and UI SHALL accurately reflect the CLI connection and authorization state, avoiding misleading "Connected" indicators when notebook retrieval fails or when the CLI is unauthorized.

#### Scenario: Notebook listing fails during health check
- **WHEN** NotebookLM health check succeeds but `notebooklmListNotebooks` fails or returns an empty list due to CLI auth errors
- **THEN** the system sets connection state to error/disconnected with a helpful error message prompting re-login or configuration update

#### Scenario: Successful connection with notebooks
- **WHEN** NotebookLM health check succeeds and notebooks are returned
- **THEN** the interface selects the active notebook or first available notebook and displays the workspace UI
