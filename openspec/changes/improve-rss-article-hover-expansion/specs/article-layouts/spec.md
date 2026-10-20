## MODIFIED Requirements

### Requirement: Thumbnail display options
The system SHALL allow users to configure thumbnail visibility and size. List thumbnail placement SHALL follow the existing presentation and size preferences, without requiring a new position setting: the article header SHALL retain headline width independently of thumbnails, which SHALL occupy a secondary region underneath the header. Existing Magazine and Grid thumbnail behavior SHALL remain unchanged.

#### Scenario: Hide thumbnails
- **WHEN** user disables "Show thumbnails" in the display settings
- **THEN** all layout modes hide article thumbnails and show a placeholder icon or no image
- **AND** List leaves no empty thumbnail column or gap

#### Scenario: Thumbnail position
- **WHEN** a small thumbnail is enabled in List card or list presentation
- **THEN** in List, an eligible small thumbnail appears to the left of source and preview information underneath the article header, without reducing headline width
- **AND** compact presentation continues hiding thumbnails
- **AND** Grid and Magazine retain existing thumbnail placement for their presentation and size settings

#### Scenario: List thumbnail size
- **WHEN** thumbnail display is enabled and the user changes thumbnail size in List
- **THEN** card presentation uses 96×64px small images or a full-width 160px-high body image for large images
- **AND** list presentation uses 64×48px small images or 96×64px large images beside the preview body
- **AND** images reserve their dimensions before loading and retain those dimensions through disclosure

## ADDED Requirements

### Requirement: Readable List article headers
List articles SHALL provide a readable headline independently of thumbnails, status indicators, and action controls. Below an actual list width of 720px, the headline SHALL occupy the full first header row and all eligible actions SHALL occupy a separate right-aligned, wrapping header row. At widths of 720px or greater, the headline and action regions SHALL share a header row with at least 240px available for the headline. Collapsed headlines SHALL use at most two visible lines; expanded headlines SHALL use at most four, with complete text available to assistive technology and in the reader.

#### Scenario: All controls in a narrow desktop pane
- **WHEN** a List pane is 420px wide, every existing action is eligible, and any supported density is active
- **THEN** the collapsed title region is at least 340px wide with ordinary scrollbar dimensions
- **AND** the headline remains readable without hovering
- **AND** actions and thumbnails do not consume any width from its header row

#### Scenario: Minimum supported narrow pane
- **WHEN** a List pane is 320px wide with every action eligible
- **THEN** the headline region is at least 240px wide
- **AND** all actions remain within the pane by wrapping within the header
- **AND** no horizontal overflow is introduced by titles, metadata, or action controls

#### Scenario: Breakpoint follows pane width
- **WHEN** the actual List width changes from 719px to 720px
- **THEN** the header changes from stacked title/actions to independently sized adjacent regions
- **AND** a desktop viewport with a 420px pane continues using the stacked header

#### Scenario: Pathological article text
- **WHEN** titles, feed names, or author names are unusually long or contain unbroken tokens
- **THEN** text wraps or truncates within its allocated region without displacing controls or forcing horizontal scrolling
- **AND** the full headline remains in the title control's accessible name

### Requirement: Intentional temporary List disclosure
List articles SHALL reveal richer information through deliberate fine-pointer hover or keyboard focus, independently of selection and read state. Pointer hover SHALL activate after 120ms of dwell following real pointer movement and SHALL not activate from touch, scrolling, or layout-only pointer entry. Expanded articles SHALL reveal additional title lines and allowed excerpt/author content. Leaving SHALL restore the collapsed presentation unless keyboard focus or an explicit details-toggle interaction still requests expansion.

#### Scenario: Hover and leave
- **WHEN** a user moves a fine pointer into a List card and remains for at least 120ms while the list is stationary
- **THEN** the card reveals additional content allowed by preferences
- **AND** leaving collapses it immediately if it has neither keyboard focus nor an explicitly opened details state
- **AND** article selection and read state do not change

#### Scenario: Rapid hover and scroll
- **WHEN** the pointer crosses multiple cards with less than 120ms dwell on each, or the user scrolls while the pointer remains over the list
- **THEN** no new hover preview opens during those transient visits or scrolling
- **AND** pending hover timers are canceled
- **AND** a new deliberate pointer movement is required to activate hover after scrolling stops

#### Scenario: Keyboard focus within a card
- **WHEN** keyboard focus enters a title, action, or details control
- **THEN** the card expands immediately and remains expanded while focus moves between its descendants
- **AND** focus leaving the card collapses it when there is no active pointer-hover reason
- **AND** focusing alone does not select, fetch, favorite, or mark the article read

#### Scenario: Selection remains independent
- **WHEN** a user selects an article through its title or noninteractive body
- **THEN** the existing reader and read-state behavior runs once
- **AND** selection alone does not keep the card expanded after its actual hover/focus interaction ends
- **AND** existing retention of newly read articles in an Unread session is preserved

### Requirement: Complete directly accessible List actions
Every eligible existing article action SHALL remain directly visible and available in the header in both disclosure states, with no overflow menu, opacity hiding, shrinking, or semantic change. The existing order SHALL remain fetch, favorite, open original, mark unread, train intelligence, tag; ineligible actions SHALL be omitted according to the existing conditions. Fine-pointer targets SHALL be at least 40×40px and coarse-pointer targets at least 48×48px. Actions SHALL retain existing tooltips, handlers, and propagation guards.

#### Scenario: Maximum eligible toolbar
- **WHEN** a read article without full content is displayed
- **THEN** all six existing commands and the separate details toggle are visible in its header before and after disclosure
- **AND** none reduces the headline below the documented minimum width

#### Scenario: Conditional controls
- **WHEN** an article has full content or is unread
- **THEN** the fetch control is absent when full content exists and the mark-unread control is absent when the article is unread
- **AND** remaining controls retain order and accessibility

#### Scenario: Commands do not bubble to article activation
- **WHEN** a user invokes fetch, favorite, original-link, unread, intelligence, or tag
- **THEN** the command's existing handler runs and no article activation occurs from event bubbling
- **AND** external opening retains its original navigation policy and default-prevention behavior
- **AND** tagging retains its intentional selection of item/feed and opening of the tag editor without marking read
- **AND** intelligence retains its existing selected-article menu semantics without introducing a new selection side effect

#### Scenario: Command state changes
- **WHEN** an article is favorited, marked unread, or receives full content
- **THEN** the star, read indicator, and conditional action availability update correctly
- **AND** the card remains correctly measured with the same focused control retained where that control still exists

### Requirement: Keyboard and touch access to List details
List cards SHALL provide a permanently available, named details toggle with an expanded state and associated detail region. A title SHALL be independently focusable and activate with native Enter/Space behavior, while inline actions SHALL remain independent native controls. Keyboard focus SHALL be visible, focus SHALL not be trapped, and native control activation SHALL not be intercepted by article shortcuts. Existing modified article shortcuts and context-menu access SHALL remain available.

#### Scenario: Touch details and first-tap navigation
- **WHEN** a touchscreen user taps the details control
- **THEN** allowed expanded information is available without selection, a read-state write, or reader navigation
- **AND** tapping it again collapses the card
- **AND** tapping title or noninteractive body opens the article on the first tap through existing mobile navigation

#### Scenario: Native keyboard control activation
- **WHEN** a user tabs through title and eligible controls and presses unmodified Enter or Space on a button
- **THEN** only that button's command activates once, even if the key has been remapped as an article shortcut
- **AND** an external anchor retains native Enter activation
- **AND** Tab advances normally and modified shortcuts such as Shift+Enter keep their existing behavior

#### Scenario: Dismiss while focus remains
- **WHEN** keyboard focus is in an expanded card and the user presses Escape or activates its expanded details toggle
- **THEN** the card collapses without moving focus or changing selection/read state
- **AND** the still-focused control does not immediately reopen it
- **AND** a new intentional focus entry or details-toggle activation can reopen it
- **AND** an already focused menu or dialog outside the card retains ownership of its own Escape handling

#### Scenario: Accessible names and state
- **WHEN** an assistive-technology user navigates the card
- **THEN** title, all eligible action controls, read/unread status, intelligence state, and details-toggle state have meaningful accessible names
- **AND** optional hidden details are absent from the accessibility tree while collapsed
- **AND** focus and selection remain distinguishable beyond color alone

### Requirement: Stable virtualized disclosure and scrolling
List disclosure SHALL support dynamic row heights while retaining virtualization for at least 1,000 articles. Row positions and total scrollable size SHALL follow actual measured content. Expanding visible rows SHALL not automatically scroll the list, overlap adjacent rows, or animate their positions. Changes wholly above the viewport SHALL preserve the visible scroll anchor within a one-pixel rounding allowance. Selection scrolling SHALL have a single authority in List and SHALL not smooth-scroll during dynamic resize.

#### Scenario: Dynamic row remeasurement
- **WHEN** disclosure, title/content updates, thumbnail failure, preference changes, or pane resizing changes a row's height
- **THEN** subsequent mounted rows start at or below the preceding row's bottom within a one-pixel rounding allowance on rendered frames
- **AND** the scrollable spacer contains the final virtual row
- **AND** repeated or rapid changes cause no overlapping rows or observer-loop warnings

#### Scenario: Scroll anchor correction
- **WHEN** a wholly above-viewport overscan row changes height
- **THEN** the first visible article retains its screen position within one pixel
- **AND** visible or partially visible row disclosure does not change scroll offset except when explicitly requested by existing selection/navigation

#### Scenario: Thousand-article responsiveness
- **WHEN** a user scrolls and hovers a deterministic 1,000-article List in a 420×800px viewport
- **THEN** at most 60 article cards are mounted simultaneously
- **AND** scrolling reaches later articles in order with correctly positioned rows
- **AND** the disclosure interaction introduces no main-thread task longer than 50ms in a local recorded stress trace
- **AND** disclosure does not require a whole-feed render, continuous height animation, or a new runtime dependency

### Requirement: Ephemeral disclosure across RSS scopes
Disclosure state and pending interaction timers SHALL belong to the current mounted article and scope. Switching feeds, collection, All/Unread/Favorites, folders, reading lists, tags, filters, sorting, search, or presentation SHALL clear stale disclosure even when an article ID appears in both scopes. Ordinary read/favorite updates and article selection within the same scope SHALL not reset keyboard focus.

#### Scenario: Shared article across scopes
- **WHEN** a card is expanded or has a pending hover and the user switches to another scope containing the same article
- **THEN** the destination row starts collapsed
- **AND** the previous timer cannot expand it or change selection/read state

#### Scenario: Unmount and recycling
- **WHEN** an expanded row scrolls out of the mounted range or its article is replaced
- **THEN** its disclosure state and timers are discarded
- **AND** a different or remounted article does not inherit that expansion

### Requirement: List preference and theme compatibility
List progressive disclosure SHALL respect the existing density, view presentation, thumbnail, excerpt-length, card-height, author, date, and feed-icon settings without adding a new preference. Collapsed cards SHALL defer excerpts and author to disclosure. Expanded excerpt budgets SHALL be zero for compact card height, three lines for normal, and four for tall, capped at two lines for compact view presentation; the existing 50–500-character excerpt cap SHALL also apply. Missing optional content SHALL not reserve empty regions. Themes SHALL use the application's existing colors and typography.

#### Scenario: Compact and comfortable preferences
- **WHEN** density changes between compact, normal, and comfortable
- **THEN** vertical/horizontal padding becomes 8/12px, 12/16px, and 16/20px respectively
- **AND** headline and action accessibility remain intact
- **AND** compact view presentation hides thumbnails in both disclosure states

#### Scenario: Excerpt and metadata preferences
- **WHEN** card height, excerpt length, author/date/icon visibility, or thumbnail settings change
- **THEN** the collapsed and expanded presentations follow the documented preference mapping
- **AND** compact card height never reveals an excerpt
- **AND** author is shown only when enabled, present, and expanded; date/icon only when enabled
- **AND** empty descriptions and unavailable images create no empty preview region

#### Scenario: Themes and reduced motion
- **WHEN** light, dark, or the existing legal-pad theme is active
- **THEN** cards and all interaction states use compatible theme tokens with no hardcoded yellow surface
- **AND** revealed content uses the existing short motion duration, normally 150ms, for opacity only
- **AND** reduced motion or disabled application animations makes that animation instantaneous
- **AND** row height, position, and padding are never animated

#### Scenario: Other RSS layouts remain compatible
- **WHEN** the user switches to Magazine or Grid or opens an article in the reader or scroll mode
- **THEN** those surfaces retain their existing layouts, preferences, selection, actions, and context-menu behavior
- **AND** no List disclosure state or scoped style leaks into them
