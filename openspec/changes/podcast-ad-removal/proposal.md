# Proposal: Local-First Podcast Ad Removal, Chapter Navigation & Integrated Transcripts

## Why

Podcast listening is increasingly degraded by repetitive, intrusive, and high-volume commercial advertisements, promotional bumpers, and cross-network promotions. While users desire an ad-free listening experience, existing solutions either require central cloud servers that re-encode podcast media (breaking publisher integrity and introducing latency), enforce rigid subscriptions, or leak private listening habits to third-party services.

Plethora already possesses robust local speech-to-text engines (including Cactus Whistle with the native Needle runtime, NVIDIA Parakeet, local Whisper via whisper.cpp, and Android on-device STT), a global audio playback controller, and interactive transcript synchronization. By introducing metadata-first candidate identification, contextual on-device advertising classification, precise boundary refinement, and a preemptive playback skip engine, Plethora can provide a seamless, non-destructive, local-first ad-free listening experience. Furthermore, integrating first-class chapter navigation and permanently attaching searchable, synchronized transcripts to episodes transforms podcasts from disposable audio streams into durable, high-value learning artifacts within Plethora's knowledge and incremental study ecosystem.

## What Changes

This change introduces an integrated, end-to-end podcast processing and playback architecture:

- **Multi-Stage Local Advertisement Detection**: An intelligent processing pipeline that evaluates publisher chapter metadata and description timestamps first (zero ASR cost), followed by speech transcription using the listener's configured STT engine, semantic ad classification with an on-device instruct model, boundary refinement leveraging silences and word alignments, and conservative interval merging.
- **Preemptive Ad-Free Playback Engine**: An audio policy enforcement layer in `GlobalAudioController` that eliminates audible ad leakage by calculating guard lookahead windows, preventing playback from starting inside ad intervals, and pre-seeking to content boundaries before decoded samples reach audio output hardware.
- **First-Class Podcast Chapter Ingestion and Navigation**: Comprehensive parser support for Podcasting 2.0 (`<podcast:chapters>`), Podlove Simple Chapters (`<psc:chapters>`), embedded ID3 `CHAP`/`CTOC` frames, and episode description timestamps, backed by a persistent SQLite repository and an adaptive touch-first chapter drawer.
- **Permanent Episode Transcript Association**: Any episode transcribed during ad preparation or study is permanently preserved in `podcast_episodes` and `podcast_transcript_segments`, enabling synchronized karaoke follow-along, in-transcript searching, extract creation, Anki flashcard generation, and AI Q&A.
- **Reversible Ad-Filtering Reading View**: Listeners can seamlessly toggle between a complete verbatim transcript (with ad intervals highlighted or collapsed) and a clean reading view without altering original media timestamps or extract anchors.
- **Mobile Energy & Thermal Management**: Native Android (`BatteryManager`, `PowerManager`, `WorkManager`) and iOS (`UIDevice`, `ProcessInfo`, `BGTaskScheduler`) platform bridges that replace hardcoded mobile stubs, enforcing conservative battery-saving defaults, charging-only background processing, and thermal throttling.
- **Configurable Processing Policies**: User-defined automation modes ("Battery Saver", "Smart Processing", "Always Process", "Manual Only") configurable globally, per podcast feed, or per episode.
- **Non-Destructive User Controls**: Instant undo/replay of skipped segments, manual ad boundary corrections, and feed-level skip overrides that persist across application restarts without re-encoding original media files.

## Capabilities

### New Capabilities
- `podcast-ad-detection`: Multi-stage ad detection pipeline combining metadata analysis, transcript-based semantic classification, boundary refinement, and interval merging.
- `podcast-ad-free-playback`: Preemptive ad-aware audio playback avoiding audible leakage, preserving original media coordinates, and supporting user overrides and undo.
- `podcast-chapter-navigation`: Ingestion of Podcasting 2.0, Podlove, ID3 CHAP, and description timestamps into persistent chapters, with responsive navigation and playback controls.
- `podcast-transcript-integration`: Permanent attachment of generated transcripts to episodes, dual complete/clean reading views, synchronized karaoke highlighting, search, and extract generation.
- `podcast-processing-policies`: Configurable user policies for automated vs. manual episode preparation across device profiles and network conditions.
- `mobile-energy-aware-processing`: Native Android and iOS energy monitoring, thermal tracking, and background scheduling constraints to prevent unexpected battery drain.
- `podcast-job-lifecycle`: Resumable, cancellable background preparation queue with persistent checkpointing and fault-tolerant multi-stage execution.

### Modified Capabilities
<!-- No requirement changes to existing capability specifications; existing STT routing and playback persistence are preserved and extended. -->

## Impact

- **Database**: Adds SQLite migrations for `podcast_chapters`, `podcast_ad_intervals`, `podcast_processing_jobs`, `podcast_processing_policies`, and `podcast_ad_corrections`.
- **Rust Backend (`src-tauri`)**:
  - `src-tauri/src/models/podcast.rs`: Adds data models for chapters, skip intervals, detection jobs, and policies.
  - `src-tauri/src/podcast/parser.rs`: Extends XML parsing to support `<podcast:chapters>` and `<psc:chapters>`.
  - `src-tauri/src/podcast/chapters.rs`: Introduces standalone chapter parser for JSON chapters, ID3 CHAP frames, and description timestamp extractors.
  - `src-tauri/src/battery.rs`: Implements native battery, thermal, and power-save signal bridges on Android (JNI) and iOS (Objective-C/Swift) to replace the hardcoded mobile placeholder.
  - `src-tauri/src/commands/podcast.rs`: Exposes IPC commands for ad intervals, chapters, manual corrections, and job management.
- **Audio Controller (`src/services/audio/`)**:
  - `globalAudioController.ts`: Upgrades `enforcePolicyInterval()` to perform preemptive seeking, guard lookahead calculation, and start-of-track ad suppression.
  - `audioSourceResolver.ts`: Enriches `describePodcast` with persisted chapter boundaries and policy intervals.
- **Frontend UI & Components (`src/components/`)**:
  - `src/components/media/PodcastManager.tsx`: Integrates preparation badges, chapter drawer trigger, ad-skip undo banners, and preparation settings.
  - `src/components/viewer/AudiobookViewer.tsx`: Connects podcast episodes to the existing chapter sidebar and mobile adaptive chapter sheet.
  - `src/components/media/TranscriptSync.tsx`: Adds visual ad-interval marking, collapsible ad blocks, and clean/full reading toggles.
  - `src/components/settings/AudioTranscriptionSettings.tsx`: Adds podcast ad detection model selection, sensitivity controls, and mobile processing policy settings.
- **Dependencies**: No external binary dependencies added. Reuses bundled sidecars (`needle`, `whisper-cli`, `sherpa-onnx`) and existing on-device LLM adapters (`plethora-android-genai`, `plethora-apple-intelligence`, `LocalDecisionEngineProvider`).
