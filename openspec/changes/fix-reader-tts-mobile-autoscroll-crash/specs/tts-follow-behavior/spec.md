## ADDED Requirements

### Requirement: Single-owner follow controller
Reader TTS viewport movement SHALL have exactly one authoritative follow controller (`useSpokenWordFollow`). Spoken-word highlight rendering (`WordHighlighter`) and document viewer containers SHALL NOT independently issue viewport scroll commands, track scroll targets, or register user-scroll listeners for auto-follow.

#### Scenario: Spoken word crosses viewport boundary
- **WHEN** narration reaches a word outside the current visible viewport
- **THEN** exactly one subsystem (`useSpokenWordFollow`) issues a scroll command, and no competing scroll requests are dispatched by the highlighter

#### Scenario: Single scroll target execution
- **WHEN** the spoken word changes while a smooth scroll is already animating
- **THEN** the follow controller coalesces movement to the comfort target without concurrent competing animations

### Requirement: Follow the spoken word during playback
While TTS is playing and follow mode is active, the reader SHALL keep the active spoken word comfortably visible using transcript auto-follow semantics: the active word is kept at a comfortable reading position above the vertical center (0.28 desktop / 0.18 compact), movement is debounced (150ms), scrolling is skipped when the word is already within the comfort band, and follow operates across EPUB iframes, PDF pages/reflow, Markdown, HTML, and queue scroll views. Follow behavior SHALL be a persisted user preference separate from the highlight toggle.

#### Scenario: Spoken word advances within comfort band
- **WHEN** TTS plays through words that remain inside the vertical comfort band
- **THEN** viewport scrolling is skipped, avoiding unnecessary viewport jitter

#### Scenario: Spoken word exits comfort band
- **WHEN** narration progresses beyond the lower comfort band boundary
- **THEN** the follow controller debounces and smooth-scrolls the viewport to bring the active word to the comfort offset

#### Scenario: Section, chapter, and page transitions
- **WHEN** playback crosses a PDF page boundary, EPUB spine section iframe, or document chunk boundary
- **THEN** following continues into the new section or page without crashing or losing tracking

### Requirement: User scroll pauses following without stopping playback
If the user deliberately scrolls away while TTS continues, the system SHALL pause auto-follow without snapping back, while playback and spoken-word highlighting continue uninterrupted. A "Re-center" affordance SHALL be displayed while follow is paused; invoking it SHALL immediately return the viewport to the currently spoken word and resume auto-following. The detection of deliberate user scrolling SHALL distinguish programmatic follow scrolls from real user input (arrival-based detection with real-input override).

#### Scenario: Manual user scroll pauses follow
- **WHEN** TTS is reading with follow active and the user scrolls to read ahead or behind
- **THEN** auto-follow pauses, playback continues at the current speech position, and the active word remains highlighted

#### Scenario: Re-center restores follow
- **WHEN** auto-follow is paused by user scroll and the user clicks Re-center
- **THEN** the viewport scrolls back to the currently spoken word and auto-follow resumes

#### Scenario: Programmatic arrival is not misclassified as user scroll
- **WHEN** the follow controller performs its own smooth-scroll animation
- **THEN** the resulting scroll events arriving at the target are recognized as programmatic and do not pause follow

### Requirement: Crash safety and defensive lifecycle handling
When the active spoken word leaves the visible viewport, or when reader components unmount, switch documents, or virtualize nodes during follow operations, the follow controller SHALL execute safely without throwing unhandled exceptions, triggering infinite scroll loops, or crashing the reader/WebView process.

#### Scenario: Unmounted or detached container during follow debounce
- **WHEN** a document or iframe unmounts while a debounced follow scroll is scheduled
- **THEN** the scheduled callback safely no-ops without accessing detached DOM or throwing errors

#### Scenario: Zero-height or hidden container
- **WHEN** follow triggers while the document container has zero height or the document is hidden in the background
- **THEN** follow calculations abort safely without NaN scroll offsets or DOM errors

### Requirement: Passive scrolling never retargets playback
Manual scrolling during active playback SHALL only affect viewport positioning and MUST NOT change the current narration position. Retargeting playback happens exclusively through explicit actions: pressing Play from a stopped state, invoking "Read from here", or deliberate TOC navigation.

#### Scenario: Manual scroll during playback
- **WHEN** the user scrolls elsewhere in the document while TTS is actively narrating
- **THEN** narration continues speaking the current passage and does not jump to the visible viewport

### Requirement: Reduced motion and e-ink handling
Follow scrolling SHALL respect the application's reduced-motion presentation mode and e-ink mode by replacing smooth scrolling with instant positioning (`behavior: "auto"`). Follow scrolling SHALL NOT run while playback is stopped.

#### Scenario: Reduced motion instant positioning
- **WHEN** reduced motion or e-ink mode is enabled and follow repositions the viewport
- **THEN** positioning is instantaneous without smooth animation

#### Scenario: Playback stopped
- **WHEN** playback is stopped or reader is unmounted
- **THEN** no follow scrolling or polling loops execute
