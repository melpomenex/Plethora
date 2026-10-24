## Purpose

Keep essential audio controls available throughout reading and study without obstructing content, navigation, annotation, or review actions on desktop and Android.

## ADDED Requirements

### Requirement: Persistent shell placement and visibility
A loaded supported session SHALL have a bottom-docked mini player on desktop and a compact dock above mobile navigation on Android. It SHALL remain available for paused, loading, recoverable-error and ended sessions until explicitly stopped and closed, except temporary keyboard/modal/fullscreen presentation suppression. The shell SHALL reserve its measured occupied space and count safe-area insets exactly once. Source-view visibility SHALL NOT determine player visibility.

#### Scenario: Player appears on a small laptop
- **WHEN** audio is loaded at 1280 by 720 pixels with interface zoom at 150 percent
- **THEN** essential transport controls remain reachable without horizontal clipping or covering source content and sidebar/footer actions

#### Scenario: Mobile dock above navigation
- **WHEN** a session is loaded on a 320-pixel-wide Android phone with a bottom safe-area inset
- **THEN** the dock sits above navigation, all transport targets remain reachable, and neither reading controls nor system/navigation targets overlap it

#### Scenario: Modal, keyboard and rotation
- **WHEN** a modal opens, a text input invokes the keyboard, or a phone rotates during playback
- **THEN** presentation adapts to the visible viewport without changing active audio or stealing input/scroll state
- **AND** suppressed controls return when appropriate without duplicate safe areas or an unexpected reading-position jump

### Requirement: Clear source-aware essential controls
The mini player SHALL show stable artwork or fallback, title, available chapter/episode metadata, play/pause, elapsed/progress indication, expand access and stop-and-close access. Book, Audio Edition and podcast visible seek controls SHALL use 30 seconds backward/forward; recording controls SHALL use 10 seconds backward and 30 seconds forward. Queue access SHALL be available when a queue exists. Seek controls SHALL NOT accidentally select chapters or queue items.

#### Scenario: Podcast skip controls
- **WHEN** a user activates the podcast mini player's forward seek
- **THEN** playback moves forward 30 media seconds within or across known parts
- **AND** the action does not select another episode

#### Scenario: Missing art and long title
- **WHEN** an item has unavailable artwork and a title longer than the available row width
- **THEN** a stable source-appropriate fallback renders and the title truncates visually while retaining its full accessible name

#### Scenario: Stop versus collapse
- **WHEN** a user selects Stop and close
- **THEN** audio pauses, progress is saved, resources and OS session are released, and the mini player hides
- **AND** collapsing the expanded player instead leaves playback and the mini player active

### Requirement: Expansion preserves the user's task
Opening the expanded player SHALL show controls for the same active session without navigating the underlying task or creating a second engine. Back/Escape SHALL collapse the expanded player before leaving the current task and restore focus to a visible invocation control or safe fallback. Navigation to the source entry SHALL be a separate explicit action.

#### Scenario: Flashcard review expansion
- **WHEN** a user opens and closes the expanded player during an ungraded review card
- **THEN** the current card, answer state, grading controls and review session remain intact
- **AND** keyboard focus returns predictably without grading a card

### Requirement: Accessible and theme-consistent controls
Controls SHALL use visible keyboard focus, descriptive localized labels and semantic names/state. Targets SHALL be at least 40 pixels on desktop and 48 pixels for coarse-pointer/mobile use. Text contrast SHALL meet 4.5:1 and meaningful nontext control/progress contrast 3:1 in supported light, dark, custom and high-contrast themes. Reduced motion SHALL be respected. Global player shortcuts SHALL NOT capture text editing, reading or flashcard commands. Screen readers SHALL receive meaningful source/error/state changes without tick announcements.

#### Scenario: Keyboard and screen-reader operation
- **WHEN** a user tabs through mini-player controls and operates transport and the expanded scrubber
- **THEN** each action is named with its behavior and skip interval, focus stays visible, and elapsed/total time is available as human-readable slider value text
- **AND** position updates do not produce continuous live announcements

#### Scenario: Review and typing shortcuts
- **WHEN** focus is in a note editor, contenteditable article area or flashcard review
- **THEN** ordinary typing, Space and arrow actions retain their existing behavior unless a player control itself is focused

### Requirement: Non-obstructive static rendering
The mini player SHALL use existing semantic design tokens and a static opaque surface without backdrop blur, visualizers, animated artwork or continuous progress animation. It SHALL NOT intercept reader scrolling, selection, highlighting, annotations or flashcard creation outside its controls. Steady playback SHALL NOT cause layout shifts.

#### Scenario: Reader annotation near bottom edge
- **WHEN** a user highlights text and opens annotation or flashcard actions beside the dock
- **THEN** content and floating actions respect reserved geometry and remain fully usable
- **AND** no player hit region extends over the reading surface
