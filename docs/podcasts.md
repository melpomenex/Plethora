# Podcasts: Ad Removal, Chapter Navigation & Smart Playback

## Overview

PLETHORA features a local-first, privacy-preserving podcast engine with automated advertisement detection, intelligent chapter navigation, permanent transcript attachment, and seamless preemptive skip playback.

The system is designed with three core principles:
1. **Non-destructive Playback**: Original audio files are never trimmed, transcoded, or modified on disk. All skips are executed in real time via playback engine position offsets.
2. **Local-First & Offline**: Chapter parsing, acoustic boundary refinement, heuristic classification, and whisper speech recognition run on-device without telemetry or cloud dependency.
3. **Energy Stewardship**: Intensive speech-to-text and classification jobs defer automatically on mobile devices until plugged in, respecting battery and thermal constraints.

---

## 1. Chapter Ingestion & Navigation

When a podcast episode is imported or played, PLETHORA searches across multiple standard metadata sources in priority order:

1. **Podcasting 2.0 Chapters (`<podcast:chapters url="..." type="application/json+chapters">`)**: Fetches structured remote JSON chapter assets containing precise timestamps, titles, URLs, and optional image links.
2. **Podlove Simple Chapters (`<psc:chapters>`)**: XML-embedded chapter marks specified in the episode's RSS `<item>` container.
3. **Embedded Audio Metadata (ID3v2 & MP4 CHAP atoms)**: Extracted directly from downloaded audio files (`.mp3`, `.m4a`) via native audio stream inspection.
4. **Description Timestamps (Fallback)**: Regular expression extraction from episode show notes for patterns such as `01:23 Introduction` or `(05:40) Sponsor`.

Chapters are persisted to the local SQLite database (`podcast_chapters` table) and surfaced in the player's Chapter Drawer. Clicking any chapter immediately seeks to that position.

---

## 2. Advertisement Detection Pipeline

Ad detection operates across three complementary layers to produce high-confidence skip intervals:

### A. Chapter-Level Detection
- If a chapter specifies Podcasting 2.0 attribute `ad: true`, it is immediately marked as an advertisement.
- Chapter titles matching known promotional keywords (`sponsor`, `advertisement`, `promo`, `break`, `ad spot`, `supported by`) are classified as sponsor intervals.

### B. Transcript Cue & LLM Classification
- When audio is transcribed using PLETHORA's local Whisper STT pipeline, transcript cues are scanned for promotional introductions (e.g., *"This episode is brought to you by..."*, *"Use promo code..."*, *"A quick word from our sponsors..."*).
- Ambiguous segments can optionally be classified with local LLMs or configured providers using structured classification prompts.

### C. Acoustic Silence Boundary Snapping
- Promotional segments often start and end during brief conversational pauses or musical stingers.
- PLETHORA's native acoustic analyzer (`boundary_refiner.rs`) scans the waveform within a ±2.5-second search window around candidate cue points to snap cuts to natural silence gaps (energy < -40dBFS for ≥ 150ms). This prevents jarring speech cutoffs or clipped words.

### D. Interval Merging & Sanity Limits
- Ad intervals spaced within 5 seconds of each other are merged into a single contiguous block.
- Absolute sanity constraints prevent false positives: no single ad segment can exceed 8 minutes, and total detected ads cannot exceed 40% of the episode duration.

---

## 3. Preemptive Ad-Free Playback Engine

Playback skipping is governed by the `GlobalAudioController`:

- **120ms Lookahead Guard**: The playback clock monitors upcoming ad intervals with a 120ms lookahead threshold. When approaching an ad start boundary, the engine mutes volume instantaneously, executes a seek to `interval.endSec`, and restores volume once positioned. This eliminates audible artifact leaks or sponsor jingle snippets.
- **Seek-Target Collision Resolver**: If the user scrubs or seeks directly into the middle of an ad interval, playback immediately advances to the end of that ad interval instead of playing the ad.
- **Start-of-Track Clamping**: If an ad begins at `00:00` (pre-roll), playback starts smoothly at the first non-ad timestamp.
- **Floating Skip Notification Toast**: When an ad interval is skipped, a non-intrusive floating toast displays: *"Skipped Sponsor (1m 30s)"* with an immediate **Undo** button. Tapping Undo seeks back to the start of the skipped interval and temporarily disables auto-skipping for that segment.
- **Scrubber Overlays**: Detected ad intervals are visually highlighted on the playback scrubber bar as amber/yellow striped segments.
- **Manual Ad Interval Editor**: Users can tap the **Ads** pill button in the expanded player or right-click any scrubber segment to open the manual editor sheet. From here, intervals can be previewed, trimmed, toggled on/off, added, or deleted.

---

## 4. Transcript Attachment & Dual Display Modes

Transcripts generated during queue processing or imported from external SRT/VTT/JSON files are permanently attached to the episode in the local database.

The transcript viewer provides two view modes:
- **Clean Mode**: Detected ad segments are visually collapsed or excised from the reading view, allowing a distraction-free, article-style reading experience.
- **Verbatim Mode**: Displays the entire raw transcript without omissions, tagging sponsor segments with yellow ad badges so users can review what was cut.
- **Synchronized Read-Along**: Word-level timestamps highlight current speech in real time with smooth scrolling and click-to-seek functionality.

---

## 5. Mobile Energy & Thermal Stewardship

Audio processing and transcription can consume significant CPU and battery power on mobile devices (Android and iOS). PLETHORA incorporates native power management:

- **Charging-Only Deferral**: Deep ad analysis and Whisper speech recognition tasks are automatically queued and deferred until the mobile device is plugged into AC power and battery level is above 20%.
- **Thermal Governor**: Real-time thermal throttling monitors hardware temperature states:
  - **Normal / Nominal**: Full multi-core transcription (up to 4 worker threads).
  - **Warm / Fair**: Throttles worker threads down to 2, introducing inter-chunk sleep intervals.
  - **Hot / Serious**: Suspends active background processing and preserves partial progress.
  - **Critical**: Aborts background tasks immediately to prevent device thermal distress.

---

## 6. Configuration & Settings

Ad removal options can be configured under **Settings > Podcasts & Audio**:
- **Auto-skip detected ads**: Enable or disable preemptive skipping globally (default: enabled).
- **Show skip notifications**: Toggle the floating toast with Undo action.
- **Boundary snap window**: Adjust silence search tolerance (default: 2.5s).
- **Process on battery**: Allow background detection while on battery (default: disabled on mobile).
