## ADDED Requirements

### Requirement: Extracts toolbar button
The toolbar SHALL include an Extracts button rendered with the Phosphor `Scissors` icon that opens the library-wide Extracts tab.

#### Scenario: Opening the extracts tab
- **WHEN** the user clicks the Extracts toolbar button
- **THEN** an "Extracts" tab opens and becomes active

#### Scenario: Middle-click opens in background
- **WHEN** the user middle-clicks the Extracts toolbar button
- **THEN** the Extracts tab is added without stealing focus from the active tab

#### Scenario: Reusing an already-open tab
- **WHEN** an Extracts tab is already open and the user clicks the Extracts toolbar button
- **THEN** the existing tab is activated instead of a second one being created

### Requirement: Library-wide extracts list
The Extracts tab SHALL list extracts from all documents in the active collection, most recently created first, showing each extract's text and its source document title.

#### Scenario: Extracts exist
- **WHEN** the Extracts tab loads and the library contains extracts
- **THEN** each extract is listed with its content and source document title

#### Scenario: No extracts yet
- **WHEN** the Extracts tab loads and the library contains no extracts
- **THEN** an empty state explaining how to create extracts is shown instead of a blank list

#### Scenario: Loading fails
- **WHEN** loading extracts fails
- **THEN** an error message is shown with a retry control, and the tab does not crash

### Requirement: Jump to extract source
Each extract in the Extracts tab SHALL offer navigation to its source document.

#### Scenario: Opening the source document
- **WHEN** the user activates an extract's source link
- **THEN** the source document opens in a document-viewer tab focused on that extract
