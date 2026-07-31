## ADDED Requirements

### Requirement: Selected section is shown as a collapsed card by default
When a user selects a document section via the `#` mention interaction in any chat surface (Assistant, AI Flashcard Studio, or Document Q&A tab), the system SHALL display the selected section as a card that is collapsed by default, so the section's body text is not visible and does not occupy the screen until the user chooses to open it.

#### Scenario: Collapsed immediately after selection
- **WHEN** the user picks a section from the `#` section-mention popup in the Assistant
- **THEN** a section-mention card is rendered in the chat input area showing the section title and token estimate, but the section's `content` text is NOT visible on screen
- **AND** the card displays a control indicating it can be expanded

#### Scenario: Collapsed consistently across surfaces
- **WHEN** the user selects a section via `#` in the AI Flashcard Studio's context control (sections mode)
- **THEN** the rendered section-mention card is collapsed by default, identical in collapsed appearance to the card shown in the Assistant
- **WHEN** the user selects a section via `#` in the Document Q&A tab
- **THEN** the rendered section-mention card is also collapsed by default, identical in collapsed appearance

### Requirement: Collapsed card header shows identifying info and token estimate
The collapsed card header SHALL display, at minimum, the section title, the section's breadcrumb path (or the last breadcrumb segment combined with the title), and an estimated token count, plus a remove control and an expand/collapse toggle. It SHALL NOT render the section body text in the collapsed state.

#### Scenario: Header content
- **WHEN** a section-mention card is rendered in its collapsed state
- **THEN** the header shows a section icon, the title (with breadcrumb context when available), and an estimated token count badge
- **AND** a remove (`×`) control is present that removes the section from the active selection
- **AND** an expand/collapse toggle control is present
- **AND** none of the section's `content` body text is visible

### Requirement: User can expand the card to read the section content
The card SHALL be expandable on user action so the user can read the captured section content that will be fed to the model. When expanded, the system SHALL reveal the section's resolved content in a scroll-bounded region so it does not overflow the chat input area.

#### Scenario: Expand reveals content
- **WHEN** the user activates the expand toggle on a collapsed section-mention card
- **THEN** the card expands to reveal the section's `content` text
- **AND** the revealed content is constrained to a bounded, scrollable region (so a long section does not create a large blob on screen)

#### Scenario: Collapse hides content again
- **WHEN** the user activates the toggle on an expanded section-mention card
- **THEN** the card returns to its collapsed state and the section body text is hidden

#### Scenario: Empty content shown gracefully
- **WHEN** the user expands a card whose section has no captured `content`
- **THEN** the system shows a "no preview available"-style message instead of an empty region

### Requirement: Expansion is local and never changes what is sent
Card expansion/collapse SHALL be a presentation-only, per-card local state and SHALL NOT alter which sections are selected, the resolved context, the token estimate used for sending, or the data sent to the LLM.

#### Scenario: Toggling expansion does not affect selection
- **WHEN** the user expands and then collapses a section-mention card multiple times
- **THEN** the underlying selected-section state, the `#{title}` token in the input, the cost/token estimate, and the context that will be sent to the model remain unchanged

### Requirement: Remove control preserves existing deselection behavior
Activating the remove control on a card SHALL remove the section from the active selection and strip the corresponding `#{title}` token from the chat input, consistent with the existing per-surface deselection behavior prior to this change.

#### Scenario: Remove clears section and token
- **WHEN** the user clicks the remove (`×`) control on a section-mention card
- **THEN** the section is removed from the active selected-sections state
- **AND** the corresponding `#{title}` token is removed from the chat input text
- **AND** the card disappears from the input area

### Requirement: Keyboard accessibility of the card toggle
The expand/collapse toggle and remove control SHALL be operable via keyboard, and the card SHALL expose accessible state indicating whether it is expanded.

#### Scenario: Keyboard toggle and aria state
- **WHEN** the user focuses the card toggle and presses Enter or Space
- **THEN** the card expands or collapses accordingly
- **AND** the toggle exposes `aria-expanded` reflecting the current state
- **WHEN** the expanded body is present
- **THEN** it is associated with the toggle via `aria-controls`
