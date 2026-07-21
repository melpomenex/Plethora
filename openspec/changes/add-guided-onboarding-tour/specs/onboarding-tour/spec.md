## ADDED Requirements

### Requirement: Chapter-based tour structure

The tour SHALL be organised as an ordered list of chapters, each containing one or more steps. Each step SHALL declare a title, body copy, an optional anchor ID, a placement preference, and an optional illustrative micro-animation. The tour SHALL expose the current chapter, the current step index within the tour, and total step count so the user always knows where they are.

#### Scenario: Chapter progress is visible

- **WHEN** the tour is open on any step
- **THEN** a chapter rail lists every chapter, marks completed chapters as done, marks the current chapter as active, and shows the current step position within the overall tour

#### Scenario: Jumping to a chapter

- **WHEN** the user selects a chapter from the chapter rail
- **THEN** the tour advances or rewinds to the first step of that chapter, resolves that step's anchor, and animates the spotlight to it

#### Scenario: Chapters cover the app's primary surfaces

- **WHEN** the tour definition is loaded
- **THEN** it contains chapters covering, at minimum: welcome/orientation, importing documents, reading and creating extracts, the queue, the review session, insights (analytics and Knowledge Sphere), and settings/customisation

### Requirement: Spotlight anchoring to live UI

Steps with an anchor SHALL highlight the real, currently rendered DOM element carrying the matching `data-tour` attribute. The overlay SHALL dim the rest of the interface, leave the anchored element visually revealed, and position the coach mark adjacent to it without covering it.

#### Scenario: Anchored step highlights its element

- **WHEN** a step with anchor `documents-import-button` becomes active and an element with `data-tour="documents-import-button"` is present and visible
- **THEN** the overlay cuts a spotlight around that element's bounding box with padding, and the coach mark renders on the step's preferred side

#### Scenario: Coach mark stays on screen

- **WHEN** the preferred placement would render the coach mark partially outside the viewport
- **THEN** the coach mark flips or shifts to the nearest placement that fits fully within the viewport

#### Scenario: Anchor is scrolled into view

- **WHEN** a step's anchor element is outside the visible scroll area
- **THEN** the tour scrolls the element into view before drawing the spotlight

#### Scenario: Anchor geometry follows layout changes

- **WHEN** the window is resized, a pane is split, or the anchor element moves while a step is active
- **THEN** the spotlight and coach mark reposition to the anchor's new bounding box

### Requirement: Adaptive and resilient anchor resolution

Every anchor ID SHALL be declared in a single typed anchor catalogue. A step MAY declare an ordered list of candidate anchor IDs. The tour SHALL resolve to the first candidate that is present and visible, and SHALL degrade rather than fail when none resolve.

#### Scenario: Viewport-specific anchor

- **WHEN** a step declares candidates `[nav-queue-desktop, nav-queue-mobile]` and only the mobile navigation is rendered
- **THEN** the tour anchors to `nav-queue-mobile`

#### Scenario: No candidate resolves

- **WHEN** none of a step's candidate anchors are present in the DOM
- **THEN** the tour renders that step as a centred, unanchored card instead of pointing at empty space, and no error is surfaced to the user

#### Scenario: Optional step is skipped

- **WHEN** a step is marked `requiresAnchor: true` and none of its candidate anchors resolve
- **THEN** the tour skips that step entirely in both forward and backward navigation, and the step is excluded from the displayed total step count

#### Scenario: Anchor catalogue is authoritative

- **WHEN** the test suite runs
- **THEN** a test asserts that every anchor ID referenced by any step exists in the anchor catalogue, failing the build if a step references an unknown ID

### Requirement: Step navigation

The user SHALL be able to move forward and backward through steps, and the tour SHALL end cleanly on the final step.

#### Scenario: Advancing

- **WHEN** the user clicks "Next" or presses `→` / `Enter`
- **THEN** the tour advances to the next non-skipped step and animates the spotlight to its anchor

#### Scenario: Going back

- **WHEN** the user clicks "Back" or presses `←` on any step after the first
- **THEN** the tour returns to the previous non-skipped step

#### Scenario: Back is unavailable on the first step

- **WHEN** the tour is on its first step
- **THEN** the "Back" control is disabled and `←` does nothing

#### Scenario: Finishing the tour

- **WHEN** the user clicks "Done" on the final step
- **THEN** the tour closes, the overlay is removed, focus returns to the element focused before the tour opened, and the tour is recorded as completed

### Requirement: Skipping is always available and never nags

A skip control SHALL be visible on every step. Skipping SHALL close the tour immediately without a confirmation dialog.

#### Scenario: Skip control

- **WHEN** the user clicks "Skip tour" on any step
- **THEN** the tour closes immediately with no confirmation prompt and is recorded as skipped

#### Scenario: Escape key

- **WHEN** the user presses `Esc` while the tour is open
- **THEN** the tour closes immediately and is recorded as dismissed

#### Scenario: Clicking outside the coach mark

- **WHEN** the user clicks the dimmed overlay outside the coach mark and outside the spotlight
- **THEN** the tour closes immediately and is recorded as dismissed

#### Scenario: No confirmation nag

- **WHEN** the tour is closed by any means
- **THEN** no "are you sure?", "you'll miss out", or re-engagement prompt is shown

### Requirement: Resume from last position

Closing the tour before completion SHALL preserve the furthest step reached so a later opening resumes there rather than restarting.

#### Scenario: Resuming after dismissal

- **WHEN** the user dismisses the tour on step 6 and later opens the tour again from Settings
- **THEN** the tour opens on step 6

#### Scenario: Completed tour restarts from the beginning

- **WHEN** the user completed the tour previously and opens it again on demand
- **THEN** the tour starts at step 1 with progress reset

#### Scenario: Stale resume position

- **WHEN** a stored resume position refers to a step index that no longer exists in the current tour definition
- **THEN** the tour opens at step 1 instead of failing

### Requirement: Motion design respects reduced-motion

The tour SHALL animate spotlight travel between anchors, coach-mark entrance and exit, and per-step illustrative micro-animations. All motion SHALL be suppressed when reduced motion is active.

#### Scenario: Animated spotlight travel

- **WHEN** the user advances to a step whose anchor is a different element, and reduced motion is not active
- **THEN** the spotlight cutout animates from the previous bounding box to the new one, and the coach mark fades and translates into its new position

#### Scenario: Reduced motion

- **WHEN** `PresentationContext.reducedMotion` is true
- **THEN** spotlight movement, coach-mark transitions, and step micro-animations are replaced by instant repositioning with no translation or scaling, and looping decorative animations do not play

#### Scenario: Animation does not block interaction

- **WHEN** a transition between steps is in flight
- **THEN** the Next, Back, and Skip controls remain responsive and a rapid sequence of clicks lands on the correct final step without visual artefacts

### Requirement: Accessibility

The tour overlay SHALL be operable by keyboard and comprehensible to screen readers.

#### Scenario: Focus is trapped in the coach mark

- **WHEN** the tour is open and the user presses `Tab` repeatedly
- **THEN** focus cycles only among the coach mark's interactive controls and does not reach the dimmed application behind it

#### Scenario: Step change is announced

- **WHEN** the active step changes
- **THEN** the coach mark is labelled as a dialog with the step title as its accessible name, and the new step's title and body are announced via a live region

#### Scenario: Focus restoration

- **WHEN** the tour closes by any means
- **THEN** keyboard focus returns to the element that had focus before the tour opened

#### Scenario: Spotlight contrast

- **WHEN** the overlay is displayed in either light or dark theme
- **THEN** the coach mark text meets WCAG AA contrast against its own background, independent of the dimmed content behind it

### Requirement: Single onboarding surface

The application SHALL present exactly one onboarding experience. Pre-existing unwired onboarding components SHALL NOT be mounted alongside the tour.

#### Scenario: No competing modals at startup

- **WHEN** the app starts and the tour auto-opens
- **THEN** no separate welcome screen, interactive tutorial, or algorithm-explanation modal opens at the same time

#### Scenario: Superseded components removed from the tree

- **WHEN** the change is implemented
- **THEN** `WelcomeScreen`, `InteractiveTutorial`, and `FSRSExplanationModal` are either deleted or reachable only as content rendered inside the tour, and no other startup path mounts them

### Requirement: Tour never blocks or mutates user data

The tour SHALL be a purely presentational overlay. It SHALL NOT create, modify, or delete documents, extracts, queue entries, or review state.

#### Scenario: No side effects

- **WHEN** the user completes the full tour on a populated library
- **THEN** no document, extract, collection, queue entry, or scheduling record is created, modified, or deleted

#### Scenario: Navigation during the tour is non-destructive

- **WHEN** a step navigates the app to a different view to show it
- **THEN** the previously active view and tab state are restored when the tour closes
