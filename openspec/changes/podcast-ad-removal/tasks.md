# Tasks: Local-First Podcast Ad Removal, Chapter Navigation, and Integrated Transcripts

## Phase 1: Foundation (Database, Models, IPC & Settings)

- [x] **1.1 Database Migration 138**
  - **Component**: Rust Backend (`src-tauri/src/database/connection.rs`)
  - **Details**: Add migration 138 creating `podcast_chapters`, `podcast_ad_intervals`, and `podcast_ad_settings` tables; add missing columns `ad_removal_status`, `clean_transcript_id`, `chapters_source`, `ad_free_duration_ms` to `podcast_episodes`. Create compound indices on `(episode_id, start_time_ms)` and foreign key cascades.
  - **Verification**: Run `cargo test test_migrations` and verify schema upgrades cleanly from clean DB and migration 137.
  - **Dependencies**: None.

- [x] **1.2 Rust Data Models**
  - **Component**: Rust Backend (`src-tauri/src/models/podcast.rs`, `src-tauri/src/models/podcast_ad.rs` [NEW])
  - **Details**: Implement `PodcastChapter`, `PodcastAdInterval`, `PodcastAdDetectionStatus`, `PodcastAdSettings`, `ChapterSource`, and `AdDetectionMethod` with `Serialize`, `Deserialize`, `Clone`, and `Debug`. Update existing `PodcastEpisode` struct with new schema fields.
  - **Verification**: Run `cargo check` and write serialization round-trip unit tests in `src-tauri/src/models/podcast_ad.rs`.
  - **Dependencies**: 1.1.

- [x] **1.3 TypeScript Shared Type Definitions**
  - **Component**: Frontend Core (`src/types/podcast.ts`, `src/types/podcastAd.ts` [NEW])
  - **Details**: Define frontend interfaces mirroring Rust DTOs: `PodcastChapter`, `PodcastAdInterval`, `PodcastAdSettings`, `AdRemovalState`, `SkipToastData`. Ensure camelCase serialization matches Tauri serde configuration.
  - **Verification**: Run `npm run type-check` (tsc) to confirm no type errors.
  - **Dependencies**: 1.2.

- [x] **1.4 Podcast Repository CRUD Operations**
  - **Component**: Rust Backend (`src-tauri/src/database/podcast_repo.rs` or `repository.rs`)
  - **Details**: Implement `upsert_podcast_chapters(episode_id, chapters)`, `get_podcast_chapters(episode_id)`, `upsert_ad_intervals(episode_id, intervals)`, `get_ad_intervals(episode_id)`, `delete_ad_interval(interval_id)`, and `update_episode_ad_status(episode_id, status)`. Use transactions for atomic batch replacements.
  - **Verification**: Add SQLite repository integration tests in `src-tauri/src/database/tests/podcast_repo_tests.rs`.
  - **Dependencies**: 1.1, 1.2.

- [x] **1.5 Tauri IPC Commands Registration**
  - **Component**: Rust Backend (`src-tauri/src/commands/podcast_ad.rs` [NEW], `src-tauri/src/lib.rs`)
  - **Details**: Implement Tauri commands: `get_episode_chapters`, `get_episode_ad_intervals`, `detect_episode_ads`, `cancel_ad_detection`, `save_manual_ad_interval`, `delete_ad_interval`, `get_podcast_ad_settings`, `update_podcast_ad_settings`. Register all in `generate_handler![]` in `src-tauri/src/lib.rs`.
  - **Verification**: Verify backend compiles and commands respond to test invocations.
  - **Dependencies**: 1.4.

- [x] **1.6 Settings Search Catalog & Coverage**
  - **Component**: Frontend Settings (`src/components/settings/search/settingsSearchCatalog.ts`, `src/components/settings/search/settingsSearchCoverage.ts`, `src/components/settings/PodcastSettings.tsx`)
  - **Details**: Add stable search IDs and entries for `settings.podcast.ad_removal`, `settings.podcast.auto_transcribe_on_download`, `settings.podcast.mobile_charging_only`, and `settings.podcast.min_ad_duration`. Add coverage row in `settingsSearchCoverage.ts`.
  - **Verification**: Run `npm test src/components/settings/search` to satisfy repo settings search gate rule.
  - **Dependencies**: 1.3.

---

## Phase 2: Chapter Ingestion & Navigation

- [x] **2.1 Podcasting 2.0 & Podlove RSS Chapter Parser**
  - **Component**: Rust Backend (`src-tauri/src/podcast/parser.rs`)
  - **Details**: Extend `parse_podcast_feed` using `quick-xml` to extract `<podcast:chapters url="..." type="..." />` and inline `<psc:chapters>` / `<psc:chapter start="..." title="..." />`. Store parsed metadata on the episode record.
  - **Verification**: Unit tests in `parser.rs` with sample Podcasting 2.0 and Podlove RSS fixtures.
  - **Dependencies**: 1.2.

- [x] **2.2 External JSON Chapter Fetcher & Validator**
  - **Component**: Rust Backend (`src-tauri/src/podcast/chapter_fetcher.rs` [NEW])
  - **Details**: Implement asynchronous fetcher for external JSON chapters (`type="application/json+chapters"`). Validate URLs against SSRF blacklist (loopback, private RFC1918, link-local addresses). Parse JSON payload adhering to the Podcasting 2.0 chapters specification (`version: 1.2.0`, `chapters: [{ startTime, title, img, url }]`).
  - **Verification**: Unit tests with mock responses and invalid SSRF IP attempts (e.g. `http://169.254.169.254/`).
  - **Dependencies**: 1.2.

- [x] **2.3 Embedded ID3 & M4A Chapter Extractor**
  - **Component**: Rust Backend (`src-tauri/src/podcast/id3_chapters.rs` [NEW])
  - **Details**: Implement native chapter extraction from downloaded audio files (`.mp3`, `.m4a`). Read ID3v2 `CHAP` / `CTOC` frames and MP4 QuickTime `chpl` / text tracks using `lofty` or `id3` crate. Convert sub-second frame offsets to millisecond timestamps.
  - **Verification**: Test with synthetic MP3 containing `CHAP` frames and M4A containing chapter tracks.
  - **Dependencies**: 1.2.

- [x] **2.4 Episode Description / Show Notes Timestamp Parser**
  - **Component**: Rust Backend (`src-tauri/src/podcast/description_chapters.rs` [NEW])
  - **Details**: Regex-based fallback parser for episode description text. Match standard timestamp formats: `HH:MM:SS`, `H:MM:SS`, `MM:SS`. Extract adjacent title text. Filter out single timestamps (require >= 3 chronological timestamps to consider as chapters).
  - **Verification**: Unit tests with diverse real-world podcast show notes (YouTube format, Patreon format, NPR format).
  - **Dependencies**: 1.2.

- [x] **2.5 Chapter Ingestion Pipeline & Priority Resolver**
  - **Component**: Rust Backend (`src-tauri/src/podcast/chapter_service.rs` [NEW])
  - **Details**: Pipeline resolving chapters for an episode using cascade priority: 1) External JSON 2) Embedded ID3/M4A 3) RSS Inline Podlove 4) Description timestamps. Persist resolved chapters to `podcast_chapters` table.
  - **Verification**: Integration test verifying external JSON overrides description timestamps, and ID3 overrides description when external JSON is absent.
  - **Dependencies**: 2.1, 2.2, 2.3, 2.4, 1.4.

- [x] **2.6 Adaptive Chapter Drawer & Mobile Sheet UI**
  - **Component**: Frontend UI (`src/components/viewer/AudiobookViewer.tsx`, `src/components/podcast/PodcastChapterSheet.tsx` [NEW])
  - **Details**: Generalize chapter display in `AudiobookViewer.tsx`. Replace local JSON `localStorage` reader with `get_episode_chapters` Tauri IPC command. Render responsive drawer on desktop and Vaul-based bottom sheet on mobile. Display chapter title, duration, start timestamp, artwork thumbnail, and detected sponsor badge. Implement instant seek on click.
  - **Verification**: Manual UI test on desktop and mobile viewport sizes; verify active chapter highlights dynamically during playback.
  - **Dependencies**: 1.3, 1.5, 2.5.

---

## Phase 3: Speech Recognition Reuse & Transcript Attachment

- [x] **3.1 Orchestrator STT Dispatcher Integration**
  - **Component**: Rust Backend (`src-tauri/src/transcription/manager.rs`, `src-tauri/src/commands/podcast.rs`)
  - **Details**: Route podcast transcription through existing `resolveTranscription()` pipeline. Support Parakeet (sherpa-onnx), Whistle (`needle` sidecar), Whisper CLI, and native Android STT. Extract word-level timestamped tokens (`text`, `start_ms`, `end_ms`, `probability`).
  - **Verification**: Mock STT runner emitting token stream with timestamps and verify correct receiver collection.
  - **Dependencies**: 1.2.

- [x] **3.2 Permanent Transcript Storage & Document Linking**
  - **Component**: Rust Backend (`src-tauri/src/database/podcast_repo.rs`)
  - **Details**: Store full word-level segments in `podcast_transcript_segments`. Generate and persist full text in `podcast_episodes.transcript`. Automatically create a linked `Document` record (`source = "podcast"`, `external_id = episode.id`), enabling Plethora full-text search, Q&A assistant context, and Incremental Reading extract generation.
  - **Verification**: Run integration test checking that transcribing an episode creates corresponding `Document` and `podcast_transcript_segments` rows.
  - **Dependencies**: 1.4, 3.1.

- [x] **3.3 Dual Clean vs. Verbatim Transcript Viewer**
  - **Component**: Frontend UI (`src/components/podcast/TranscriptSync.tsx`, `src/components/podcast/PodcastTranscriptViewer.tsx` [NEW])
  - **Details**: Update transcript viewer to support two display modes: "Clean" (ad segments removed or collapsed with subtle "Sponsor segment skipped" pill) and "Verbatim" (full archive with ad text highlighted in muted yellow). Implement auto-scroll karaoke tracking matching audio playback.
  - **Verification**: Cypress or Vitest component test asserting ad segments are hidden in Clean mode and visible with badges in Verbatim mode.
  - **Dependencies**: 1.3, 3.2.

---

## Phase 4: Advertisement Detection Pipeline

- [x] **4.1 Chapter Metadata Heuristic Classifier**
  - **Component**: Rust Backend (`src-tauri/src/podcast/ad/chapter_classifier.rs` [NEW])
  - **Details**: Scan ingested chapters for sponsor keywords in title or external link: `sponsor`, `advertisement`, `ad`, `promo`, `discount`, `patreon`, `break`, `commercial`. Flag matching chapter intervals with confidence 0.85.
  - **Verification**: Unit tests on 20 synthetic chapter sets with known sponsor titles.
  - **Dependencies**: 2.5, 1.2.

- [x] **4.2 Transcript Acoustic & Text Cue Detector**
  - **Component**: Rust Backend (`src-tauri/src/podcast/ad/cue_detector.rs` [NEW])
  - **Details**: Implement multi-pattern regex matching on transcript text based on Podly cue detector: sponsor intros ("sponsored by", "brought to you by", "support for this podcast"), promo codes ("promo code", "use code", "at checkout"), landing pages ("dot com slash", ".com/"), and outro transitions ("welcome back to", "now back to the show"). Compute cue score and extract candidate spans.
  - **Verification**: Benchmark regex matching speed and test against 15 podcast episode transcripts.
  - **Dependencies**: 3.1, 1.2.

- [x] **4.3 Local LLM / Instruct Semantic Boundary Refiner**
  - **Component**: Rust Backend (`src-tauri/src/podcast/ad/llm_classifier.rs` [NEW])
  - **Details**: For candidate spans detected by cues or unverified chapter boundaries, extract a 60-second transcript chunk window with 15-second padding. Wrap untrusted text in XML containment tags `<transcript_chunk>`. Submit to local LLM (via local GGUF, Ollama, or on-device Gemini Nano) requesting strict JSON schema classification: `{ "is_ad": bool, "start_phrase": string, "end_phrase": string, "brand": string, "confidence": float }`.
  - **Verification**: Test prompt evaluation with mock LLM server; verify malformed responses safely fall back without crash.
  - **Dependencies**: 4.2.

- [x] **4.4 Silence & Word Timestamp Boundary Snapper**
  - **Component**: Rust Backend (`src-tauri/src/podcast/ad/boundary_refiner.rs` [NEW])
  - **Details**: Snap rough LLM/cue boundary timestamps to exact sentence and word bounds using STT word-level timestamps (`start_ms`, `end_ms`). Compute RMS energy envelope around the boundary (±1.5s) to detect acoustic pauses (>250ms of silence). Snap boundary to center of silence window to prevent clipping spoken words.
  - **Verification**: Test boundary snapping on audio clips with pre-computed word alignments and silence gaps.
  - **Dependencies**: 3.1, 4.3.

- [x] **4.5 Interval Merger, Deduplicator & Safety Sanity Guard**
  - **Component**: Rust Backend (`src-tauri/src/podcast/ad/interval_merger.rs` [NEW])
  - **Details**: Merge adjacent detected intervals separated by less than 3.0 seconds (e.g. back-to-back 30s ad spots). Discard intervals shorter than `min_ad_duration_seconds` (default 10s). Verify sanity constraint: if total ad duration exceeds 50% of episode duration, flag as suspicious and require user confirmation before applying. Persist final intervals to `podcast_ad_intervals`.
  - **Verification**: Unit tests covering overlapping intervals, close intervals, micro-intervals, and >50% sanity triggers.
  - **Dependencies**: 4.1, 4.4, 1.4.

---

## Phase 5: Preemptive Ad-Free Playback Engine

- [x] **5.1 120ms Lookahead Playback Guard**
  - **Component**: Frontend Audio Controller (`src/services/audio/GlobalAudioController.ts`)
  - **Details**: Implement high-frequency lookahead loop in `GlobalAudioController`. When playback is active and ad skipping is enabled, query current time against sorted ad interval array. If `currentTime + 0.120s >= interval.start`, immediately schedule seek to `interval.end + 0.050s`. Temporarily mute audio output during the seek step to guarantee zero audible leakage of the ad onset.
  - **Verification**: Automated test simulating audio playback approaching ad boundary; assert seek occurs before `currentTime >= interval.start` and audio volume is restored post-seek.
  - **Dependencies**: 1.3, 1.5.

- [x] **5.2 Start-of-Track & Seek-Target Collision Resolver**
  - **Component**: Frontend Audio Controller (`src/services/audio/GlobalAudioController.ts`, `src/components/viewer/AudiobookViewer.tsx`)
  - **Details**: In `loadTrack()` / `loadPart()`, check if `initialPosition` or `0.0` falls within an ad interval (e.g., pre-roll ad starting at 0:00). If so, clamp initial playback position to `interval.end + 0.050s` before triggering HTMLMediaElement `.play()`. When user drags scrubber into an ad interval, prompt or smoothly advance to interval end.
  - **Verification**: Test loading episode with 0:00-1:30 pre-roll ad; verify audio starts playing at 1:30 without playing 0:00.
  - **Dependencies**: 5.1.

- [x] **5.3 Floating Skip Notification & Instant Undo Toast**
  - **Component**: Frontend UI (`src/components/podcast/AdSkipToast.tsx` [NEW], `src/services/audio/GlobalAudioController.ts`)
  - **Details**: When an ad interval is skipped, dispatch event to `AdSkipToast`. Display non-intrusive bottom toast: "Skipped ad: [Brand/Sponsor] (1m 15s) — [Replay / Undo]". Clicking "Undo" seeks back to the start of the ad and sets a temporary playback bypass flag for that specific interval during current session.
  - **Verification**: Component test verifying toast renders with correct duration string and fires undo callback on button click.
  - **Dependencies**: 5.1.

- [x] **5.4 Scrubber Visual Ad Indicators & Manual Correction Controls**
  - **Component**: Frontend UI (`src/components/viewer/AudiobookViewer.tsx`, `src/components/podcast/AdIntervalEditor.tsx` [NEW])
  - **Details**: Render detected ad intervals on the player seekbar as amber/yellow striped segments. Add right-click / long-press context menu on scrubber: "Mark Ad Start", "Mark Ad End", "Remove Ad Segment". Allow listeners to manually adjust boundaries and persist corrections via `save_manual_ad_interval` / `delete_ad_interval`.
  - **Verification**: Manual UI test adjusting ad markers and verifying updated bounds are saved to SQLite and reflected in playback.
  - **Dependencies**: 1.5, 5.1.

---

## Phase 6: Mobile Energy & Native Integration

- [x] **6.1 Native Android Battery, Charger & Thermal JNI Bridge**
  - **Component**: Rust Backend / Android Native (`src-tauri/src/battery.rs`, `src-tauri/gen/android/app/src/main/java/app/plethora/battery/PlethoraBatteryBridge.kt` [NEW])
  - **Details**: Replace mock battery stub on Android. Implement JNI bridge to query `BatteryManager.BATTERY_PROPERTY_CAPACITY`, `IntentFilter(ACTION_POWER_CONNECTED)`, `PowerManager.isPowerSaveMode`, and register `PowerManager.OnThermalStatusChangedListener` (Android 10+). Return real battery percentage, charging status, power save mode, and thermal status (`NORMAL`, `LIGHT`, `MODERATE`, `SEVERE`, `CRITICAL`).
  - **Verification**: Run unit tests on Android simulator / device via adb to verify battery levels and power-saver detection.
  - **Dependencies**: 1.2.

- [x] **6.2 Native iOS Battery & Thermal Bridge**
  - **Component**: Rust Backend / iOS Native (`src-tauri/src/battery.rs`, `src-tauri/gen/apple/Sources/PlethoraBatteryBridge.swift` [NEW])
  - **Details**: Implement Swift bridge to `UIDevice.current.batteryLevel`, `UIDevice.current.batteryState`, `ProcessInfo.processInfo.isLowPowerModeEnabled`, and `ProcessInfo.processInfo.thermalState`. Expose to Rust via Tauri plugin FFI.
  - **Verification**: Verify compilation on iOS simulator and test low power mode state reporting.
  - **Dependencies**: 1.2.

- [x] **6.3 Mobile Background Work Scheduler & Charging Deferral**
  - **Component**: Rust Backend / Mobile Native (`src-tauri/src/mobile/scheduler.rs` [NEW])
  - **Details**: Integrate background ad detection jobs with Android `WorkManager` and iOS `BGProcessingTaskScheduler`. Enforce policy: if `batteryPolicy == ChargingOnly`, schedule job with `setRequiresCharging(true)` and `setRequiresDeviceIdle(true)`. If running on battery (<20% or Power Save mode), defer processing until next charge cycle.
  - **Verification**: Android instrumentation test verifying WorkManager task triggers only when charging constraint is met.
  - **Dependencies**: 6.1, 6.2.

- [x] **6.4 Dynamic Concurrency & Thermal Throttling**
  - **Component**: Rust Backend (`src-tauri/src/transcription/manager.rs`, `src-tauri/src/podcast/ad/mod.rs` [NEW])
  - **Details**: On mobile platforms, limit STT worker threads to 1 or 2 threads (preserving UI responsiveness). Monitor thermal state during processing: if thermal state rises to `SEVERE`, pause worker for 30 seconds; if `CRITICAL`, abort current chunk, persist partial progress, and defer until device cools down.
  - **Verification**: Unit tests simulating thermal state changes and verifying worker thread suspension and recovery.
  - **Dependencies**: 6.1, 6.2.

---

## Phase 7: Verification, Benchmarking & Documentation

- [x] **7.1 Comprehensive Rust & TypeScript Integration Tests**
  - **Component**: Tests (`src-tauri/tests/podcast_ad_detection_test.rs` [NEW], `src/test/podcastAdPlayback.test.ts` [NEW])
  - **Details**: End-to-end integration tests: 1) feed parsing with external JSON chapters, 2) cue detection and boundary snapping on synthetic audio, 3) lookahead playback skip without audible leakage, 4) manual boundary editing.
  - **Verification**: Run `cargo test` and `npm test` with 100% pass rate.
  - **Dependencies**: 1.5, 2.5, 3.2, 4.5, 5.1.

- [x] **7.2 Performance Benchmarking & Baseline Gate Registration**
  - **Component**: Performance (`src/podcastAd.bench.ts` [NEW], `scripts/perf-baselines.json`)
  - **Details**: Implement microbenchmarks using `vitest bench` and `seededRandom()`: measure cue detection regex throughput, interval merger performance, and 120ms lookahead search cost. Run `npm run bench:check` to establish and commit baselines into `scripts/perf-baselines.json`.
  - **Verification**: `npm run bench:check` exits 0.
  - **Dependencies**: 5.1, 4.2.

- [x] **7.3 User Documentation & Release Changelog**
  - **Component**: Documentation (`docs/podcasts.md`, `CHANGELOG.md`)
  - **Details**: Document ad removal feature, chapter drawer navigation, dual clean/verbatim transcript modes, mobile battery optimization policies, and manual correction workflows. Update `CHANGELOG.md` under unreleased section.
  - **Verification**: Review documentation for technical accuracy and markdown formatting.
  - **Dependencies**: All preceding tasks.
