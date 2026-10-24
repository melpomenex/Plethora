## Purpose

Define reliable playback behavior during navigation, platform interruptions and recoverable failures while protecting responsiveness, privacy and saved listening progress.

## ADDED Requirements

### Requirement: Continuous reading and study journeys
Supported audio SHALL continue through RSS reading/highlighting, EPUB/PDF page or chapter navigation, flashcard review/grading, notes, search and return to source. Navigation SHALL NOT restart, duplicate or reset audio; player interaction SHALL NOT reset the user's current reading/review state.

#### Scenario: Primary end-to-end regression
- **WHEN** a user starts an audiobook, navigates to RSS, opens an article, scrolls, highlights text, creates a flashcard, opens EPUB/PDF, navigates pages, pauses/resumes from the mini player, and returns to the audiobook
- **THEN** there is no unintended reset, duplication, loss of position or blocking overlay throughout
- **AND** only the requested pause interrupts playback

#### Scenario: Podcast with EPUB and PDF
- **WHEN** podcast playback continues while the user annotates an EPUB, changes chapters, opens a PDF and changes pages
- **THEN** audio remains continuous and player controls preserve both readers' saved positions

#### Scenario: Audio with flashcard review
- **WHEN** the user reviews and grades cards while listening, pauses/resumes audio and leaves review
- **THEN** audio state and review state change only in response to their respective user actions

### Requirement: Android activity-independent background playback
An explicitly started ordinary media session SHALL continue decoding and support standard system transport during screen lock, app switching, activity recreation and task dismissal while playback is ongoing, without requiring foreground JavaScript. Foreground execution refusal SHALL surface an actionable error rather than a false background-playback success claim. Force-stop, process death or explicit Quit SHALL NOT cause unsolicited autoplay on restart.

#### Scenario: Locked phone without WebView transport
- **WHEN** Android is locked or its activity is recreated during a supported downloaded audiobook
- **THEN** playback continues with preserved source/rate/position and lock-screen pause/seek/play works without waiting for the WebView
- **AND** returning to Plethora attaches to the same session without a source reload

#### Scenario: Process terminated
- **WHEN** the process is unexpectedly terminated and reopened
- **THEN** the most recent valid durable position is restored paused with at most five seconds of continuous-play progress loss
- **AND** an already-live service, if present instead of process death, is reattached with its actual current state

### Requirement: Safe interruption and device-route handling
Permanent focus loss, headphone disconnect and explicit pause SHALL prevent unsolicited resume. Transient-focus gain SHALL resume only the same session that was automatically paused for that interruption and only if user intent has not changed. Desktop suspend SHALL flush and pause; resume SHALL remain paused without adding suspended wall-clock time to media position.

#### Scenario: Phone call followed by user pause
- **WHEN** a call transiently interrupts playback and the user pauses or switches source before focus returns
- **THEN** focus gain does not resume the interrupted source

#### Scenario: Headphone and Bluetooth route changes
- **WHEN** wired/Bluetooth output disconnects with a noisy route event
- **THEN** playback pauses and retains its position
- **AND** reconnecting alone does not resume it

#### Scenario: Desktop minimize and suspend
- **WHEN** the app is minimized and later the system suspends
- **THEN** minimize itself does not stop playback, suspend checkpoints and pauses it, and wake does not auto-play or jump position

### Requirement: Recoverable media and storage failures
Source deletion, expired URLs, corrupt/unsupported media, offline availability, network interruption and persistence failures SHALL preserve valid progress and expose an understandable recovery action. Retries SHALL be bounded and SHALL NOT resurrect a stopped, paused or replaced session. Deleting the active source SHALL retire its audio resources before deletion where required by the platform.

#### Scenario: Network recovers after pause
- **WHEN** a stream buffers, the user pauses, and connectivity returns
- **THEN** playback remains paused at the retained position and retry completion does not override user intent

#### Scenario: Expired podcast URL
- **WHEN** the episode URL expires
- **THEN** the app attempts a bounded identity-preserving refresh and resumes at retained position only with valid play intent
- **AND** persistent failure exposes retry/source access rather than looping or changing episodes

#### Scenario: Unsupported or deleted file
- **WHEN** a local file cannot decode or is removed during playback
- **THEN** playback stops safely with its last position retained and one source-specific error/removal notice
- **AND** no other queued item begins without authorized continuation

#### Scenario: Offline and storage failure
- **WHEN** an authorized downloaded item is played offline and a progress write temporarily fails
- **THEN** local playback remains available, the latest checkpoint stays pending for retry, and the app does not falsely report that progress was saved

### Requirement: Account and window isolation
Audio ownership, metadata, queue and pending commands SHALL be isolated by account/profile. Switching identity SHALL stop old audio and clear its OS surface before exposing the new identity. Utility windows SHALL NOT instantiate independent audio sessions; future additional full windows SHALL control the main owner or reject local playback.

#### Scenario: Account switch during listening
- **WHEN** a user switches account or profile during playback
- **THEN** old playback is paused/checkpointed under its original identity, its callbacks are invalidated and its OS metadata is removed
- **AND** no old title, command, queue or saved position is applied to the new profile

#### Scenario: Screenshot utility opens
- **WHEN** a screenshot utility window opens while the main window plays audio
- **THEN** it creates no decoder or competing media-command bridge

### Requirement: Bounded resource and update overhead
Playback SHALL use one decoder for the active ordinary-media source, no application-wide tick rendering, no per-tick database writes and no continuous animation loop. Visible compact progress SHALL update no more than once per second; other visible position consumers no more than twice per second, excluding user-driven seeks. During disconnected Android background playback, standard transport, checkpoints, focus and sleep timers SHALL remain native. Released UI surfaces SHALL release their subscriptions while active playback continues.

#### Scenario: Reader remains responsive
- **WHEN** the required reading journey is measured before and after implementation with equivalent fixtures/device conditions
- **THEN** unrelated reader/RSS/review roots do not render due solely to position updates
- **AND** p95 frame/interaction latency increases by no more than the greater of 10 percent or 2 milliseconds over baseline, with mini-player command acknowledgment p95 at most 100 milliseconds in foreground

#### Scenario: Resource stability under repeated navigation
- **WHEN** the user performs 100 source-view open/close and expansion cycles during one session
- **THEN** decoder and owner-listener counts stay bounded and released player surfaces are collectible
- **AND** retained JS heap growth after settling/collection is at most 5 MiB above the equivalent single-session post-warmup state
