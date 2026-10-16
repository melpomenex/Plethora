# mobile-assistant-composer Specification

## Purpose

Give the mobile Assistant a conversation-first composer: one chat-style input bar with a single leading add control that opens the slash-command and registry-command menu, so that nearly all of the sheet's height is available to read answers while every existing composer capability stays reachable.

## ADDED Requirements

### Requirement: Single-surface mobile composer bar

On mobile the Assistant composer SHALL be one input bar containing the text field, a leading add control, and a trailing control group with dictation and send. When the draft is empty the trailing group SHALL present dictation; when the draft or attachments are non-empty it SHALL also present a send control with an explicit busy/stop state while a turn is in flight. The composer SHALL NOT render persistently visible rows for a usage hint, quick-action commands, stacked attachment/send buttons, or dictation status text; dictation status and errors SHALL be announced accessibly and shown transiently without permanently reducing conversation height.

#### Scenario: Empty draft

- **WHEN** the mobile Assistant opens with an empty draft
- **THEN** the composer is one input bar showing the add control and a dictation control, with no separate hint row, command chips, or stacked attach button

#### Scenario: Draft non-empty

- **WHEN** the user types text or attaches an image
- **THEN** a send control appears in the trailing group and the draft can be sent without leaving the bar

#### Scenario: Dictation status does not consume a row

- **WHEN** dictation is starting, listening, finalizing, or fails
- **THEN** the state is conveyed through the dictation control and an accessible announcement, and no permanent status row is added above the conversation

### Requirement: Add control opens one command-and-attachment menu

The leading add control SHALL open a single searchable menu anchored over the composer. The menu SHALL list the Assistant's slash commands, the shared command registry's available actions with the same matching, aliases, availability gating, and executor semantics as the keyboard command palette, and the image-attachment action. Selecting a slash command SHALL place it in the input for the user to confirm or extend; selecting a registry action SHALL perform the same action as the keyboard palette and dismiss the menu while preserving the conversation; selecting attachment SHALL open the platform file picker. Opening the menu SHALL NOT force the software keyboard.

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

### Requirement: Conversation-first mobile sheet chrome

On phones, the Assistant sheet's persistent chrome around the conversation SHALL be at most the sheet handle plus one compact header row carrying the active context, scope control, and close, with contextual chips (attachments, pinned selection, section mentions) rendered only while their state exists. Chat/Commands mode tabs, an always-visible tools hint, and always-visible quick-action rows SHALL NOT be rendered on phones. Removed controls SHALL remain reachable from the add menu or the header row.

#### Scenario: Contextual chips appear only with state

- **WHEN** no image, pinned selection, or section mention is attached
- **THEN** no empty chip rows are rendered between the header and the conversation

#### Scenario: Chrome no longer forces a single detent

- **WHEN** the sheet opens on a representative phone viewport with an empty conversation
- **THEN** the persistent header and composer chrome leave the partial detent usable so both open stops remain available

#### Scenario: New conversation stays reachable

- **WHEN** the header no longer shows a dedicated New action inline
- **THEN** starting a new conversation is still reachable from the sheet's persistent controls or the add menu

### Requirement: Existing composer capabilities remain reachable and accessible

Every capability previously available from the mobile composer SHALL remain reachable from the new bar, the add menu, the header row, or contextual chips: image attachment (picker, paste, and drag where the platform provides them), pinned-selection chip with clear, section-mention cards, dictation including its consent disclosure and error recovery, scope selection, source attach/remove, new conversation, share, and model/provider selection. All interactive controls SHALL expose at least 48 CSS-pixel targets on coarse pointers, visible focus, and screen-reader operable names and states, and dismissing the menu or sheet SHALL preserve the draft and any dictation consent already granted.

#### Scenario: Assistive technology walkthrough

- **WHEN** a screen-reader user explores the bar, opens the add menu, activates attachment, dismisses the menu, and closes the sheet
- **THEN** each control is announced with a role and name, activation works without gestures, and the draft and conversation survive

#### Scenario: Dictation consent and failure

- **WHEN** the user first starts dictation without prior consent
- **THEN** the disclosure is presented before capture, declining keeps typing available, and a failure surfaces readable recovery guidance without losing the draft

#### Scenario: Large text and reduced motion

- **WHEN** enlarged text or reduced-motion preferences are active
- **THEN** the bar, menu, and chips reflow without clipping and remain fully operable without spring motion

### Requirement: Scope is the mobile Assistant presentation

The redesigned composer and menu SHALL apply to the mobile Assistant presentation only. The desktop Assistant panel and the selection Ask sheet SHALL keep their existing composer behavior and layout.

#### Scenario: Desktop unchanged

- **WHEN** the Assistant is used on a desktop-class viewport
- **THEN** the existing composer, hint, quick actions, and input layout render as before

#### Scenario: Selection Ask unchanged

- **WHEN** the selection-based Ask sheet opens on mobile
- **THEN** its own composer, context chip, and voice input behave as before

### Requirement: Localized mobile Assistant chrome

All user-facing strings introduced by the redesigned composer and menu SHALL be localized in the product's supported locales (de, en, es, fr, ja, zh); the mobile sheet SHALL NOT display hardcoded English labels, including the replaced Chat/Commands labels.

#### Scenario: Non-English locale

- **WHEN** the interface language is German, French, Spanish, Japanese, or Chinese
- **THEN** the add-menu title, search placeholder, attachment item, and composer control labels render in that language
