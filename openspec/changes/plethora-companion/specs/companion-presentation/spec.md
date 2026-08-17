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
