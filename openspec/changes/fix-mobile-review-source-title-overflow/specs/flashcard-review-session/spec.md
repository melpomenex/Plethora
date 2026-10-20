## ADDED Requirements

### Requirement: Review source controls remain within the review card

The source-document strip and all of its content and actions SHALL remain inside the review card's content bounds and the available viewport from 320 CSS pixels wide upward, including narrow desktop panes, portrait and landscape layouts, and text enlarged to 200%. Long titles, unbroken text, page markers, source URLs, excerpts, and status messages SHALL NOT introduce horizontal page scrolling or overlap other review controls. Containment SHALL NOT be achieved by hiding interactive controls or their focus indicators.

#### Scenario: Long title on a narrow phone

- **GIVEN** a review card has a source titled `This Is Your Brain on Music: Understanding a Human Obsession`
- **WHEN** the card is displayed at phone widths of 320, 360, 390, or 430 CSS pixels
- **THEN** the source strip, visible title text, and every source action remain inside the padded card content area
- **AND** the source strip does not add horizontal page scrolling

#### Scenario: Unbroken text in expanded source information

- **GIVEN** a source has a long title without spaces, a long source URL, and a long excerpt
- **WHEN** the user expands its details in a narrow card
- **THEN** the full title, excerpt, and link text wrap within the card bounds
- **AND** the link and source actions remain reachable

#### Scenario: Increased text size and changing available width

- **WHEN** source controls are displayed with text enlarged to 200%, after rotation, or in a narrow desktop pane
- **THEN** their layout adapts to the available card width and grows vertically as needed
- **AND** the title, actions, and focus indicators remain contained without overlap

### Requirement: Compact source titles balance readability and full-title access

On compact layouts, a source title SHALL use up to two readable lines and visibly indicate omitted text with an ellipsis. A short title SHALL remain fully visible. The source icon, navigation cue, and available page number SHALL remain visible independently of title truncation. Every displayed source SHALL provide a separate source-details disclosure that reveals the complete wrapping title, including when no excerpt exists. Full-title access SHALL work through ordinary touch and keyboard input without depending on hover or long press.

#### Scenario: Title exceeds two lines

- **WHEN** a source title exceeds the two-line compact presentation
- **THEN** the title is ellipsized within the source control
- **AND** opening source details reveals the complete title without navigating away

#### Scenario: Long title without an excerpt

- **GIVEN** the source title is abbreviated and there is no saved excerpt
- **WHEN** the user activates source details
- **THEN** the complete title is displayed within the card bounds
- **AND** no empty excerpt placeholder is shown

#### Scenario: Page marker remains identifiable

- **GIVEN** a source has a page number and a long title
- **WHEN** the compact title is abbreviated
- **THEN** the page number remains visible outside the abbreviated title

### Requirement: Passage navigation and source details are distinct accessible actions

Activating the document-title area SHALL invoke passage navigation, while the separately labelled source-details disclosure SHALL only expand or collapse source information. The primary action SHALL expose the full document title and navigation purpose to assistive technology; the disclosure SHALL expose its expanded state and associated panel. Interactive source targets SHALL have visible keyboard focus, separated hit areas, and minimum target dimensions of 40 by 40 CSS pixels, increasing to 48 by 48 CSS pixels on coarse pointers. External source links SHALL be independent of both buttons, with no nested interactive controls.

#### Scenario: Tap the title to return to the originating passage

- **WHEN** the user taps the source document-title area
- **THEN** the existing passage-navigation flow is invoked once for the current card
- **AND** the action does not merely expand the excerpt

#### Scenario: Inspect source details without leaving review

- **WHEN** the user activates the source-details disclosure using touch or keyboard
- **THEN** the full title and available excerpt are expanded or collapsed inline
- **AND** the disclosure's accessible expanded state matches the visible panel
- **AND** the current card, answer-reveal state, typed response, and review progress remain unchanged

#### Scenario: Open the external source independently

- **GIVEN** expanded source details contain an external source link
- **WHEN** the user activates that link
- **THEN** the external source opens through the existing external-link behavior
- **AND** the passage-navigation and disclosure actions are not triggered

### Requirement: Source presentation preserves navigation outcomes and review continuity

The source presentation SHALL retain existing source visibility preferences, passage resolution, loading and failure feedback, keyboard navigation, and return-to-review behavior. Passage resolution SHALL remain lazy on navigation activation. A missing or unavailable source SHALL NOT break review or prevent access to any already-known title and excerpt.

#### Scenario: Source navigation is loading or unavailable

- **WHEN** source navigation is already resolving or reports an unavailable source
- **THEN** loading prevents duplicate default navigation and unavailable feedback remains understandable within the card bounds
- **AND** available source details remain accessible without a failed navigation

#### Scenario: Return to the same study state

- **GIVEN** the user opens the source from a review card with an answer-reveal state and any typed response
- **WHEN** the user returns from the source
- **THEN** the same card, reveal state, typed response, session position, and review progress are preserved

#### Scenario: Source context is disabled or absent

- **WHEN** the user has disabled source context or no source context is available for the card
- **THEN** neither the source strip nor an empty source-details control is displayed
