# notebooklm-status-handling Specification

## Purpose
Users encountered several usability, filtering, and functional bugs in Issue #44: "Due All" filtering omitted learning items/extracts, NotebookLM displayed a connected status without rendering notebooks, the Knowledge Universe graph was off-center, Scroll Mode became stuck on an inescapable "Nothing to Read" state when filters were set to zero, "New Only" showed read/overdue documents, section mentions with # failed in document Q&A for EPUB Table.

## Requirements

### Requirement: NotebookLM status synchronization
The NotebookLM integration status and UI SHALL accurately reflect the CLI connection and authorization state, avoiding misleading "Connected" indicators when notebook retrieval fails or when the CLI is unauthorized.

#### Scenario: Notebook listing fails during health check
- **WHEN** NotebookLM health check succeeds but `notebooklmListNotebooks` fails or returns an empty list due to CLI auth errors
- **THEN** the system sets connection state to error/disconnected with a helpful error message prompting re-login or configuration update

#### Scenario: Successful connection with notebooks
- **WHEN** NotebookLM health check succeeds and notebooks are returned
- **THEN** the interface selects the active notebook or first available notebook and displays the workspace UI
