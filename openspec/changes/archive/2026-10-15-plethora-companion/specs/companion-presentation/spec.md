## ADDED Requirements

### Requirement: Non-obstructive overlay behavior
The companion SHALL render in an application-level overlay, stay within viewport bounds, respect mobile safe areas, and MUST NOT permanently cover essential controls, active inputs, selected text, open modals, or review rating controls.

#### Scenario: Exclusion zones
- **WHEN** the companion would move to a position overlapping a modal, focused input, or non-empty text selection
- **THEN** it remains at or returns to a safe position instead

#### Scenario: Viewport and safe areas
- **WHEN** the window is resized or mobile safe-area insets apply
- **THEN** the companion's position stays clamped inside the safe viewport

### Requirement: Accessibility and motion sensitivity
The companion SHALL honor `prefers-reduced-motion` and the app's reduced-motion/e-ink presentation modes; under reduced motion it SHALL use static states (no locomotion), and in e-ink mode it SHALL NOT render animated content. Decorative animation SHALL be `aria-hidden`; speech bubbles SHALL be readable and announced at most once on appearance.

#### Scenario: Reduced motion
- **WHEN** reduced motion is active
- **THEN** no walking/flying/hopping animation plays; optional speech bubbles may still appear

#### Scenario: E-ink mode
- **WHEN** e-ink display mode is active
- **THEN** the animated companion is not rendered

### Requirement: Performance bounds
The companion SHALL NOT run a continuous animation loop; animations SHALL use compositor-friendly CSS transforms with `requestAnimationFrame` only during explicit transitions, and the companion code SHALL be absent from the entry bundle when disabled.

#### Scenario: Idle cost
- **WHEN** the companion is idle
- **THEN** no rAF loop, timer churn, or store subscription storm is active beyond low-frequency event listening

#### Scenario: Lazy loading
- **WHEN** the companion setting is off
- **THEN** its component code is not loaded

### Requirement: Companion settings
Users SHALL be able to configure enable/disable, speech frequency, contextual reading comments, and study encouragement, located consistently with appearance/experience settings.

#### Scenario: Settings apply immediately
- **WHEN** a companion setting changes
- **THEN** behavior updates without restart

## ADDED Requirements

### Requirement: Direct manipulation
The companion SHALL be pickable-up-able and draggable via pointer events (mouse and touch), with a visible carried state while held, and dropping it SHALL produce physical behavior: drops near a perch point snap onto it; drops in open space descend with wing-flapping and then the bird flies to the nearest perch.

#### Scenario: Drag and drop onto a perch
- **WHEN** the user drags the bird and releases it within the snap radius of a perch point
- **THEN** the bird lands on that perch with a landing settle animation

#### Scenario: Dropped in open space
- **WHEN** the user releases the bird away from any perch
- **THEN** it flaps its wings while falling to the floor, pauses briefly, and flies to the nearest perch

#### Scenario: Reduced motion keeps direct manipulation but not animation
- **WHEN** reduced motion is active
- **THEN** the bird can still be dragged, but drops reposition instantly without fall/flight animation

### Requirement: Flight between perches
The companion SHALL fly along a deterministic arc between positions (explicit rAF transition only — no continuous loop), banking into its travel direction, and MAY wander between perch points of the app chrome at a low, bounded frequency when idle. Perch points SHALL be discoverable from explicit `[data-companion-perch]` opt-ins plus stable chrome surfaces, excluding dialogs and opt-out regions.

#### Scenario: Ambient wander
- **WHEN** the bird is idle and the ambient tick fires with wander probability
- **THEN** it flies to a different non-floor perch point

#### Scenario: Dialogs are never perches
- **WHEN** perch points are discovered while a modal is open
- **THEN** spots inside the dialog are excluded from the candidate set

### Requirement: Position persistence
The user-placed position of the companion SHALL persist across sessions (clamped to the viewport on restore) unless the companion is disabled.

#### Scenario: Restart remembers the perch
- **WHEN** the app restarts after the user moved the bird
- **THEN** the bird reappears at (or clamped within the viewport near) its last resting position
