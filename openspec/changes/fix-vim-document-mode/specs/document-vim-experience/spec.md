## ADDED Requirements

### Requirement: The reader clearly communicates modal state
While Vim mode is active, the reader SHALL show a compact Reading Rail containing the active mode, current document location, and any pending count, key sequence, or operator.

#### Scenario: Operator is pending
- **WHEN** the user enters an operator without completing its target
- **THEN** the Reading Rail and caret styling communicate the pending operator until it completes, times out, or is cancelled

#### Scenario: Interface becomes idle
- **WHEN** no Vim input occurs for the configured idle interval
- **THEN** the Reading Rail dims without hiding the mode identity or caret

### Requirement: Visual selections reveal contextual actions
The Reading Rail SHALL expand into a contextual action dock only while a non-empty Vim visual range exists and SHALL display the user's resolved shortcut labels.

#### Scenario: Range becomes non-empty
- **WHEN** the user extends a visual selection
- **THEN** the rail reveals relevant extract, copy, highlight, flashcard, and more-actions affordances without covering the selected text

#### Scenario: Visual mode ends
- **WHEN** the user completes or cancels visual mode
- **THEN** the action dock collapses back to the compact mode rail

### Requirement: Vim mode safely cooperates with focus owners
The reader SHALL not activate or consume Vim commands when an editable field, modal, command palette, browser-find surface, or other declared focus owner is active.

#### Scenario: Escape inside a dialog
- **WHEN** a dialog owns focus and the user presses Escape
- **THEN** the dialog receives its normal Escape behavior and the reader does not activate Vim mode

#### Scenario: Reader navigation conflicts with Vim
- **WHEN** Vim mode is active and a key is bound both to reader chrome navigation and a Vim command
- **THEN** the Vim command takes precedence until Vim mode is deactivated

#### Scenario: Leave normal mode
- **WHEN** the user presses Escape in Vim normal mode with no pending sequence or operator
- **THEN** Vim mode deactivates and standard reader bindings resume

### Requirement: Pointer and touch input remain coherent
While Vim mode is active, clicking text SHALL move the Vim caret, dragging text SHALL establish a visual range, and interacting with reader chrome SHALL not silently relocate the caret.

#### Scenario: Click document text
- **WHEN** the user clicks or taps navigable text in Vim normal mode
- **THEN** the logical caret moves to the nearest text position and remains keyboard navigable

#### Scenario: Drag a selection
- **WHEN** the user drags across navigable text while Vim mode is active
- **THEN** the reader adopts the dragged range as a Vim visual selection with full source context

### Requirement: Vim UI is accessible and responsive
The caret, selection, Reading Rail, feedback, and contextual actions SHALL support light/dark themes, high contrast, reduced motion, keyboard navigation, screen-reader labels, narrow viewports, and safe-area insets.

#### Scenario: Reduced motion is enabled
- **WHEN** the operating system requests reduced motion
- **THEN** caret and rail state changes occur without nonessential travel, pulse, or expansion animation

#### Scenario: Narrow mobile reader
- **WHEN** the reader is displayed in a narrow viewport
- **THEN** the Reading Rail remains reachable above the safe area and does not obscure the active caret or selection

### Requirement: Contextual help teaches the current mode
The reader SHALL provide contextual Vim help that lists commands valid for the active mode and SHALL offer a dismissible first-use hint.

#### Scenario: Open help in visual mode
- **WHEN** the user invokes Vim help while a visual range is active
- **THEN** help prioritizes selection motions, actions, cancellation, and the user's configured shortcuts
