## ADDED Requirements

### Requirement: Follow the spoken word during playback
While TTS is playing and follow mode is active, the reader SHALL keep the active spoken word comfortably visible using the transcript auto-follow semantics: the active word is kept at a comfortable reading position above the vertical center, movement is debounced/coalesced (not on every DOM mutation or animation frame), scrolling is skipped when the word is already comfortably visible, and follow works across EPUB iframe sections, PDF pages, reflow, and scroll-based readers. Follow behavior SHALL be a persisted user preference separate from the highlight preference.

#### Scenario: Spoken word follows normally
- **WHEN** TTS plays through consecutive paragraphs with follow active
- **THEN** the viewport keeps the spoken word comfortably visible with coalesced, non-jittery scrolling

#### Scenario: PDF continuation and EPUB chapter bridging preserved
- **WHEN** follow is active and playback crosses a PDF page boundary or an EPUB chapter boundary
- **THEN** following continues into the new page/chapter and existing auto-advance behavior is preserved

### Requirement: User scroll pauses following without stopping playback
If the user deliberately scrolls away while TTS continues, the system SHALL interpret it as intentional: auto-follow pauses (no forced snapping back), while playback and spoken-word highlighting continue. A "Re-center" affordance SHALL be exposed while follow is paused; pressing it returns the viewport to the currently spoken word and resumes following. The detection of deliberate user scrolling SHALL distinguish programmatic follow scrolls from real user input (arrival-based detection with real-input override), consistent with the transcript sync behavior.

#### Scenario: Manual exploration during listening
- **WHEN** TTS is reading page 20 with follow active and the user scrolls ahead to page 22
- **THEN** auto-follow pauses, playback of page 20 continues, and the spoken word continues to be highlighted

#### Scenario: Re-center restores follow
- **WHEN** follow is paused by user scroll and the user presses Re-center
- **THEN** the viewport returns to the currently spoken word and following resumes

#### Scenario: Programmatic scroll is not mistaken for user intent
- **WHEN** the follow controller performs its own smooth scroll
- **THEN** it is not interpreted as deliberate user scrolling and follow remains active

### Requirement: Passive scrolling never retargets playback
Manual scrolling during active playback SHALL only affect the viewport. It MUST NOT change what is being spoken. Retargeting playback happens exclusively through explicit operations: pressing Play from a stopped state (starts at the current view), invoking "Read from here", or intentional TOC navigation during playback.

#### Scenario: Manual scroll does not retarget
- **WHEN** the user scrolls elsewhere while TTS is playing
- **THEN** the spoken content is unchanged and no retarget occurs

### Requirement: Reduced motion and e-ink handling
Follow scrolling and spoken-word emphasis SHALL respect the app's reduced-motion presentation state (including e-ink mode): smooth scrolling is replaced with instant positioning, and no unnecessary animation is applied. Follow scrolling SHALL NOT run while playback is stopped.

#### Scenario: Reduced-motion instant scrolling
- **WHEN** reduced motion is enabled (system preference or e-ink mode) and follow repositions the viewport
- **THEN** positioning is instant without smooth-scroll animation

#### Scenario: No follow work while stopped
- **WHEN** playback is stopped or the reader is hidden/unmounted
- **THEN** no follow scrolling or update loops run
