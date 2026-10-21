## ADDED Requirements

### Requirement: Mobile model picker stays within the Assistant sheet

On the mobile Assistant presentation, activating the model control SHALL present the provider picker inside the sheet below the compact header. The picker, its title, its actions, and every provider entry SHALL remain inside the visible sheet and viewport at widths from 320 through 430 CSS pixels, in short and tall viewports, in portrait and landscape, at the partial and expanded detents, and with text enlarged to 200%. The provider list SHALL have a bounded scroll region; no provider may be clipped by the sheet, the panel, or the viewport, and reaching the final provider SHALL NOT require page scrolling or an off-screen drag.

Opening the picker from the partial detent SHALL give the list usable height, either by expanding the sheet to the expanded detent or by an equivalent bounded presentation. If the user collapses the sheet while the picker is open, the picker SHALL remain contained and the provider list SHALL remain scrollable.

The desktop Assistant panel SHALL keep its model menu anchored to the model control rather than replacing the panel body.

#### Scenario: Partial sheet opens the picker

- **WHEN** the Assistant sheet is at the partial detent and the user opens the model picker
- **THEN** the picker is displayed inside the sheet with its full title and close action visible
- **AND** the provider list occupies the remaining sheet height and scrolls independently

#### Scenario: Final provider on a short phone

- **GIVEN** the provider list contains more entries than fit in the visible picker at 320×568 CSS pixels
- **WHEN** the user scrolls the provider list to its end
- **THEN** the final provider is fully visible and selectable
- **AND** no provider or picker surface extends outside the sheet or viewport

#### Scenario: Enlarged text and landscape

- **WHEN** the picker is displayed with text enlarged to 200%, in landscape, or after rotation
- **THEN** its rows reflow vertically without clipping their names, status, or actions
- **AND** the list remains scrollable without introducing horizontal page scrolling

#### Scenario: Sheet is collapsed while the picker is open

- **WHEN** the sheet moves from the expanded to the partial detent with the picker open
- **THEN** the picker remains within the sheet bounds
- **AND** the provider list still scrolls to every provider

### Requirement: Provider choices are operable selection controls

Each provider entry in the mobile picker SHALL be an operable control with a visible focus state and an accessible name that includes the provider, its configured model when one exists, and its status. The currently active provider SHALL expose its selected state programmatically and visibly. On coarse pointers, each entry SHALL provide at least a 48 by 48 CSS-pixel target. Selecting a configured provider SHALL apply that provider, close the picker, and leave the conversation and draft unchanged. Selecting a provider that is not configured SHALL open the existing AI settings location without changing the active provider. The picker SHALL NOT rely on pointer-only clickable containers for selection.

#### Scenario: Screen-reader provider selection

- **WHEN** a screen-reader user opens the picker and moves through its entries
- **THEN** each entry is announced as a selectable control with its provider name, model when configured, and status
- **AND** the active provider is announced as selected

#### Scenario: Choose another configured provider

- **WHEN** the user activates a configured provider other than the active one
- **THEN** that provider becomes active and the picker closes
- **AND** the existing draft, attachments, messages, and scroll position remain available

#### Scenario: Configure a missing provider

- **WHEN** the user activates a provider without a stored configuration
- **THEN** the existing AI provider settings surface opens
- **AND** the active provider and the conversation are not changed

#### Scenario: Keyboard operation

- **WHEN** the picker is open and the user navigates with Tab, Shift+Tab, or the activation keys
- **THEN** focus remains visible on the provider controls and the settings and close actions
- **AND** every reachable action can be activated without a pointer

### Requirement: Picker dismissal returns focus without losing context

Back and Escape SHALL dismiss the mobile model picker before dismissing the Assistant sheet. Closing the picker by its close action, by selecting a provider, or by Back/Escape SHALL return focus to the model control. Dismissing the picker SHALL preserve the current draft, attachments, conversation, and sheet detent, and SHALL NOT send a message or navigate away from the reader.

#### Scenario: Back closes only the picker

- **WHEN** the picker is open and the user invokes Back
- **THEN** the picker closes and the Assistant sheet remains open
- **AND** a subsequent Back dismisses the sheet according to its existing behavior

#### Scenario: Focus returns to the model control

- **WHEN** the picker closes after selection, its close action, or Back/Escape
- **THEN** focus returns to the model control in the sheet header
- **AND** the draft and conversation are unchanged

### Requirement: Model picker labels are localized

The mobile picker's title, close and settings actions, provider statuses, active state, setup guidance, and capability badges SHALL be localized in the product's supported locales (de, en, es, fr, ja, zh). The mobile picker SHALL NOT display hardcoded English labels.

#### Scenario: Non-English locale

- **WHEN** the interface language is German, French, Spanish, Japanese, or Chinese and the user opens the model picker
- **THEN** the picker title, statuses, active state, setup guidance, capability badges, and actions render in that language
