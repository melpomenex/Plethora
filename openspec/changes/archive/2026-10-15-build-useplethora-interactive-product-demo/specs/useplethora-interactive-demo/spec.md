## ADDED Requirements

### Requirement: Demo is a closed, deterministic state machine
The interactive demo SHALL implement the shared `DemoStage` happy path, remain fully client-side after assets load, and SHALL NOT call Plethora APIs, auth, or inference backends.

#### Scenario: Primary path
- **WHEN** a visitor starts the demo and only follows primary controls
- **THEN** they visit library, item, reader, passage, explain, remember-confirm, card, review-prompt, review-reveal, review-rate, schedule, and complete without dead ends

### Requirement: Device chrome is honest
The interactive demo SHALL present iPhone and Android shells sharing one state model, defaulting from platform hints, with a visible toggle. It SHALL NOT imply OS-only features the product does not have.

#### Scenario: Toggle
- **WHEN** the visitor switches from iPhone to Android chrome
- **THEN** demo stage and content kind are preserved

### Requirement: Every visible control works
Every control that appears interactive SHALL have a defined response (action, disabled reason, or explanation). Decorative mascot SHALL be `aria-hidden` unless it is the only indicator of Peck, in which case the list alternative describes the Peck.

#### Scenario: Dummy button forbidden
- **WHEN** a control is rendered in the demo
- **THEN** activating it either advances/resets the machine or is `disabled` with an accessible name that explains why

### Requirement: Accessible without motion or pointer
The demo SHALL be operable by keyboard, SHALL expose a screen-reader-readable description of the flow, SHALL honor `prefers-reduced-motion`, and SHALL keep a static HTML fallback for the story.

#### Scenario: Reduced motion
- **WHEN** reduced motion is requested
- **THEN** stage changes still occur without Peck/parallax and content remains readable

### Requirement: Performance isolation
Demo JavaScript SHALL load lazily (on visible or on CTA) and SHALL NOT be required for homepage hero LCP.

#### Scenario: Hero without demo chunk
- **WHEN** the homepage first paints
- **THEN** hero text and primary images can render before the demo chunk downloads
