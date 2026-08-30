## ADDED Requirements

### Requirement: Intelligent narration follow
When `followSpokenWord` is enabled, the reader SHALL scroll to keep the spoken word visible using debounced, comfort-band scrolling rather than scrolling on every word transition.

#### Scenario: Comfort band prevents micro-scroll
- **WHEN** the spoken word remains inside the viewport comfort band
- **THEN** the system SHALL NOT trigger a scroll

#### Scenario: Word near edge triggers follow
- **WHEN** the spoken word approaches the viewport boundary
- **THEN** the system SHALL scroll smoothly to maintain a comfort offset above center

### Requirement: User scroll suspends follow
Manual scrolling during TTS SHALL suspend auto-follow while playback and highlighting continue.

#### Scenario: User scroll pauses follow
- **WHEN** the user scrolls manually during TTS
- **THEN** auto-follow SHALL pause until the user explicitly re-centers

### Requirement: Re-center affordance
The reader SHALL provide a way to return the viewport to the currently spoken word and resume following.

#### Scenario: Re-center restores follow
- **WHEN** the user invokes re-center while follow is paused by manual scroll
- **THEN** the viewport SHALL scroll to the active highlight and resume auto-follow

### Requirement: E-ink and reduced motion
On e-ink displays or when reduced motion is preferred, narration follow SHALL use instant positioning without smooth scroll animation.

#### Scenario: E-ink instant scroll
- **WHEN** e-ink mode is active and follow triggers
- **THEN** scroll SHALL use `behavior: auto` not smooth animation

### Requirement: Follow does not move accessibility focus
Narration follow scrolling SHALL NOT move screen reader focus or keyboard focus as words change.

#### Scenario: Focus unchanged during follow
- **WHEN** auto-follow scrolls to the spoken word
- **THEN** accessibility focus SHALL remain on the user's current focus target
