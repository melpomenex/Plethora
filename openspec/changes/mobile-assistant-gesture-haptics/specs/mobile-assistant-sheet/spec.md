## Purpose

Give mobile users a deliberate, accessible Assistant entry and directly manipulated conversation sheet that coexists with established navigation, readers and system gestures.

## ADDED Requirements

### Requirement: Dedicated mobile invocation owner
The application SHALL expose one accessible Assistant pill in eligible mobile views, above visible bottom navigation and outside screen-edge and Home safe areas. Tap SHALL open the Assistant without navigating away or automatically showing the keyboard. Only an upward gesture whose initial contact is directly on the visible pill SHALL be eligible for gesture invocation. The surrounding positioning area SHALL NOT intercept input. Desktop presentation SHALL retain existing behavior.

#### Scenario: Ordinary accessible tap
- **GIVEN** the mobile library is visible and the pill is eligible
- **WHEN** the user taps or accessibly activates Assistant
- **THEN** one sheet opens over the same library view
- **AND** the keyboard and microphone remain inactive

#### Scenario: Document movement cannot invoke
- **GIVEN** a touch begins outside the pill on a PDF, EPUB, article, horizontal list or blank content
- **WHEN** it moves upward, horizontally, or across the pill
- **THEN** the Assistant remains closed and existing content interaction retains ownership

#### Scenario: One general entry
- **WHEN** the mobile reader or Queue view already exposes a general Assistant action
- **THEN** that action opens the same global sheet and no second floating Assistant trigger is shown

### Requirement: Threshold-based direct manipulation
A valid upward drag SHALL reveal the sheet in continuous relation to finger displacement after intentional upward direction is recognized. The activation threshold SHALL be 12 percent of usable visible height clamped to 64–96 CSS pixels. Release SHALL commit only when current upward displacement meets that threshold. Directionally rejected or cancelled drags SHALL NOT become taps. Velocity SHALL NOT bypass the threshold.

#### Scenario: Qualifying release
- **GIVEN** contact started on the pill and earned upward ownership
- **WHEN** release displacement is at least the threshold
- **THEN** the sheet settles from its current reveal into the initial usable open detent
- **AND** no route, tab or reading-position change occurs

#### Scenario: Short drag
- **WHEN** a recognized pill drag releases below threshold
- **THEN** the preview returns to closed without opening a conversation or producing a tap action

#### Scenario: Reverse after arming
- **GIVEN** a drag crossed threshold
- **WHEN** it reverses below threshold and releases
- **THEN** it cancels and the sheet remains closed

#### Scenario: Terminal interruption
- **WHEN** an invocation receives pointer cancellation, capture loss, additional contact, backgrounding, owner change or viewport geometry change
- **THEN** the gesture is invalidated and cannot commit from a later pointer event or animation callback

### Requirement: Adaptive sheet detents and handle ownership
The sheet SHALL provide closed, partial and expanded states. Partial height SHALL be at least 320 CSS pixels or 45 percent of usable visible height, capped by expanded height; expanded SHALL use at most 90 percent of usable visible height. Where these stops are less than 96 pixels apart or enlarged text makes partial unusable, one expanded open stop SHALL be used. Only the handle SHALL own drag resizing; content SHALL retain scrolling, text selection and control interaction. Each completed handle drag SHALL change at most one state. Close and scrim controls SHALL dismiss directly.

#### Scenario: Expand then collapse
- **GIVEN** two usable open detents
- **WHEN** the user drags the partial sheet handle upward sufficiently and releases
- **THEN** the sheet expands
- **WHEN** the expanded handle is dragged downward sufficiently and released
- **THEN** the sheet returns to partial without erasing the conversation

#### Scenario: Dismiss from partial
- **WHEN** a sufficiently long downward handle drag ends from partial
- **THEN** the sheet returns to the pill with underlying reading position intact

#### Scenario: Scroll is not dismissal
- **WHEN** the user scrolls history or selects answer text, including at a scroll boundary
- **THEN** the sheet does not resize or dismiss and background scrolling does not chain

#### Scenario: Short landscape viewport
- **WHEN** two accessible detents cannot fit in the usable landscape viewport
- **THEN** a single expanded stop keeps header, close, scope controls and composer reachable

### Requirement: Existing Back and system gestures remain authoritative
The Assistant SHALL participate as an overlay in existing Back coordination and SHALL NOT change edge recognition, native Android Back/predictive dispatch, root behavior, or navigation history. The left-edge fallback and native Android gating SHALL remain unchanged. Both Android screen edges and OS Home areas SHALL remain available to their existing owners. A committed Back SHALL close or cancel the top eligible Assistant surface exactly once before underlying navigation; higher dialogs, native IME/fullscreen and system pickers SHALL retain existing precedence.

#### Scenario: Existing left-edge behavior while closed
- **GIVEN** the Assistant is closed on a platform using the edge fallback
- **WHEN** a qualifying left-edge Back gesture occurs on an eligible existing target
- **THEN** existing Back behavior occurs once, with unchanged exclusions and distance rules

#### Scenario: Native Android from both sides
- **GIVEN** Android gesture navigation and an open Assistant
- **WHEN** the user commits native Back from either edge
- **THEN** the Assistant closes once through the existing native coordinator and the underlying view remains

#### Scenario: Predictive cancellation
- **WHEN** the user cancels a supported predictive Back gesture before commit
- **THEN** no Assistant state, view history, haptic completion or reading position changes

#### Scenario: Assistant cannot navigate
- **WHEN** a pill or handle gesture succeeds, fails recognition or cancels
- **THEN** it does not dispatch Back, tab selection, document page navigation or unrelated routing

#### Scenario: Higher overlay and keyboard
- **GIVEN** a modal above the Assistant or a native keyboard consuming Back
- **WHEN** Back is requested
- **THEN** the higher existing owner handles it first and the Assistant does not double-dismiss

### Requirement: Availability follows interaction and viewport ownership
Invocation SHALL be suspended while a higher modal, selection workflow, active grading gesture, unrelated keyboard or fullscreen media owns interaction. Fullscreen reading SHALL expose invocation with existing revealed controls, or an explicit exit-fullscreen-and-open action when a shell overlay cannot be displayed. No new reader-wide reveal gesture SHALL be added. Keyboard adjustment SHALL keep the composer within the visible viewport without duplicate inset application; passive viewport changes SHALL NOT count as user detent gestures.

#### Scenario: Fullscreen media
- **WHEN** native fullscreen video is active
- **THEN** no invisible pill hit area overlays its controls or Home area
- **AND** the existing media exit path remains usable

#### Scenario: Fullscreen reader entry
- **WHEN** the user reveals existing fullscreen reader controls and invokes their Assistant action
- **THEN** the same Assistant opens, exiting fullscreen first when necessary, without losing reading position

#### Scenario: Composer keyboard
- **WHEN** the user focuses the composer and the keyboard changes visible height
- **THEN** the composer stays visible and the sheet adjusts silently within safe areas

### Requirement: Accessible and responsive presentation
Tap, keyboard and assistive activation SHALL provide the complete invocation flow. The sheet SHALL have a name, focus containment, explicit Close/Expand/Collapse controls, focus restoration and non-haptic state indications. Controls SHALL have at least 48 CSS-pixel touch targets. Reduced-motion preferences SHALL remove spring settlement while retaining usable direct manipulation. Drag rendering SHALL NOT perform AI/context extraction or rerender the conversation on every movement frame.

#### Scenario: VoiceOver or TalkBack
- **WHEN** a screen-reader user explores then activates the pill and later Close
- **THEN** exploration alone does not start a drag, activation opens a named sheet, and closing restores usable focus

#### Scenario: Reduced motion and haptics off
- **GIVEN** reduced motion and disabled haptics
- **WHEN** the user opens, expands and dismisses the Assistant
- **THEN** all states remain visually and accessibly distinguishable without spring motion or vibration

#### Scenario: Reader load
- **WHEN** invocation runs while a representative large PDF renders or video plays
- **THEN** reveal continues to track the finger without document remount, extraction on movement, or unrelated reading-position mutation
