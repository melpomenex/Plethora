## ADDED Requirements

### Requirement: Studio configuration collapses to a single context chip bar on mobile

When the AI Flashcard Studio is rendered in a mobile-shell presentation, its configuration controls — document selection, deck selection, deck tags, image selection, and Context Control — SHALL be represented by a single horizontally scrollable row of chips instead of separate stacked control bands. The chip bar SHALL occupy exactly one row and SHALL NOT wrap to a second line regardless of how many chips are present or how long their labels are.

#### Scenario: Configuration bands are replaced by one chip row

- **WHEN** the Studio is opened in a mobile-shell presentation
- **THEN** the document selector, deck selector, deck tag list, image action buttons, and Context Control panel are not rendered as separate full-width bands
- **AND** a single row of chips is rendered in their place

#### Scenario: Chip bar scrolls rather than wraps

- **WHEN** the combined width of the chips exceeds the viewport width
- **THEN** the chip bar scrolls horizontally
- **AND** the chip bar's height remains that of a single row

#### Scenario: Chip bar is present regardless of document selection

- **WHEN** the Studio is opened in a mobile-shell presentation with no document selected
- **THEN** the chip bar is still rendered
- **AND** the document chip displays an unset state prompting the user to choose a document

### Requirement: Chips display current configuration state

Each chip SHALL display the current value of the control it represents so the user can read the Studio's configuration without opening any sheet. Chip labels SHALL be truncated with an ellipsis when they exceed their maximum width, and the untruncated value SHALL remain available via the chip's accessible name.

#### Scenario: Document chip reflects the selected document

- **WHEN** a document titled "The Power of Neuroplasticity" is selected
- **THEN** the document chip displays that title, truncated to fit its maximum width
- **AND** the chip's accessible name contains the full untruncated title

#### Scenario: Context Control chip reflects the active context selection

- **WHEN** the context selection is a custom excerpt measuring 139 tokens
- **THEN** the Context Control chip displays the token count for the current selection
- **AND** the chip visually indicates that a non-default context is active

#### Scenario: Image chip reflects the selected image count

- **WHEN** two images are selected from the image registry
- **THEN** the image chip displays a count of 2

#### Scenario: Image chip is hidden when no images exist

- **WHEN** the selected document has no images in the registry and no images are selected
- **THEN** the image chip is not rendered

#### Scenario: Deck tag chip is hidden when the deck has no tags

- **WHEN** the selected deck has no tags
- **THEN** no deck tag chip is rendered

### Requirement: Chips open their control in a bottom sheet

Activating a chip SHALL open a bottom sheet containing the full interactive control that the chip summarizes. The sheet SHALL present the same control UI used on desktop, with the same handlers and state, so no configuration option is lost on mobile.

#### Scenario: Document chip opens the document picker

- **WHEN** the user taps the document chip
- **THEN** a bottom sheet opens containing the document picker
- **AND** selecting a document from the sheet updates the Studio's selected document and the document chip's label

#### Scenario: Deck chip opens deck selection and creation

- **WHEN** the user taps the deck chip
- **THEN** a bottom sheet opens containing the deck picker including the option to create a new deck
- **AND** creating a deck from the sheet selects that deck and updates the deck chip's label

#### Scenario: Images chip opens image actions

- **WHEN** the user taps the images chip
- **THEN** a bottom sheet opens exposing the image library and the AI image-occlusion action
- **AND** the AI image-occlusion action is disabled when no image is selected or the active model does not support vision

#### Scenario: Context chip opens the Context Control panel

- **WHEN** the user taps the Context Control chip
- **THEN** a bottom sheet opens containing the Context Control panel with its mode selection, section selection, and token accounting
- **AND** changes made in the sheet update the context selection used for the next request

#### Scenario: Selecting a document resets context selection

- **WHEN** the user selects a different document from the document sheet
- **THEN** the context selection resets to its default
- **AND** the Context Control chip's label updates to reflect the reset selection

### Requirement: Bottom sheets dismiss consistently with the rest of the mobile shell

Studio bottom sheets SHALL use the application's existing mobile bottom-sheet presentation so their dismissal behavior matches other mobile menus: a full-screen scrim that closes the sheet on tap, closure on Escape, and body-scroll locking while open. Only one Studio sheet SHALL be open at a time.

#### Scenario: Tapping the scrim closes the sheet

- **WHEN** a Studio bottom sheet is open and the user taps outside the sheet body
- **THEN** the sheet closes
- **AND** the Studio modal itself remains open

#### Scenario: Escape closes the sheet but not the Studio

- **WHEN** a Studio bottom sheet is open and the user presses Escape
- **THEN** the sheet closes
- **AND** the Studio modal remains open

#### Scenario: Opening a second chip replaces the first sheet

- **WHEN** the document sheet is open and the user taps the deck chip
- **THEN** the document sheet closes
- **AND** the deck sheet opens

#### Scenario: Sheet content is reachable above the keyboard

- **WHEN** a Studio bottom sheet containing a text input is open and the on-screen keyboard is shown
- **THEN** the sheet's content area is bounded by the visible viewport height
- **AND** the focused input remains visible

### Requirement: Secondary view modes move to an overflow menu on mobile

On a mobile-shell presentation the Studio's view-mode control SHALL NOT render as a four-way segmented control. `Chat` SHALL be the default view, and the `Templates`, `Sessions`, and `Extracts` views SHALL be reachable through an overflow affordance in the Studio header. Count badges currently shown on the Sessions and Extracts tabs SHALL remain visible in the overflow menu.

#### Scenario: Overflow menu exposes the secondary views

- **WHEN** the Studio is opened in a mobile-shell presentation and the user activates the header overflow affordance
- **THEN** a menu opens listing the Templates, Sessions, and Extracts views
- **AND** selecting one switches the Studio to that view

#### Scenario: Counts remain visible in the overflow menu

- **WHEN** there is 1 saved session and 1748 extracts available
- **THEN** the overflow menu's Sessions entry shows a count of 1
- **AND** its Extracts entry shows a count of 1748

#### Scenario: Returning to chat from a secondary view

- **WHEN** the Studio is showing the Extracts view on mobile and the user returns to the Chat view
- **THEN** the conversation and composer are shown
- **AND** the chip bar reflects the unchanged configuration

### Requirement: New Session and provider selection remain available on mobile

Starting a new session and choosing the AI provider SHALL remain directly available on a mobile-shell presentation without opening the overflow menu, and the currently selected provider SHALL be identifiable without interaction.

#### Scenario: New session is reachable from the header

- **WHEN** the Studio is opened in a mobile-shell presentation
- **THEN** a New Session affordance is present in the Studio header
- **AND** activating it starts a new session

#### Scenario: Active provider is identifiable and changeable

- **WHEN** the Studio is opened in a mobile-shell presentation with a provider selected
- **THEN** the selected provider's name is visible without opening a menu
- **AND** the user can change the provider from that same affordance

#### Scenario: Notebook selection appears when NotebookLM is selected

- **WHEN** the NotebookLM provider is selected on a mobile-shell presentation
- **THEN** a notebook selection affordance is available
- **AND** sending is prevented until a notebook is chosen

### Requirement: The conversation receives a minimum share of the viewport

On a mobile-shell presentation with the Chat view active and no on-screen keyboard shown, the Studio's message list SHALL occupy at least 45% of the modal's usable height, and the combined configuration chrome above it — header, chip bar, and panel toggle — SHALL NOT exceed 25% of that height.

#### Scenario: Chat area meets its floor on a phone viewport

- **WHEN** the Studio is opened on a 390x844 CSS-pixel viewport with the Chat view active and the keyboard hidden
- **THEN** the message list's height is at least 45% of the modal's usable height
- **AND** the combined height of the header, chip bar, and panel toggle is at most 25% of the modal's usable height

#### Scenario: Composer does not crowd out the conversation

- **WHEN** the Studio is opened on a phone viewport with an empty composer
- **THEN** the composer's text input renders at its compact mobile size
- **AND** the cost estimate is presented on a single line

#### Scenario: Chip bar is hidden in the drafts panel

- **WHEN** the user switches to the Draft Cards panel on mobile
- **THEN** the draft card list receives the space previously used by the chip bar

### Requirement: Desktop layout is unchanged

At desktop presentation the Studio SHALL render its existing layout: the full context bar, the inline Context Control panel, the four-way view-mode segmented control, and the side-by-side chat and draft-cards panels. No chip bar or configuration bottom sheet SHALL appear at desktop presentation.

#### Scenario: Desktop retains inline controls

- **WHEN** the Studio is opened at desktop presentation
- **THEN** the document selector, deck selector, image actions, and Context Control panel render inline as before
- **AND** no chip bar is rendered

#### Scenario: Desktop retains the segmented view-mode control

- **WHEN** the Studio is opened at desktop presentation
- **THEN** the Chat, Templates, Sessions, and Extracts views are presented as a segmented control
- **AND** no overflow menu is used for them

#### Scenario: Crossing the breakpoint restores the other layout

- **WHEN** the Studio is open and the viewport is resized across the mobile/desktop breakpoint
- **THEN** the layout switches between the chip-bar and inline presentations
- **AND** the selected document, deck, images, context selection, view mode, conversation, and draft cards are all preserved
