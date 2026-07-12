## ADDED Requirements

### Requirement: Volume rocker navigates the review session per user setting

When a user is in a review session and the interface setting "Volume Rocker Scroll" is set to a non-`none` mode, pressing the hardware volume up/down keys SHALL navigate or scroll the review content according to the selected mode, instead of the keys having no in-app effect. The behavior SHALL reuse the existing `volumeRockerScroll` setting (`"none" | "page" | "scroll"`) and the existing `handleVolumeRockerNavigation` helper, consistent with the other surfaces already wired (QueueScrollPage, RSSScrollMode, EPUBViewer, DocumentViewer).

#### Scenario: Setting is Disabled (none)
- **WHEN** `volumeRockerScroll` is `"none"` and the user presses VolumeUp or VolumeDown during a review session
- **THEN** the app does not intercept the key (system default volume behavior applies)
- **AND** no review navigation or scrolling occurs

#### Scenario: Setting is Page mode
- **WHEN** `volumeRockerScroll` is `"page"` and the user presses VolumeDown during a review session
- **THEN** the review advances to the next card/item (equivalent to the next-card action)
- **WHEN** the user presses VolumeUp
- **THEN** the review moves to the previous card/item
- **AND** key repeat (holding the key) does not skip multiple cards in a single press cycle

#### Scenario: Setting is Smooth Scroll mode
- **WHEN** `volumeRockerScroll` is `"scroll"` and the user presses VolumeDown while the current card or extract content is scrollable
- **THEN** the active scroll container scrolls down smoothly by a fixed delta
- **WHEN** the user presses VolumeUp
- **THEN** the active scroll container scrolls up smoothly by the same delta

### Requirement: Volume-rocker handling does not interfere with existing review shortcuts

Volume-rocker handling SHALL be inserted into the review session's keyboard handling such that it does not consume or block the existing review key bindings (Space to show answer, `1`–`4` to rate, `Cmd/Ctrl+Enter`, `Cmd/Ctrl+1-4`, `Cmd/Ctrl+E/D/S/H`, `Escape`). Volume keys (`VolumeUp`/`VolumeDown`) are distinct from all existing review shortcuts, so the two systems SHALL coexist without conflict.

#### Scenario: Existing shortcuts still work with volume scrolling enabled
- **WHEN** `volumeRockerScroll` is `"page"` or `"scroll"` and the user presses an existing review shortcut key (e.g. Space, or `1` to rate)
- **THEN** the existing review behavior fires exactly as before
- **AND** the volume-rocker handler does not alter or suppress that behavior

#### Scenario: Rating keys unaffected
- **WHEN** the answer is shown and the user presses `1`, `2`, `3`, or `4` to rate a card
- **THEN** the card is rated with the corresponding grade, regardless of the `volumeRockerScroll` setting

### Requirement: Scroll target resolution prefers the extract content

In scroll mode, when an Extract's content container is present (marked with `data-extract-scroll="true"`), the volume-rocker scroll SHALL target that inner container. When no such container is present (e.g. a plain flashcard), the scroll SHALL fall back to the review session's primary scroll container. This mirrors the scroll-target resolution used by the existing scroll-mode reading surfaces.

#### Scenario: Scrolling an Extract in review
- **WHEN** the current review item is an Extract with a `data-extract-scroll="true"` container and the user presses VolumeDown in scroll mode
- **THEN** that Extract content container scrolls down

#### Scenario: Fallback to session container
- **WHEN** the current review item has no `data-extract-scroll="true"` container and the user presses VolumeDown in scroll mode
- **THEN** the review session's primary scroll container scrolls down
