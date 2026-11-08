# Acceptance Plan: Local-First Podcast Ad Removal, Chapter Navigation & Integrated Transcripts

This document defines the authoritative acceptance criteria, verification procedures, and pass/fail gates required to certify the implementation of the Podcast Ad Removal feature in Plethora.

---

## 1. Audible Ad Leakage & Seamless Playback Gates

The zero-audible-leakage requirement is a non-negotiable quality gate. Any audible artifact, pop, click, or leaked syllable of an advertisement constitutes an acceptance test failure.

### 1.1 Pre-Roll Ad Skipping at Track Onset (0:00)
- **Precondition**: An episode has a detected or tagged pre-roll ad interval from `00:00.000` to `00:45.000`.
- **Test Procedure**:
  1. Load the episode in `AudiobookViewer` / `GlobalAudioController` with `adRemovalEnabled: true`.
  2. Press "Play" from initial cold state (`currentTime == 0.0`).
  3. Capture audio output stream at the hardware/audio-pipeline level.
- **Pass Criteria**:
  - The playhead immediately pre-seeks to `00:45.050` before invoking media playback.
  - Audio output during `00:00.000` to `00:45.000` is strictly 0 samples (zero volume).
  - The first audible sample heard by the listener is the show's intro at `00:45.050`.
  - An `AdSkipToast` displays: *"Skipped pre-roll ad (45s)"*.

### 1.2 Mid-Roll Natural Crossing
- **Precondition**: An episode contains an ad block between `12:30.000` and `14:15.000`. Content audio plays naturally at `12:25.000`.
- **Test Procedure**:
  1. Allow audio to play continuously past `12:25.000`.
  2. Monitor `GlobalAudioController` lookahead timer.
- **Pass Criteria**:
  - At `12:29.880` (120ms prior to ad onset), the lookahead guard mutes audio output.
  - The player executes a seek to `14:15.050`.
  - Media element unmutes once the `seeked` event fires and playback resumes cleanly.
  - Zero syllables of the sponsor read or transition jingle are audible.
  - Playback resumes at `14:15.050` without click, pop, or stutter.

### 1.3 Rapid Scrubbing & Seeking Across Ad Boundaries
- **Precondition**: Episode has ad intervals at `05:00-06:30` and `22:00-23:45`.
- **Test Procedure**:
  1. Rapidly drag player scrubber back and forth across `05:00` to `06:30`.
  2. Use keyboard shortcut (Right Arrow) to skip forward by 15s increments starting at `04:50`.
- **Pass Criteria**:
  - Scrubbing or seeking that targets any timestamp within `[05:00.000, 06:30.000]` automatically snaps to `06:30.050`.
  - Rapid sequential seek commands do not cause audio buffer starvation or temporary bursts of leaked ad audio.
  - Playhead smoothly lands outside the ad segment.

### 1.4 Manual Seek Directly Into Ad Block
- **Precondition**: User explicitly clicks the player timeline at `13:00.000` (which is inside the `12:30-14:15` ad block).
- **Test Procedure**:
  1. Click directly at `13:00.000` on the seekbar.
- **Pass Criteria**:
  - When `adRemovalEnabled` is true, the controller snaps playhead to `14:15.050`.
  - A subtle toast informs the user: *"Ad segment skipped — Click here to listen anyway"*.
  - If the user clicked to listen anyway (or clicked within 5 seconds of the skip), playback enters the ad segment and temporarily bypasses skipping for this specific interval.

---

## 2. Chapter Ingestion & Navigation Gates

### 2.1 Podcasting 2.0 External JSON Chapters
- **Precondition**: RSS feed contains `<podcast:chapters url="https://example.com/chapters.json" type="application/json+chapters" />`.
- **Test Procedure**:
  1. Subscribe to or refresh feed.
  2. Inspect `podcast_chapters` table in SQLite.
- **Pass Criteria**:
  - External JSON payload is fetched asynchronously without blocking feed refresh.
  - SSRF filter blocks requests if URL resolves to loopback (`127.0.0.1`), link-local (`169.254.x.x`), or RFC1918 private IPs.
  - Valid chapters are inserted into `podcast_chapters` with `source = 'podcast_2_0'`.
  - Chapter titles, start times, durations, links, and artwork URLs are accurately recorded.

### 2.2 Podlove Simple Chapters (PSC XML)
- **Precondition**: RSS feed contains `<psc:chapters version="1.2">` with multiple `<psc:chapter start="00:00.000" title="Intro" />` tags.
- **Test Procedure**:
  1. Parse feed with `parse_podcast_feed`.
- **Pass Criteria**:
  - Chapters are ingested without network calls.
  - Variable timestamp formats (`SS`, `MM:SS`, `HH:MM:SS`, `HH:MM:SS.mmm`) are parsed to exact millisecond integers.

### 2.3 Embedded ID3 CHAP / CTOC Frames
- **Precondition**: Downloaded `.mp3` file contains ID3v2.3/v2.4 `CHAP` sub-frames and a `CTOC` table of contents.
- **Test Procedure**:
  1. Download episode audio to local disk.
  2. Run native chapter extraction via `id3_chapters.rs`.
- **Pass Criteria**:
  - ID3 sub-frames are parsed correctly into start/end milliseconds and title strings.
  - Embedded chapter artwork is either extracted to cache or safely ignored without memory leak.

### 2.4 Description / Show Notes Timestamp Fallback
- **Precondition**: Episode has no JSON, PSC, or ID3 chapters, but episode description contains:
  ```text
  Timestamps:
  00:00 - Introduction
  05:15 - Deep Dive into Local AI
  24:30 - Listener Questions & Outro
  ```
- **Test Procedure**:
  1. Ingest episode via `description_chapters.rs`.
- **Pass Criteria**:
  - Regex parser identifies >= 3 sequential chronological timestamps.
  - Extracted chapters are stored with `source = 'description'`.
  - Spurious numbers (e.g. "Over 5,000 listeners", "Version 2.0") are not misidentified as timestamps.

### 2.5 Priority Cascade & Reconciliation
- **Precondition**: Episode has both external JSON chapters and description timestamps.
- **Test Procedure**:
  1. Resolve chapters via `chapter_service.rs`.
- **Pass Criteria**:
  - Higher-priority external JSON chapters take precedence.
  - Lower-priority description timestamps are superseded without duplicate entries.
  - `podcast_episodes.chapters_source` records `'podcast_2_0'`.

---

## 3. Speech Recognition Reuse & Transcript Attachment Gates

### 3.1 STT Engine Selection Respect
- **Precondition**: User has configured `transcription.engine = "parakeet"` (or `"whistle"`, `"whisper"`, `"android_stt"`).
- **Test Procedure**:
  1. Trigger episode transcription.
  2. Inspect task execution and spawned processes.
- **Pass Criteria**:
  - The system routes audio transcription through the configured engine in `resolveTranscription()`.
  - The system NEVER silently falls back to a different cloud engine or third-party API without explicit user selection.
  - On Linux/macOS with `whistle`, the `needle` binary sidecar is invoked with word timestamp flags.
  - On Android, the on-device `plethora-android-stt` service is utilized.

### 3.2 Permanent Transcript Storage & Document Integration
- **Precondition**: STT run completes for a 45-minute episode.
- **Test Procedure**:
  1. Inspect `podcast_episodes` and `podcast_transcript_segments` tables.
  2. Query Plethora global search for a unique phrase spoken in the episode.
  3. Open Incremental Reading / Extract viewer.
- **Pass Criteria**:
  - Full plaintext transcript is stored in `podcast_episodes.transcript`.
  - Word-level or phrase-level segments are stored in `podcast_transcript_segments` with `start_ms` and `end_ms`.
  - A linked `Document` is created with `source = 'podcast'`, allowing the user to create flashcards, highlights, and extracts.
  - Global search (`Cmd+K` / `Ctrl+K`) locates the episode by its spoken content.

### 3.3 Dual Clean vs. Verbatim Transcript Viewer
- **Precondition**: Episode has an active transcript and detected ad intervals.
- **Test Procedure**:
  1. Open `PodcastTranscriptViewer`.
  2. Toggle between "Clean (Ad-Free)" and "Verbatim (Full Archive)" modes.
- **Pass Criteria**:
  - In **Clean Mode**: Spoken advertisement sentences are hidden, replaced by a subtle collapsible tag `[Sponsor Read (1m 15s)]`.
  - In **Verbatim Mode**: All spoken sentences are visible; sponsor sentences are highlighted with a soft amber left border and badge.
  - During playback, active word highlights synchronously follow audio timing (karaoke sync).

---

## 4. Advertisement Detection Accuracy & Quality Gates

### 4.1 Precision & False-Positive Rate Gate
- **Precondition**: Test dataset of 20 diverse podcast episodes (10 interview, 5 narrative/documentary, 5 technical monologue) with gold-standard human-annotated ad boundaries.
- **Test Procedure**:
  1. Run ad detection pipeline on all 20 episodes.
  2. Compare detected intervals against gold standard.
- **Pass Criteria**:
  - **Precision**: >= 92% of detected intervals must be genuine sponsor reads, promo spots, or station breaks.
  - **Recall**: >= 88% of all gold-standard ad intervals must be identified.
  - **False Positive Rate**: < 3% of regular content runtime may be misidentified as an ad.
  - **Sanity Guard**: If detected ad duration exceeds 50% of the total episode length, the pipeline MUST flag the episode for review and NOT automatically enable aggressive skipping.

### 4.2 Boundary Alignment Error
- **Precondition**: Detected ad interval compared against gold-standard start and end points.
- **Pass Criteria**:
  - **Start Boundary Error**: Mean absolute error <= 350ms; 95th percentile <= 750ms.
  - **End Boundary Error**: Mean absolute error <= 400ms; 95th percentile <= 800ms.
  - Boundary snapping must align to silence/pause gaps (>200ms) and never truncate the host mid-phoneme.

---

## 5. Mobile Energy & Native Integration Gates

### 5.1 Real Battery & Power Save Status Reporting
- **Precondition**: Run Plethora on physical Android and iOS test devices.
- **Test Procedure**:
  1. Connect/disconnect charger.
  2. Toggle OS Power Save Mode (Android) / Low Power Mode (iOS).
  3. Query `get_battery_status` Tauri IPC command.
- **Pass Criteria**:
  - `battery.level` reflects actual device battery percentage (0.00 to 1.00).
  - `battery.is_charging` immediately updates on charger plug/unplug events.
  - `battery.is_power_save` accurately reflects OS low-power mode.
  - Mobile stub (`is_present: false`, `level: 1.0`) is completely eliminated.

### 5.2 Battery Protection & Charging-Only Policy
- **Precondition**: User preference `settings.podcast.mobile_charging_only = true`. Device battery at 40%, running on battery (unplugged).
- **Test Procedure**:
  1. Download new podcast episode with auto-ad-removal enabled.
- **Pass Criteria**:
  - Episode is downloaded and chapters are extracted via heuristics/metadata.
  - Heavy STT / LLM processing is automatically queued in `SCHEDULED_DEFERRED` state.
  - WorkManager / BGProcessingTask registers a charging-constrained background job.
  - Plug in device charger: within 60 seconds of charge detection, the background pipeline initiates processing.

### 5.3 Thermal Throttling & Abort Safeguards
- **Precondition**: Run episode processing while simulating high device thermal state via Android thermal HAL / iOS debug thermal profile.
- **Test Procedure**:
  1. Simulate thermal status transition: `NORMAL` -> `SEVERE` -> `CRITICAL`.
- **Pass Criteria**:
  - At `SEVERE`: Background STT worker thread count reduces to 1 thread; sleep pauses inserted between audio chunks.
  - At `CRITICAL`: Processing halts immediately, current transcript chunks are saved to SQLite, and job state transitions to `PAUSED_THERMAL`.
  - When thermal state returns to `NORMAL`: Processing resumes from the last persisted chunk without data loss.

---

## 6. Undo, Replay & Manual Correction Gates

### 6.1 Instant Undo / Replay Action
- **Precondition**: Player skips an ad block from `10:00` to `11:30`.
- **Test Procedure**:
  1. Observe `AdSkipToast` appearing at bottom of screen.
  2. Click "Undo" button within the 8-second toast window.
- **Pass Criteria**:
  - Playhead immediately rewinds to `10:00.000`.
  - Audio resumes playing the ad block.
  - The controller sets a session bypass flag so the player does not immediately re-skip the same block.

### 6.2 Manual Boundary Adjustments on Scrubber
- **Precondition**: User is viewing the episode in `AudiobookViewer`.
- **Test Procedure**:
  1. Right-click or long-press an amber ad interval on the timeline.
  2. Select "Adjust End Time" and drag the marker 10 seconds later.
  3. Select "Delete Ad Segment".
- **Pass Criteria**:
  - Adjustments invoke `save_manual_ad_interval` and `delete_ad_interval`.
  - SQLite database reflects manual user edits (`created_by = 'user'`).
  - Automated detection does not overwrite manual user corrections on subsequent runs.
