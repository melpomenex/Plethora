## ADDED Requirements

### Requirement: Visual modes create durable document ranges
The reader SHALL represent visual and visual-line selections as ordered logical document ranges with independent anchor and head positions.

#### Scenario: Enter visual mode
- **WHEN** the user presses the configured visual-mode key in normal mode
- **THEN** the current caret becomes the anchor and subsequent motions extend a visibly distinct selection

#### Scenario: Reverse through the anchor
- **WHEN** the moving end crosses the anchor
- **THEN** the range reverses direction without losing or duplicating selected text

#### Scenario: Select across boundaries
- **WHEN** a visual motion crosses EPUB sections or PDF pages
- **THEN** the complete logical range remains selected, mounted portions are visibly marked, and boundary affordances indicate continuation into unmounted content

### Requirement: Visual-line mode selects logical visual lines
Visual-line mode SHALL expand the range to full rendered line boundaries while retaining stable source positions.

#### Scenario: Extend visual-line selection
- **WHEN** the user enters visual-line mode and moves vertically
- **THEN** every line from the anchor line through the head line is included in the range

### Requirement: Selection actions use a canonical snapshot
Every Vim selection action SHALL operate on one immutable snapshot containing the complete selected text, ordered document positions, and high-fidelity format-specific selection context.

#### Scenario: Extract an EPUB range
- **WHEN** the user extracts a visual selection from an EPUB
- **THEN** the created extract includes the full selected text and a resolvable EPUB CFI range

#### Scenario: Extract a multi-page PDF range
- **WHEN** the user extracts a visual selection spanning PDF pages
- **THEN** the created extract includes the full text and page-specific offsets and rectangles for every covered page

#### Scenario: Content remounts before action
- **WHEN** part of the selection is unmounted or remounted before an action runs
- **THEN** the action uses the logical range snapshot and does not truncate to the currently mounted DOM selection

### Requirement: Users can act on visual selections from the keyboard
The reader SHALL expose keyboard actions for instant extract, editable extract, copy, highlight with color choice, flashcard creation, and additional commands through the command interface.

#### Scenario: Successful action
- **WHEN** a selection action completes successfully
- **THEN** the reader confirms the action, returns to normal mode, clears the visual range, and places the caret at the former range start

#### Scenario: Failed action
- **WHEN** a selection action fails
- **THEN** the reader preserves the range, communicates the failure, and permits retry or cancellation

#### Scenario: Choose highlight color
- **WHEN** the user invokes highlight on a visual range
- **THEN** the reader exposes keyboard-navigable available colors, previews the choice, and creates the highlight with the confirmed color

### Requirement: Leaving visual mode is predictable
The reader SHALL use Escape to move from visual or visual-line mode to normal mode while clearing only the active Vim range.

#### Scenario: Cancel a visual range
- **WHEN** the user presses Escape in visual mode
- **THEN** the visual range is cleared, the caret remains at the active end, and Vim normal mode remains active

