## ADDED Requirements

### Requirement: Tag Editor Surface is Completely Opaque
The compact tag editor popover (`CompactTagEditor`) and all embedded tag editing surfaces SHALL render on a 100% opaque foreground surface using semantic theme tokens (`bg-popover`, `border-border`, solid background color). The popover SHALL NOT allow underlying document card titles, metadata, action buttons, covers, or badges to visually bleed through or overlap with the tag editor contents in any theme.

#### Scenario: Dark theme tag editing has opaque background
- **WHEN** the user opens the tag editor in the Documents view under any dark theme (e.g., Modern Dark, Midnight, Obsidian, Glass Dark)
- **THEN** the popover background is fully opaque
- **AND** no text or visual elements from the underlying document card or row are visible through the popover surface

#### Scenario: Light theme tag editing has opaque background
- **WHEN** the user opens the tag editor in the Documents view under any light theme (e.g., Default Light, Solarized Light, Matcha)
- **THEN** the popover background is solid and fully opaque
- **AND** no underlying text or card borders bleed through

#### Scenario: Document card elements underneath do not interfere with tag text
- **WHEN** a document card contains long titles, dense metadata, progress bars, and action buttons
- **AND** the user clicks the tag editor trigger on that card
- **THEN** the tag editor displays tag chips and the input field with clean, solid contrast against the popover background without visual collision with the elements behind it

### Requirement: Visual Contrast and Semantic Theme Tokens
The tag editor SHALL utilize Plethora's semantic design tokens to ensure accessible contrast (WCAG AA) between the popover background, text labels, tag chips, chip remove buttons, input placeholder, input border, and interactive focus/hover states.

#### Scenario: Tag chips and input contrast clearly against the popover
- **WHEN** tag chips are displayed inside the open tag editor popover
- **THEN** each chip has a clearly defined border, legible foreground text, and distinct background
- **AND** the text input for adding tags has a distinct background, clear placeholder text, and a high-visibility focus ring

#### Scenario: Remove buttons and interactive controls provide clear hover and focus states
- **WHEN** the user hovers over or tabs to a tag remove button (`X`) or the add tag button (`+`)
- **THEN** the button displays an obvious hover/focus indicator with sufficient contrast
- **AND** screen readers announce the action with an accessible label containing the tag name

### Requirement: Stacking Context and Layering Isolation
The tag editor popover SHALL have an explicit stacking context with high z-index priority (`z-50` / `z-[9999]` or portal rendering where necessary) so that sibling document cards, virtualized list items, covers, or floating action buttons cannot render on top of or clip the active popover.

#### Scenario: Popover appears above sibling document cards and rows
- **WHEN** the user opens the tag editor on a document card in grid view or list view
- **THEN** the popover renders strictly above all neighboring cards and rows without being clipped by parent overflow boundaries

#### Scenario: Mobile viewport constraints
- **WHEN** the user opens the tag editor on a narrow screen or mobile device
- **THEN** the popover adjusts its width to `max-w-[calc(100vw-2rem)]` and positions itself safely within the visible viewport without horizontal clipping

### Requirement: Interaction and Keyboard Navigation Preservation
Fixing the opacity and contrast of the tag editor SHALL NOT alter or regress the existing tag editing behaviors, including optimistic updates, asynchronous persistence, keyboard shortcuts (Enter to add tag, Escape to close), and focus return to trigger.

#### Scenario: Adding a tag persists immediately and updates UI
- **WHEN** the user types a new tag and presses Enter
- **THEN** the tag is added optimistically to the document, persisted via the backend, and focus remains on the input for rapid multi-tag entry

#### Scenario: Escape key closes popover and restores focus to trigger button
- **WHEN** the tag editor popover is open and the user presses the Escape key
- **THEN** the popover closes immediately
- **AND** keyboard focus is restored to the compact tag editor trigger button
