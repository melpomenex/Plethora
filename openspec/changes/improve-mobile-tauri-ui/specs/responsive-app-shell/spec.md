## ADDED Requirements

### Requirement: Stable form-factor classification
The system SHALL derive phone, tablet, compact-desktop, and desktop presentation from a shared reactive form-factor source. Native phones SHALL retain the phone presentation in either orientation, while tablets and desktop windows SHALL adapt when their usable viewport crosses the configured layout thresholds.

#### Scenario: Native phone rotates to landscape
- **WHEN** the native mobile app on a phone rotates from portrait to landscape
- **THEN** the system keeps the phone app shell and recomputes its available dimensions without rendering the desktop tab shell

#### Scenario: Tablet crosses the wide-layout threshold
- **WHEN** a tablet viewport becomes wide enough for the desktop workspace
- **THEN** the system switches to the wider layout once and preserves the active destination and user context

#### Scenario: Form factor changes during an active workflow
- **WHEN** the viewport crosses a layout threshold while a document, queue item, or review session is active
- **THEN** the system preserves the active content and does not create a duplicate tab, reset progress, or lose unsaved form state

### Requirement: Mobile navigation preserves destination context
The phone presentation SHALL provide persistent access to Dashboard, Queue, Review, Documents, and Settings, expose secondary destinations through a labeled overflow surface, and indicate the currently active destination. Activating an existing destination SHALL focus its existing tab rather than creating duplicates.

#### Scenario: User selects a primary destination
- **WHEN** the user activates a primary destination from the phone navigation
- **THEN** the destination becomes active, receives a visible selected state, and its existing tab is reused when present

#### Scenario: User opens a secondary destination
- **WHEN** the user selects RSS, Newsletter, Analytics, Podcast, or another supported secondary destination from the overflow surface
- **THEN** the overflow surface closes and the selected destination opens with a clear way to return or switch destinations

#### Scenario: Current destination is secondary
- **WHEN** a secondary destination is active
- **THEN** the phone navigation communicates that the overflow destination is active rather than incorrectly selecting an unrelated primary destination

### Requirement: Safe-area and viewport-aware layout
The responsive shell SHALL account for top, bottom, left, and right safe-area insets and SHALL use the dynamic visual viewport where available. Fixed navigation, primary actions, notifications, and fullscreen-reader controls MUST remain visible and MUST NOT obscure scrollable content.

#### Scenario: Device has a notch and home indicator
- **WHEN** the app runs on a device with non-zero top and bottom safe-area insets
- **THEN** interactive content clears both insets and scrollable content has sufficient end padding to remain visible above fixed controls

#### Scenario: Browser or native keyboard opens
- **WHEN** the on-screen keyboard reduces the visual viewport while a field is focused
- **THEN** the focused field and its relevant submit action remain visible without stacking duplicate safe-area padding

#### Scenario: Device orientation changes
- **WHEN** the device orientation changes
- **THEN** the shell recalculates viewport and inset usage without clipped content, a blank strip, or a double-applied inset

### Requirement: Touch-accessible interactions
All primary mobile controls SHALL provide a touch target of at least 44 by 44 CSS pixels or an equivalent hit area, SHALL expose an accessible name, and SHALL provide visible pressed, selected, focus, and disabled states. Essential actions MUST remain available without relying exclusively on hover, swipe, or long-press gestures.

#### Scenario: User operates controls by touch
- **WHEN** the user taps navigation, toolbar, queue, review, reader, or dialog controls
- **THEN** each target can be activated without overlapping an adjacent target and provides immediate visual feedback

#### Scenario: Gesture is unavailable
- **WHEN** a user cannot or does not use swipe or long-press gestures
- **THEN** every essential action exposed by those gestures is also available through a visible button or menu action

#### Scenario: Reduced motion is enabled
- **WHEN** the operating system requests reduced motion
- **THEN** shell transitions and gesture feedback avoid non-essential movement while preserving state feedback

### Requirement: Core screens adapt without content loss
Dashboard, Queue, Review, Documents, readers/viewers, Analytics, Search/Import, and Settings SHALL provide intentional phone and tablet layouts. At supported viewport widths, these surfaces MUST NOT cause page-level horizontal scrolling, hide a primary action, truncate essential status information without an accessible alternative, or require desktop-only pointer interactions.

#### Scenario: Dense desktop surface opens on a phone
- **WHEN** the user opens a screen that uses a table, multi-column grid, split pane, or toolbar on desktop
- **THEN** the screen substitutes a readable list, stacked sections, scroll-contained region, or progressive disclosure appropriate to the available width

#### Scenario: User performs a primary workflow one-handed
- **WHEN** the user reads or imports a document, manages a queue item, completes a review, or changes a common setting on a phone
- **THEN** the primary action is reachable, remains identifiable, and is not covered by navigation or the keyboard

#### Scenario: Tablet has intermediate space
- **WHEN** the app runs at a tablet-width viewport
- **THEN** the layout uses the additional space without forcing either a stretched phone layout or a clipped desktop layout

### Requirement: Responsive overlays and transient feedback
Dialogs, menus, command surfaces, toasts, and contextual panels SHALL adapt to the available viewport. On phones, task-focused dialogs SHALL use a sheet or near-fullscreen presentation where needed; on wider layouts they SHALL use bounded dialogs or popovers. Only the active modal surface SHALL receive interaction and focus.

#### Scenario: Mobile dialog contains a form
- **WHEN** a form dialog opens on a phone
- **THEN** it fits within the visual viewport, scrolls internally when necessary, keeps its title and completion action discoverable, and returns focus when closed

#### Scenario: Toast appears above fixed navigation
- **WHEN** transient feedback is displayed while the phone navigation or a reader control bar is visible
- **THEN** the feedback is readable, does not cover the primary action, and remains inside safe-area bounds

#### Scenario: User dismisses an overlay with the system back action
- **WHEN** an overlay is the topmost dismissible surface and the user invokes the platform back action
- **THEN** the system closes that overlay before navigating away from the underlying destination

### Requirement: Responsive accessibility and regression coverage
The responsive shell and representative core screens SHALL be validated at phone, tablet, compact-desktop, and desktop viewports with automated checks for navigation state, overflow, focus behavior, safe-area spacing, and essential workflow completion.

#### Scenario: Responsive test matrix runs
- **WHEN** the frontend validation suite runs
- **THEN** it exercises representative portrait phone, landscape phone, portrait tablet, compact desktop, and standard desktop dimensions

#### Scenario: Keyboard and screen-reader navigation is used
- **WHEN** a user navigates responsive controls with a keyboard or accessibility technology
- **THEN** focus order follows the visual task order, current navigation state is announced, and opening or closing an overlay moves focus predictably

