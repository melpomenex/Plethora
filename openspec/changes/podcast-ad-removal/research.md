# Research & Codebase Audit: Podcast Ad Removal, Chapters & Transcripts

## Executive Summary

This research document records the verified findings from a comprehensive audit of the Plethora codebase and an in-depth study of the reference implementation Podly Pure Podcasts (`https://github.com/podly-pure-podcasts/podly_pure_podcasts`). Every claim herein is anchored to concrete source file lines in Plethora or Podly.

---

## 1. Codebase Audit

### Area A: Podcast Implementation & Playback Pipeline

#### Existing Capability
Plethora provides a full-featured podcast subscription and listening system supporting feed discovery, RSS enclosure ingestion, local audio download, background downloads, playback position persistence, silence skipping, and global playback ownership.

#### Relevant Code Paths
- [`src-tauri/src/models/podcast.rs:8-58`](file:///home/ubuntu/Code/Plethora/src-tauri/src/models/podcast.rs#L8-L58): `PodcastFeed` and `PodcastEpisode` definitions.
- [`src-tauri/src/podcast/parser.rs:12-496`](file:///home/ubuntu/Code/Plethora/src-tauri/src/podcast/parser.rs#L12-L496): Quick-XML based RSS 2.0 and iTunes namespace parser.
- [`src-tauri/src/commands/podcast.rs:28-340`](file:///home/ubuntu/Code/Plethora/src-tauri/src/commands/podcast.rs#L28-L340): Feed subscription, episode listing, streaming downloads (`download_podcast_episode`), and position tracking.
- [`src/api/podcast.ts:36-294`](file:///home/ubuntu/Code/Plethora/src/api/podcast.ts#L36-L294): TypeScript bindings for feed management, position updates, and local file lookup.
- [`src/services/audio/globalAudioController.ts:360-387`](file:///home/ubuntu/Code/Plethora/src/services/audio/globalAudioController.ts#L360-L387): Single-source-of-truth playback engine controlling HTML5 Audio, rate adjustment, volume ducking, and session lifecycles.
- [`src/services/audio/audioSourceResolver.ts:133-167`](file:///home/ubuntu/Code/Plethora/src/services/audio/audioSourceResolver.ts#L133-L167): `describePodcast(id)` converting an episode into a `ResolvedAudioItem` with parts, local file fallback, and resume timestamps.
- [`src/components/media/PodcastManager.tsx:603-619`](file:///home/ubuntu/Code/Plethora/src/components/media/PodcastManager.tsx#L603-L619): Feed list, episode list, and audio launch routing.
- [`src/components/viewer/AudiobookViewer.tsx:2065-2092`](file:///home/ubuntu/Code/Plethora/src/components/viewer/AudiobookViewer.tsx#L2065-L2092): Underlying player component rendered by `PodcastManager` for active episodes.

#### Actual Current Behavior
Episodes are fetched from RSS XML and stored in the SQLite database (`podcast_episodes`). Audio is played via `GlobalAudioController` which wraps an HTML `<audio>` element (via `HtmlAudioEngine`). Position is debounced (1.5s) and persisted both to SQLite and a shared CRDT document for cross-device sync.

#### Problems & Gaps
- `PodcastEpisode` and `ParsedPodcastEpisode` do not track chapter information or advertisement skip intervals.
- `describePodcast` wraps the episode into a single monolithic part, without segment or chapter boundaries.
- No UI currently exposes advertising status or allows triggering podcast ad removal.

---

### Area B: Podcast Chapter Navigation

#### Existing Capability
Plethora has rich chapter UI for audiobooks and documents inside [`AudiobookViewer.tsx`](file:///home/ubuntu/Code/Plethora/src/components/viewer/AudiobookViewer.tsx#L426-L430) (including a desktop sidebar, a mobile adaptive bottom sheet, chapter tick marks, and chapter sleep timer), but **podcast chapter support is completely missing**.

#### Relevant Code Paths
- [`src-tauri/src/models/podcast.rs:38-58`](file:///home/ubuntu/Code/Plethora/src-tauri/src/models/podcast.rs#L38-L58): `PodcastEpisode` struct contains 19 fields; none relate to chapters.
- [`src-tauri/src/podcast/parser.rs:51-145`](file:///home/ubuntu/Code/Plethora/src-tauri/src/podcast/parser.rs#L51-L145): Element stack in RSS parser only matches `title`, `description`, `pubdate`, `duration`, `link`, `guid`, `enclosure`, and `itunes:*` equivalents.
- [`src/components/viewer/AudiobookViewer.tsx:686-695`](file:///home/ubuntu/Code/Plethora/src/components/viewer/AudiobookViewer.tsx#L686-L695): Reads chapters strictly from `localStorage.getItem("audiobook-" + document.id)`.

#### Actual Current Behavior
Podcasts have zero chapter metadata extracted or stored. When `AudiobookViewer` plays a podcast episode, `chapters` is empty (`[]`), hiding all chapter controls unless the episode was promoted to an audiobook document with manual chapters.

#### Proposed Extension
1. Update `src-tauri/src/podcast/parser.rs` to detect `<podcast:chapters url="..." type="..." />` (Podcasting 2.0 namespace) and `<psc:chapters>` (Podlove).
2. Create `src-tauri/src/podcast/chapters.rs` to fetch and parse external JSON chapter files and extract ID3 `CHAP`/`CTOC` frames from downloaded audio.
3. Parse description timestamps as fallback generated chapters.
4. Add SQLite table `podcast_chapters` and connect it to `AudiobookViewer`'s existing adaptive chapter picker.

---

### Area C: Speech-to-Text (STT) Architecture & Engine Routing

#### Existing Capability
Plethora provides a unified speech-to-text routing system configured in `AudioTranscriptionSettings.tsx`, resolved via `resolveTranscription()`, and executed across desktop and mobile engines.

#### Verified Runtimes vs. Models
1. **Cactus Whistle & Cactus Needle**:
   - Model: `Cactus-Compute/whistle` (`whistle.cact`, 16.9 MB).
   - Runtime: `needle` / `needle.exe` standalone native binary sidecar on desktop; native compiled library in `plethora-android-stt` on Android.
   - Needle executes `--model whistle.cact --audio <wav> --audio-word-timestamps`, emitting JSON containing word-level timestamps (`start`, `end`, `word`, `probability`).
2. **NVIDIA Parakeet**:
   - Model: `parakeet-tdt-ctc-110m` or `v3`.
   - Runtime: `sherpa-onnx` sidecar with ONNX runtime (`--nemo-ctc-model`). Supports CPU or GPU (CUDA/DirectML).
3. **Whisper**:
   - Model: GGML models (`distil-small.en`, `small`, `base`, `large-v3`).
   - Runtime: `whisper-cli` (whisper.cpp) native sidecar, supporting CoreML on Apple Silicon, CUDA/DirectML on Windows/Linux, CPU fallback.
4. **Android On-Device**:
   - Runtime: `src-tauri/plugins/plethora-android-stt/` with `SttModelRegistry.kt` and `SttRecognizerEngine.kt`.
5. **Apple Speech**:
   - Runtime: Native macOS / iOS Speech framework via `plethora-apple-intelligence`.
6. **Cloud Providers (Optional with Explicit Consent)**:
   - Groq (Whisper Large v3 / Turbo) with word-level timestamps.
   - OpenRouter ASR.

#### Relevant Code Paths
- [`src/lib/transcriptionProvider.ts:15-32`](file:///home/ubuntu/Code/Plethora/src/lib/transcriptionProvider.ts#L15-L32): `TranscriptionAudioSettings` and model quality rank.
- [`src/lib/transcriptionProvider.ts:137-445`](file:///home/ubuntu/Code/Plethora/src/lib/transcriptionProvider.ts#L137-L445): Canonical `resolveTranscription()` evaluating hardware readiness and preferences.
- [`src/lib/transcriptionRouting.ts:59-99`](file:///home/ubuntu/Code/Plethora/src/lib/transcriptionRouting.ts#L59-L99): `routePodcastTranscription()` dispatching to Groq, Android on-device, or local desktop engines.
- [`src-tauri/src/transcription/engine.rs:264-280`](file:///home/ubuntu/Code/Plethora/src-tauri/src/transcription/engine.rs#L264-L280): `SherpaFamily` (Parakeet, SenseVoice, Zipformer) and whisper.cpp integration.
- [`src-tauri/src/commands/podcast.rs:432-761`](file:///home/ubuntu/Code/Plethora/src-tauri/src/commands/podcast.rs#L432-L761): `run_transcription_job()` downloading audio, invoking `TranscriptionEngine`, and persisting segments.

#### Problems & Gaps
- Previously, podcast transcription in `commands/podcast.rs` hardcoded Whisper model manager lookups, whereas `src/lib/transcriptionRouting.ts` had separate Groq / on-device paths.
- The user's explicitly selected STT provider must be respected for ad detection; hardcoding Whisper or forcing cloud transcription violates core requirements.

---

### Area D: Existing Transcript Persistence

#### Existing Capability
Plethora already stores podcast transcripts in SQLite and provides fallback resolution across multiple tables.

#### Relevant Code Paths
- [`src-tauri/src/database/migrations.rs:1552-1565`](file:///home/ubuntu/Code/Plethora/src-tauri/src/database/migrations.rs#L1552-L1565): Migration 044 adding `transcript_text`, `transcript_status`, `transcript_error`, `transcribed_at` to `podcast_episodes`.
- [`src-tauri/src/database/migrations.rs:1672-1689`](file:///home/ubuntu/Code/Plethora/src-tauri/src/database/migrations.rs#L1672-L1689): Migration 052 adding `podcast_transcript_segments` (`episode_id`, `segment_index`, `start_ms`, `end_ms`, `text`, `word_timings_json`).
- [`src-tauri/src/database/podcast_transcript_repository.rs:22-105`](file:///home/ubuntu/Code/Plethora/src-tauri/src/database/podcast_transcript_repository.rs#L22-L105): `resolve_podcast_transcript()` checking `podcast_episodes`, then `podcast_transcript_segments`, and falling back to `documents` / `transcripts` where `metadata.source = 'podcast:<id>'`.
- [`src/components/media/TranscriptSync.tsx:63-75`](file:///home/ubuntu/Code/Plethora/src/components/media/TranscriptSync.tsx#L63-L75): UI component rendering synchronized karaoke word and segment highlighting.

#### Actual Current Behavior
When an episode is transcribed, full text is saved to `podcast_episodes`, timed segments to `podcast_transcript_segments`, and a linked `Document` + `Extract` records are created for the reading system.

#### Critical Architecture Mandate
The ad removal system **must reuse** this exact transcript persistence infrastructure. Ad detection must never store transcripts in a separate, isolated store.

---

### Area E: Existing Audio Skip Infrastructure

#### Existing Capability
`GlobalAudioController` already supports `AudioPolicyInterval` and policy-based skipping.

#### Relevant Code Paths
- [`src/types/audioEdition.ts:154-159`](file:///home/ubuntu/Code/Plethora/src/types/audioEdition.ts#L154-L159):
  ```typescript
  export interface AudioPolicyInterval {
    id: string;
    category: string;
    startSec: number;
    endSec: number;
  }
  ```
- [`src/services/audio/globalAudioController.ts:173-191`](file:///home/ubuntu/Code/Plethora/src/services/audio/globalAudioController.ts#L173-L191):
  ```typescript
  private enforcePolicyInterval(sample: AudioEngineSample): boolean {
    if (!this.snapshot?.playIntent || !this.item) return false;
    // ...
    for (const interval of this.policyIntervals) {
      if (global < interval.startSec || global >= interval.endSec) continue;
      if (this.skippedPolicy.has(interval.id)) return false;
      this.skippedPolicy.add(interval.id);
      this.publish({ policySkip: { id: interval.id, category: interval.category, fromSec: interval.startSec, toSec: interval.endSec, at: this.now() } });
      if (interval.endSec - global > 0.05) {
        void this.seekTo(interval.endSec).catch(() => this.skippedPolicy.delete(interval.id));
      }
      return true;
    }
    return false;
  }
  ```
- [`src/services/audio/globalAudioController.ts:365-372`](file:///home/ubuntu/Code/Plethora/src/services/audio/globalAudioController.ts#L365-L372): Calling `playEngine()` before `sample()`, and checking `enforcePolicyInterval(sample)` inside `sample()`.

#### The Audible Leakage Defect
1. `sample()` is driven by the HTML `<audio>` element's `timeupdate` event, which fires roughly every 250ms.
2. By the time `enforcePolicyInterval` is evaluated, the playhead has **already entered** the interval by 50ms–250ms. The listener hears a burst of the advertisement before `seekTo` takes effect.
3. In `loadPart()` (line 365), `playEngine()` is called *before* `this.sample(...)`. If an ad starts at time 0 (pre-roll), playback starts immediately and plays the ad intro until the first sample arrives.
4. Seeking or resuming inside an ad interval similarly allows audio playback to begin before the seek-out fires.

#### Proposed Extension
1. **Preemptive Guard Lookahead**: Maintain a 100ms lookahead window in the audio controller loop.
2. **Pre-Seek on Load / Resume**: Check `policyIntervals` before issuing `play()` on initial load, chapter jump, or resume. If target position falls within an interval, seek to `interval.endSec` before unmuting or playing.
3. **Audio Output Withholding**: Mute audio output briefly during boundary transition until `seeked` event confirms position is past `interval.endSec`.

---

### Area F: Mobile Energy & Thermal Management

#### Existing Capability
`BatteryContext.tsx` provides battery awareness to React components via polling `get_battery_state`.

#### The Mobile Stub Discovery
- In [`src-tauri/src/battery.rs:58-66`](file:///home/ubuntu/Code/Plethora/src-tauri/src/battery.rs#L58-L66):
  ```rust
  #[cfg(any(target_os = "android", target_os = "ios"))]
  #[tauri::command]
  pub fn get_battery_state() -> BatteryState {
      BatteryState {
          is_present: false,
          level: 1.0,
          is_charging: true,
      }
  }
  ```
- In [`src/contexts/BatteryContext.tsx:70`](file:///home/ubuntu/Code/Plethora/src/contexts/BatteryContext.tsx#L70):
  ```typescript
  const onBattery = battery.isPresent && !battery.isCharging;
  ```
  Because `battery.isPresent` is hardcoded to `false` on mobile, `onBattery` is **always `false`**.
- An exhaustive audit of the codebase confirms that neither Android (`BatteryManager`, `PowerManager`, `ThermalStatus`, `WorkManager`) nor iOS (`UIDevice`, `ProcessInfo`, `BGTaskScheduler`) are currently integrated for energy awareness.

#### Proposed Extension
1. Android: Implement JNI calls in `battery.rs` or via a native plugin (`plethora-android-battery`) querying `BatteryManager` and `PowerManager.isPowerSaveMode()`.
2. iOS: Implement Swift bridge querying `UIDevice.current.batteryLevel`, `batteryState`, `ProcessInfo.processInfo.isLowPowerModeEnabled`, and `thermalState`.
3. Background Scheduling: Coordinate mobile batch jobs through Android `WorkManager` (with `setRequiresCharging(true)`) and iOS `BGTaskScheduler`.

---

## 2. Podly Implementation Analysis

We analyzed the checked-out codebase of Podly Pure Podcasts (`/tmp/podly_pure_podcasts/`).

### Key Modules Inspected

| Podly File | Purpose & Algorithm | Reusable Concepts | What Plethora Must Improve / Avoid |
| :--- | :--- | :--- | :--- |
| `src/podcast_processor/cue_detector.py` | Regex patterns for URLs, promo codes, phone numbers, calls to action, transitions, and self-promotion. | Highly reusable cue taxonomy, regex patterns, and span highlighting. | Add multilingual cue patterns; do not rely purely on keyword presence. |
| `src/podcast_processor/ad_merger.py` | Groups proximate segments (gap <= 8.0s), computes average confidence, extracts brand keywords, and merges shared-sponsor groups (gap <= 12.0s). | Proximity grouping, keyword intersection merging, and duration guardrails (>180s without cues = false positive). | Podly merges in Python dataclasses; Plethora will implement deterministic merging in Rust/TypeScript with explicit unit tests. |
| `src/podcast_processor/ad_classifier.py` | Windowed chunking with overlap (`_combine_overlap_segments`), LLM classification, JSON parsing, and neighbor expansion (`expand_neighbors_bulk`). | Overlapping transcript windows (at least 30s overlap), neighbor expansion heuristic, and retryable error classification. | Podly requires heavy OpenAI/LiteLLM cloud calls. Plethora prioritizes metadata-first (zero LLM) and local quantized models. |
| `src/podcast_processor/chapter_ad_detector.py` | Matches chapter titles against filter strings (e.g. "Sponsor", "Ad") to extract ad segments without ASR. | Direct conversion of sponsor chapters to ad intervals. | Podly treats chapter titles as binary cuts. Plethora treats them as candidates and validates them against duration guardrails. |
| `src/podcast_processor/chapter_reader.py` | Reads ID3 `CHAP` frames and `TIT2` sub-frames from MP3 files using Mutagen. | Extraction of embedded chapter titles and millisecond timestamps from media containers. | Podly uses Python `mutagen`. Plethora will implement this in Rust using `id3` and `mp4parse` crates. |
| `src/podcast_processor/description_chapter_parser.py` | Regex parser extracting monotonic timestamps (`HH:MM:SS` or `MM:SS`) and titles from description HTML. | Monotonic timestamp extraction, HTML entity unescaping, and validation against total media duration. | Port clean regex parser to Rust (`podcast/chapters.rs`). |
| `src/podcast_processor/boundary_refiner.py` & `word_boundary_refiner.py` | Secondary LLM pass prompting model for the exact 4 words at start/end, then linearly interpolating word times. | Prompt patterns identifying distinctive start/end phrases. | **AVOID**: Podly calls an expensive LLM for *every* ad break and interpolates unmeasured word times. Plethora uses real ASR word timestamps, silence detection, and phonetic alignment. |
| `src/system_prompt.txt` | Prompt instructing LLM on taxonomy (`technical_discussion`, `educational/self_promo`, `promotional_external`, `transition`). | Excellent taxonomy and boundary bias instructions. | Reusable with strict JSON schema enforcement for local quantized instruct models. |
| `src/podcast_processor/audio_processor.py` | Downloads media, cuts audio segments with FFmpeg, and re-encodes the entire MP3. | None for playback. | **DO NOT ADOPT**: Re-encoding destroys audio fidelity, takes minutes of compute, breaks byte offsets, and cannot run efficiently on mobile. Plethora uses non-destructive skip maps. |

---

## 3. Summary of Architectural Decisions

1. **Local-First & Non-Destructive**: Original podcast audio is preserved byte-for-byte. Ad removal is enforced by an in-memory, SQLite-backed skip map in `GlobalAudioController`.
2. **Metadata-First Hierarchy**: Obvious sponsor chapters and description timestamps provide immediate ad skipping with zero transcription or LLM compute.
3. **Respect Configured STT Engine**: Transcription routes through Plethora's existing `resolveTranscription()`, supporting Cactus Whistle/Needle, Parakeet/sherpa-onnx, Whisper/whisper-cli, and Android on-device STT.
4. **Permanent Transcripts**: Transcripts generated during ad detection are saved to `podcast_episodes` and `podcast_transcript_segments`, powering the transcript viewer, search, and Incremental Reading.
5. **Real Mobile Signals**: Replace mobile battery placeholders with native Android and iOS power, thermal, and task scheduling APIs.
