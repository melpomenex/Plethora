## MODIFIED Requirements

### Requirement: Single-surface mobile composer bar

On mobile the Assistant composer SHALL be one input bar containing the text field, a leading add control, and a trailing control group with dictation and send. When the draft is empty the trailing group SHALL present dictation; when the draft or attachments are non-empty it SHALL also present a send control with an explicit busy/stop state while a turn is in flight. The composer SHALL NOT render persistently visible rows for a usage hint, utility slash-command chips, stacked attachment/send buttons, or dictation status text; dictation status and errors SHALL be announced accessibly and shown transiently without permanently reducing conversation height. One conditional contextual-action row immediately above the bar SHALL be permitted under the conversation-first chrome requirements; it SHALL NOT alter or duplicate the input bar.

#### Scenario: Empty draft
- **WHEN** the mobile Assistant opens with an empty draft
- **THEN** the composer is one input bar showing the add control and a dictation control, with no separate usage hint, utility slash-command chips, or stacked attach button
- **AND** a useful target and sufficient conversation space permit one contextual-action row above the bar

#### Scenario: Draft non-empty
- **WHEN** the user types text or attaches an image
- **THEN** a send control appears in the trailing group and the draft can be sent without leaving the bar

#### Scenario: Dictation status does not consume a row
- **WHEN** dictation is starting, listening, finalizing, or fails
- **THEN** the state is conveyed through the dictation control and an accessible announcement, and no permanent status row is added above the conversation

### Requirement: Add control opens one command-and-attachment menu

The leading add control SHALL open a single searchable menu anchored over the composer. The menu SHALL list contextual Assistant actions, the Assistant's slash commands, the shared command registry's available actions with the same matching, aliases, availability gating, and executor semantics as the keyboard command palette, and the image-attachment action. Contextual actions SHALL have the same availability, targets, parameter choices, and execution behavior as their promoted action controls. Selecting a slash command SHALL place it in the input for the user to confirm or extend; selecting a registry action SHALL perform the same action as the keyboard palette and dismiss the menu while preserving the conversation; selecting attachment SHALL open the platform file picker. Opening the menu SHALL NOT force the software keyboard. The contextual strip's More or compact Actions control SHALL open the same menu directly at its grouped contextual Actions section, without nesting another sheet or duplicating the command catalog.

#### Scenario: Slash command is composed, not auto-sent
- **WHEN** the user opens the add menu and selects `/tools`
- **THEN** `/tools` is placed in the input with focus available for editing and no message is sent

#### Scenario: Registry action matches the keyboard palette
- **WHEN** the user searches the add menu for an available action and activates it
- **THEN** the shared executor performs the same action as the keyboard palette, the menu dismisses, and the existing conversation, draft, and scope remain intact

#### Scenario: Availability and empty results
- **WHEN** a registry action is unavailable in the current environment or a search matches nothing
- **THEN** the unavailable action is not offered and an explicit no-results state is shown instead

#### Scenario: Attachment from the same menu
- **WHEN** the user selects the attachment action
- **THEN** the platform image/file picker opens and chosen images appear as composer attachments

#### Scenario: Contextual actions remain accessible while typing
- **WHEN** a draft exists and the primary contextual-action strip has collapsed
- **THEN** the user can open the add menu, find the same contextual actions, and activate an eligible action without replacing or sending that draft

#### Scenario: More uses the shared menu
- **WHEN** the user taps More in the contextual strip
- **THEN** the same composer menu opens at Actions with the target choice and grouped actions, without opening the keyboard or another Assistant sheet

### Requirement: Conversation-first mobile sheet chrome

On phones, the Assistant sheet's persistent chrome around the conversation SHALL be at most the sheet handle plus one compact header row carrying the active context, scope control, and close, with contextual chips (attachments, pinned selection, section mentions) rendered only while their state exists. One contextual-action row with labeled controls SHALL be shown in ordinary conversation mode while an eligible target exists, the composer is idle, no keyboard or dictation is active, no turn is loading or generating, the Actions menu is closed, and the current sheet geometry leaves at least 96 CSS pixels of conversation after the row is included. It SHALL collapse when those conditions fail, including an unsent draft or draft attachments, with the full contextual catalog still reachable through the add menu. Optional actions SHALL collapse before their height causes the partial detent to be discarded. Chat/Commands mode tabs, an always-visible tools hint, persistent utility-command rows, and multiple persistent contextual-action rows SHALL NOT be rendered on phones. Removed controls SHALL remain reachable from the add menu or the header row.

#### Scenario: Contextual chips appear only with state
- **WHEN** no image, pinned selection, or section mention is attached
- **THEN** no empty chip rows are rendered between the header and the conversation

#### Scenario: Chrome no longer forces a single detent
- **WHEN** the sheet opens on a representative phone viewport with an empty conversation
- **THEN** optional action chrome collapses if necessary before the sheet falls back to a single detent, leaving both open stops usable whenever the required chrome permits

#### Scenario: New conversation stays reachable
- **WHEN** the header no longer shows a dedicated New action inline
- **THEN** starting a new conversation is still reachable from the sheet's persistent controls or the add menu

#### Scenario: Idle contextual strip
- **WHEN** readable context is present, the keyboard is closed, and there is enough space for the conversation
- **THEN** one row promotes Summarize, Explain, Quiz me, and More, reducing promotion to fit the available width and text scale

#### Scenario: Keyboard, generation, or short viewport
- **WHEN** the user types, dictation starts, a turn is loading or generating, or the current geometry cannot preserve 96 CSS pixels of conversation with the strip
- **THEN** the optional strip collapses, the input and stop controls remain reachable, and the action catalog remains available in the add menu

#### Scenario: Expanded action menu replaces the strip
- **WHEN** the contextual Actions menu opens
- **THEN** the mobile strip collapses so the menu has more usable height, and the menu contains the primary actions as well as the secondary catalog

### Requirement: Scope is the mobile Assistant presentation

The single-bar composer redesign and its menu presentation SHALL apply to the mobile Assistant presentation only. The shared contextual action catalog SHALL also appear in the desktop Assistant through its desktop action strip and More menu, replacing the desktop utility quick-action row while retaining utility commands in that menu. The desktop input behavior and the selection Ask sheet's composer, context chip, and voice behavior SHALL remain unchanged.

#### Scenario: Desktop unchanged
- **WHEN** the Assistant is used beside a document on a desktop-class viewport
- **THEN** the contextual strip and More menu expose the shared reading actions, utility slash commands remain reachable, and the desktop input retains its existing send and editing behavior

#### Scenario: Selection Ask unchanged
- **WHEN** the selection-based Ask sheet opens on mobile
- **THEN** its own composer, context chip, and voice input behave as before
