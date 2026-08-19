# Change: Unify Audio Editions and Hands-Free Study Mode

## Why

Plethora already contains substantial TTS and audiobook infrastructure across multiple subsystems (8+ TTS provider adapters including OpenRouter, local Whisper/Groq transcription, an Audiobooks shelf tab, EPUB/audiobook pairing, and basic web media session hooks). However, audio generation and playback remain fragmented: audiobooks are treated as external or monolithic audio files disconnected from the core reading engine, generating long audio blocks the user from listening immediately, reading and listening progress are tracked independently, and mobile listeners cannot capture extracts or annotations hands-free while walking, commuting, or exercising.

This change unifies Plethora's TTS and audiobook capabilities into a single first-class **Audio Edition** system for any readable library item (EPUB, PDF, reflowed PDF, saved/imported web articles, and paired external audiobooks) coupled with a **Hands-Free Study Mode** that captures source-linked textual extracts, bookmarks, and learning moments via standard OS-level headphone/media remote commands without looking at a screen.

## What Changes

- **Canonical Audio Edition Model**: Define a first-class manifest model (`AudioEdition`) associating a source document and revision hash with semantic sections, generation settings, TTS provider/model/voice metadata, independent audio assets, and source-to-audio anchors.
- **Semantic Chapterization**: Replace arbitrary character/token chunking with structural segmentation leveraging EPUB TOC/spine, PDF outlines/reflow blocks, HTML article headings (`<h1>`-`<h3>`), and smart heuristic fallback sections.
- **Progressive Section Generation & Resumability**: Generate audio incrementally per chapter/section. Users can start playing Chapter 1 immediately while subsequent chapters generate in the background. Failures are isolated to individual sections with retry/cancellation and persistent job state surviving app restarts.
- **Generic Multi-Provider Integration with Guardrails**: Reuse Plethora's generic TTS abstraction (OpenRouter, Pocket TTS, Fal.ai, Android sherpa-onnx, ElevenLabs, OpenAI, System). Provide a simplified Quality abstraction (Fast / Natural / Best) alongside an Advanced selector, real-text voice preview from the active document, and character/duration/cost estimation guardrails before starting paid API generation.
- **Unified Reading & Listening Synchronization**: Maintain bidirectional alignment between reading progress and listening progress. Enable "Listen from here", "Open in book", and sentence/paragraph read-along highlighting using provider-agnostic source-to-audio anchor intervals.
- **Hands-Free Study Mode via Native Media Sessions**: Connect playback to native mobile media platforms (Android Media3 `MediaSession` / foreground service; iOS `MPRemoteCommandCenter` / background audio; Desktop media keys) using a normalized internal command stream (`PlayPause`, `Next`, `Previous`, `SeekForward`, `SeekBackward`).
- **Configurable Remote Headphone Mappings**: Provide a quick Normal vs. Study mode toggle allowing standard remote commands (e.g. Next / Previous) to trigger study actions like "Save Recent Extract", "Bookmark", "Replay Passage", "Mark Interesting", or "Mark Confusing" with subtle confirmation sound feedback and volume ducking.
- **Smart Recent Extract Extraction**: When triggering "Save Recent Extract", resolve playback timestamp $T$ against stored source/audio anchors and expand to clean sentence and paragraph boundaries rather than saving arbitrary time slices or raw audio blobs.
- **Listening Session Inbox & Learning Actions**: Aggregate hands-free extracts and markers into a deferred "Listening Session Inbox" for post-walk review (triage, Keep Extract, Add Note, Make Flashcard, Ask Plethora), fully integrated into Plethora's existing extracts, flashcards, and Document Q&A systems.
- **Lightweight Listen Later Queue**: Allow articles, web clippings, and document chapters to be enqueued for immediate or lazy continuous background audio playback.
- **External Audiobook Pairing Integration**: Extend Hands-Free Study Mode to externally paired audiobooks with confidence-based source resolution (high-confidence auto-extract vs. medium/low-confidence audio bookmarking for later verification).

## Capabilities

### New Capabilities
- `audio-editions`: Canonical data model, manifest persistence, lifecycle management, document-linked audio storage, source revision tracking, and backward-compatible migration from legacy audiobooks.
- `audio-edition-generation`: Semantic chapterization, progressive section-level TTS generation, provider-agnostic dispatch (OpenRouter/Pocket/Fal/Android/ElevenLabs/OpenAI/System), voice audition preview, cost & duration estimation guardrails, per-section failure recovery, and durable background job queue.
- `audio-source-sync`: Bidirectional read/listen position synchronization, text-to-audio anchoring across document types (EPUB, PDF, articles), read-along highlighting, "Listen from here" navigation, and external audiobook pairing alignment.
- `hands-free-study-mode`: Native mobile (Android Media3/MediaSession, iOS MPRemoteCommandCenter) and desktop media controls, normalized remote media commands, Normal vs. Study mode profiles, configurable command mapping, and non-intrusive audio feedback.
- `audio-learning-actions`: Source-linked "Save Recent Extract" with smart sentence/paragraph boundary expansion, semantic markers (Bookmark, Interesting, Confusing / Needs Explanation), contextual "Ask Plethora about what I just heard" Q&A scoping, and source-provenance flashcard creation.
- `listening-session-inbox`: Deferred review workflow for hands-free listening sessions ("Remember now, organize later"), batch triage UI, and daily listening stats aggregation.
- `listen-later-queue`: Lightweight audio queue for articles, web clippings, and document sections with lazy/immediate audio synthesis and continuous playlist playback.

### Modified Capabilities
<!-- No existing source-level capability spec requirements in openspec/specs/ are altered. Existing TTS and audiobook changes are extended into this unified framework. -->

## Impact

- **Frontend Subsystems**:
  - `src/api/audiobooks.ts` & `src/api/tts/`: Extended with Audio Edition manifests, progressive section jobs, and cost estimators.
  - `src/components/viewer/AudiobookViewer.tsx` & `AudiobookEpubSyncView.tsx`: Refactored to consume Audio Edition manifests, native media session bridges, and synchronized position controllers.
  - `src/components/tabs/AudiobooksTab.tsx`: Enhanced to display both standalone audiobooks and document-linked Audio Editions with generation progress and Listen Later queue.
  - `src/components/settings/TTSSettings.tsx` & `VoiceBrowser.tsx`: Integrated with document-aware voice previews and headphone command configuration.
  - `src/components/extracts/` & `src/stores/extractStore.ts`: Updated to support hands-free session inbox triage and source-linked audio provenance.
  - `src/utils/sectionIndex.ts`: Leveraged for semantic chapterization across EPUB, PDF, and HTML articles.
- **Backend & Native Subsystems (Rust & Mobile Plugins)**:
  - `src-tauri/src/commands/audiobook.rs`: Extended with Audio Edition manifest commands, section cache management, and progressive job management.
  - `src-tauri/plugins/plethora-android-tts/` & Android native layer: Android Media3 / `MediaSessionService` implementation receiving lockscreen/Bluetooth remote commands and emitting normalized events to Tauri.
  - iOS bridge: Integration with `MPRemoteCommandCenter` and `AVAudioSession` background playback.
- **Data & Migration**:
  - New SQLite / local store tables for `audio_editions`, `audio_edition_sections`, `audio_anchors`, and `listening_sessions`.
  - Idempotent migration path mapping legacy `audiobook-*` local storage records and single-file audio documents into Audio Edition structures.
- **Privacy & External APIs**:
  - Full adherence to Plethora privacy disclosures: explicit warnings before submitting document text to cloud TTS providers (OpenRouter, Fal, ElevenLabs, OpenAI).
  - No microphone access or covert environmental recording required; extracts are resolved directly from synchronized source text.
