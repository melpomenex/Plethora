## ADDED Requirements

### Requirement: Flashcard Studio primary action is reachable on mobile

When the AI Flashcard Studio modal is open on a mobile-shell presentation (phone or tablet), its primary footer action (Send / Save Selected) SHALL render fully above the mobile bottom navigation and be directly tappable by the user. The modal backdrop SHALL establish a stacking order higher than the mobile bottom navigation (`z-index: 1000`) and the generic overlay ladder (`--overlay-backdrop-z`, `--overlay-sheet-z`).

#### Scenario: Modal opens above the bottom nav on mobile
- **WHEN** a user opens the Flashcard Studio from any "Create Flashcard" trigger while in mobile-shell presentation
- **THEN** the modal backdrop and panel render above the mobile bottom navigation bar
- **AND** the footer primary action button is not occluded by the bottom navigation

#### Scenario: Action button is tappable
- **WHEN** the Flashcard Studio is open on mobile and the user taps the Send (or Save Selected) button
- **THEN** the tap registers and the corresponding action fires (no dead zone over the bottom nav)

### Requirement: Flashcard Studio footer accounts for the bottom nav height

The Flashcard Studio footer bottom padding SHALL include the mobile bottom navigation height (via the existing `--shell-mobile-nav-height` variable) in addition to the safe-area inset, so the primary action physically clears the nav bar regardless of z-index ordering. On desktop, where `--shell-mobile-nav-height` resolves to `0px`, the footer layout SHALL be visually unchanged.

#### Scenario: Footer clears the nav bar on mobile
- **WHEN** the Flashcard Studio is open on a phone/tablet presentation
- **THEN** the footer's bottom padding is at least the sum of the safe-area inset and the mobile nav height
- **AND** the primary action button's bounding box does not overlap the bottom navigation's bounding box

#### Scenario: Desktop footer is unchanged
- **WHEN** the Flashcard Studio is open on desktop presentation
- **THEN** the footer bottom padding is identical to the previous desktop layout (no extra nav-height offset is applied)

### Requirement: Flashcard Studio nested overlays remain stacked above the backdrop

The modal's in-context nested overlays (Image Registry, Keyboard Shortcuts) SHALL render above the Flashcard Studio backdrop/panel, preserving their existing relative stacking order, after the backdrop z-index is raised.

#### Scenario: Image Registry opens above the studio
- **WHEN** the Flashcard Studio is open on mobile and the user opens the Image Registry overlay
- **THEN** the Image Registry renders above the studio panel and is fully visible and tappable

#### Scenario: Keyboard Shortcuts opens above the studio
- **WHEN** the Flashcard Studio is open on mobile and the user opens the Keyboard Shortcuts overlay
- **THEN** the Keyboard Shortcuts overlay renders above the studio panel
