## ADDED Requirements

### Requirement: Queue Extracts view is independently vertically scrollable

When a document is open in Queue/Scroll Mode and the user selects the Extracts view, the Extracts surface SHALL occupy the available document pane and provide its own vertical scrolling region. The region MUST be able to shrink within the full-height flex layout and SHALL support touch and wheel scrolling without changing the scrolling behavior of the document viewer branch.

#### Scenario: Mobile user scrolls through multiple extracts

- **WHEN** a user opens an EPUB from Queue on a narrow touch viewport, selects the overlay Extracts button, and the document has more extracts than fit in the viewport
- **THEN** the Extracts view exposes a vertical scroll container within the available pane
- **AND** a vertical swipe moves the list to extracts below the initial viewport
- **AND** the list does not expand past the viewport and become clipped by the Queue page

#### Scenario: Desktop user uses wheel scrolling

- **WHEN** a desktop user opens the Queue Extracts view with content taller than the pane
- **THEN** the Extracts list scrolls vertically inside the pane with the mouse wheel or trackpad
- **AND** the overlay controls remain available above the list

### Requirement: Queue Extracts content remains within narrow viewport insets

The Queue Extracts surface SHALL apply responsive horizontal insets around the complete list content, including the `Extracts` heading, bulk controls, extract cards, loading state, empty state, and error state. It SHALL also provide sufficient top and bottom content clearance for the fixed overlay layer and applicable mobile safe-area insets. The surface MUST NOT introduce horizontal overflow solely because the heading or list is rendered at a narrow supported width.

#### Scenario: Narrow device heading is not flush with the edge

- **WHEN** the Extracts view is opened on a narrow device such as a Boox Palma 2
- **THEN** the `Extracts` heading begins inside a visible horizontal content inset on both sides
- **AND** the heading and its count remain fully visible without bleeding into or being clipped by the screen edge

#### Scenario: Last extract can be reached above the bottom inset

- **WHEN** a user scrolls to the end of a long Extracts list on a mobile device with a bottom safe area or transient overlay controls
- **THEN** the final extract and its actions can be brought fully into the visible scrollport
- **AND** the bottom of the content is not hidden behind the safe area, progress indicator, or overlay controls

### Requirement: Existing Extracts interactions and view switching are preserved

The layout change SHALL preserve the current ExtractsList loading, selection, editing, deletion, card-generation, focused-extract scrolling, and dialog behavior. Selecting Document or Learning Cards from the overlay SHALL continue to replace the Extracts surface with the existing corresponding view, and the EPUB/document viewer SHALL retain its existing internal scrolling when restored.

#### Scenario: Extract actions remain usable after scrolling

- **WHEN** a user scrolls to an extract in Queue's Extracts view and taps its edit, delete, select, or card-generation control
- **THEN** the existing action executes using the current ExtractsList behavior
- **AND** the list remains in the Queue Extracts surface after the action unless the existing action explicitly opens a dialog

#### Scenario: Switching back restores document scrolling

- **WHEN** a user switches from Extracts back to Document using the overlay view-mode control
- **THEN** the Extracts scroll region is removed from the active document pane
- **AND** the EPUB/document viewer is rendered with its existing scrolling and paging behavior
