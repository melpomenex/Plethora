## ADDED Requirements

### Requirement: Right-Click Context Menu for Knowledge Visualizers
The system MUST show a custom context menu when a user right-clicks on a node in either the 2D Knowledge Graph or the 3D Knowledge Sphere.

#### Scenario: Right-clicking a node
- **WHEN** the user right-clicks on a document, extract, or flashcard node in the 2D Graph or 3D Sphere
- **THEN** the custom context menu SHALL appear at the cursor position with context-sensitive options

### Requirement: Context Menu Actions
The custom context menu MUST support opening/viewing, editing, focusing, copying title, and deleting the selected node.

#### Scenario: Selecting Open Item
- **WHEN** the user clicks "Open" in the context menu for a document, extract, or flashcard node
- **THEN** the system SHALL open the item in a new tab (using DocumentViewer or ReviewTab)

#### Scenario: Selecting Focus Node
- **WHEN** the user clicks "Focus View" in the context menu
- **THEN** the camera or canvas transform SHALL smoothly animate to center and zoom in on that node

#### Scenario: Selecting Edit Details
- **WHEN** the user clicks "Edit Details" in the context menu
- **THEN** the system SHALL display the node edit drawer or inline editing inputs for that node

#### Scenario: Selecting Copy Title
- **WHEN** the user clicks "Copy Title" in the context menu
- **THEN** the system SHALL copy the node's full label to the clipboard and show a success toast

#### Scenario: Selecting Delete Node
- **WHEN** the user clicks "Delete" in the context menu
- **THEN** the system SHALL display a confirmation dialog, and upon confirmation, delete the node from the database and refresh the graph/sphere

### Requirement: Enhanced Statistics and Detail Card in Knowledge Sphere
When a node is selected in the 3D Knowledge Sphere, the system MUST show a detailed stats card containing node type, color, metadata, connection breakdown, and quick action buttons.

#### Scenario: Clicking a node in the 3D Sphere
- **WHEN** the user left-clicks a node in the 3D Sphere
- **THEN** a details card SHALL be displayed in the UI showing the node's title, type, category, tags, and counts of its connections grouped by type (contains, derived, reference, related)

#### Scenario: Stats card actions
- **WHEN** the user clicks action buttons (Focus, Open, Edit, Delete) on the stats card
- **THEN** the corresponding action SHALL execute immediately (e.g. animating camera, opening a tab, entering edit mode, or prompting deletion)

#### Scenario: Inline editing from the sphere stats card
- **WHEN** the user enters edit mode on the stats card and saves changes
- **THEN** the system SHALL update the node's label, description, category, or tags in the database, refresh the sphere data, and show a success toast
