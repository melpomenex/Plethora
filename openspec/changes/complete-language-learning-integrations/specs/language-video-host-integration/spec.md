## ADDED Requirements

### Requirement: Video Language Mode SHALL reuse the existing playback session

The video language host SHALL wrap the existing video player, transcript synchronization, progress persistence, and playback clock. It SHALL not create a second clock, polling loop, or competing position store, and ordinary video behavior SHALL remain unchanged when Language Mode is off.

#### Scenario: Ordinary video playback
- **WHEN** a learner plays a video without enabling Language Mode
- **THEN** the existing player, transcript, progress, keyboard controls, and mobile behavior SHALL operate unchanged

#### Scenario: Language Mode starts during playback
- **WHEN** the learner enables Language Mode while a video is playing
- **THEN** the language controller SHALL attach to the current media/document fingerprint and current playback position without restarting or seeking the video

### Requirement: Video transcripts SHALL expose synchronized language sentences and tokens

The host SHALL map transcript segments and word timings into shared sentence/token identities and SHALL render profile-scoped lexical state, translation, and analysis overlays without altering the underlying transcript text or karaoke timing.

#### Scenario: Playback enters a language sentence
- **WHEN** the existing playback clock enters a transcript sentence
- **THEN** the language host SHALL mark that sentence active, expose its source anchor, and update visible language annotations using the same timestamp

#### Scenario: Transcript lacks word-level timing
- **WHEN** a transcript segment has sentence timing but no reliable word timing
- **THEN** the host SHALL retain sentence-level synchronization and SHALL label word-level highlighting as approximate or unavailable rather than inventing exact timing

### Requirement: Video language actions SHALL preserve media provenance

Video Language Mode SHALL provide sentence translation/reveal, vocabulary inspection, original sentence replay, explicit mining, and optional frame capture only when the source capability supports them. Every action SHALL retain media ID, segment identity, timestamp range, content fingerprint, and optional frame provenance.

#### Scenario: Learner mines a sentence
- **WHEN** the learner explicitly chooses Mine from a synchronized sentence
- **THEN** the host SHALL open the shared language draft flow with bounded transcript context and exact media provenance

#### Scenario: Frame capture is unavailable
- **WHEN** the current WebView or source does not support frame capture
- **THEN** the mining flow SHALL omit the frame and SHALL preserve the sentence/timestamp source without blocking the draft

### Requirement: Video hosts SHALL handle stale and unavailable language data truthfully

Language results SHALL be keyed by media/document and analysis fingerprints. Stale, failed, unsupported, or provider-pending results SHALL be visible as such and SHALL not be applied to another video, transcript, or occurrence.

#### Scenario: Video content changes
- **WHEN** the transcript or media fingerprint changes while cached language data exists
- **THEN** the host SHALL invalidate the affected language results and SHALL not display them as current

#### Scenario: Translation provider fails
- **WHEN** sentence translation fails or is unavailable offline
- **THEN** the transcript and normal playback SHALL remain usable and the host SHALL offer retry or a clear unavailable state

### Requirement: Video language controls SHALL work on desktop, mobile, and assistive input

Controls for Language Mode, sentence navigation, translation reveal, replay, mining, and exit SHALL be keyboard and touch accessible, screen-reader labelled, reduced-motion aware, and non-blocking for normal playback.

#### Scenario: Learner exits Language Mode
- **WHEN** the learner exits Language Mode during playback
- **THEN** the video SHALL continue from the current position with language overlays and language listeners removed

