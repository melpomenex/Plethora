# Change: Implement Plethora Video, Podcast, and Lecture Ingestion and Transcription

> Wave 3 — Cloud Capabilities. Hard-depends on proposals 2 + 5. Capability: `transcription` (Plethora-hosted cloud transcription + diarization + structuring). **Local transcription (whisper.cpp, sherpa-onnx, Groq-BYO) stays Free and is extended, not replaced.**

## Why

Podcasts, videos, YouTube, lectures, and local recordings are knowledge sources. The pipeline media → transcription → speaker/timestamp structure → readable document → sections → highlights → concepts → AI → flashcards makes them first-class Plethora documents. Today much of this exists locally; Pro adds cloud scale (long files, more languages, speaker diarization, higher accuracy) with quotas.

## What exists today (a lot)
- **Local transcription engines**: whisper.cpp sidecar (+ model manager, HuggingFace ggml downloads), sherpa-onnx (Parakeet TDT-CTC en, SenseVoice zh/en/ja/ko/yue); `transcription/job_queue.rs` (states pending/processing/completed/failed/cancelled, retry, priority, progress, auto-queue worker, idle scanner on media import); Groq cloud (BYO) for podcasts incl. mobile audio splitting.
- **YouTube**: full stack (yt-dlp detection/setup, innertube, transcripts w/ word timings, playlists, import-as-document with chapters, transcript karaoke sync); Vercel-relay transcript API.
- **Podcasts**: subscription/refresh/episodes/positions/downloads, auto-transcribe per feed, import-episode-as-document, transcript segments table.
- **Media**: `media_server.rs` range streaming (Android), video players with transcripts (`YouTubeViewer`, `LocalVideoPlayer` + `TranscriptPanel/Sync`), video extracts (scheduled FSRS-style excerpts), SponsorBlock.
- **Document conversion**: transcripts → documents exist (podcast import, YouTube import); segmentation; semantic indexing of transcripts (5's migration set: `transcripts`, `transcript_segments`).

## What Changes

### 1. Cloud transcription tier (`transcribe` job kind)
- Plethora-hosted STT (provider-abstracted): longer files, more languages, **speaker diarization** (speaker-labeled segments), higher-accuracy models; unit = audio minutes; envelope `transcription`.
- Provider routing: local (free, default for short/en files per user setting), cloud Pro; BYO Groq unchanged.
- Output shape: existing `transcript_segments` (start/end/text) + additive `speaker` label + word timings where available — same tables, additive column.

### 2. Transcript → first-class document pipeline (upgrade)
- Structured document generation from any transcript: speaker turns → sections/paragraphs; chapter/timestamp markers preserved as navigable locators (jump-to-media at any point — existing timestamp-anchored patterns); cleanup pass (filler removal, punctuation, paragraphing — model-assisted, optional per import); auto-title/summary/tags (existing task patterns).
- The generated document is a normal Plethora document: readable, highlightable, extractable, TTS-ready, semantically indexed (7), flashcardable (13) — timestamps survive into citations (`RagCitation.locator` timestamp form).

### 3. Ingestion sources (extend existing)
- Local audio/video files (existing media import — extended to route through the new pipeline when transcription enabled).
- Podcast episodes (existing auto-transcribe per feed — cloud tier eligible).
- YouTube (existing; policy-compliant paths only — see below).
- Lectures/recordings: batch folder import (existing folder-import plugin) with auto-transcribe.
- **YouTube policy guard**: ingestion uses documented APIs/yt-dlp as today; no download circumvention features are added; cloud transcription of YouTube-derived audio is explicitly **not** offered (client-side acquisition stays local, as today) — a deliberate compliance boundary.

### 4. UX
- Import dialog: source picker (file/folder/podcast/YouTube/URL), transcription engine choice (local/cloud/BYO) with cost+privacy disclosure, diarization toggle, cleanup toggle.
- Processing status: unified transcription-queue UI (existing store evolution) with per-item progress, retry, cancel, priority; failures non-destructive (media retained).
- Transcript review/correction: segment-level edit (existing transcript editing extended), speaker rename/merge across document, correction reflows citations.

### 5. Quotas & privacy
- Minutes/month envelope; pre-flight estimate by duration; audio uploads leave the device for cloud STT (disclosed; retention: transcripts TTL'd as artifacts then delivered; audio not retained post-job); exclusion flags apply; local logs unchanged.

## Impact

### Affected Specs
- `media-ingestion-transcription` — New (cloud tier, diarization, document pipeline, correction, quotas, YouTube boundary).

### Affected Code Areas
- `src-tauri/src/transcription/` (routing + diarization columns), `commands/{transcription,podcast,youtube,video}.rs` additive, media import hooks, transcript document builder (new `src-tauri/src/media_document/` or processor extension), transcript-segment UI extensions, server job kind, i18n.

### Non-goals
- No livestream capture, no YouTube downloading via cloud (policy), no video editing, no speaker identification by real-world identity (labels only), no cross-user transcript sharing.

## Dependencies

### Hard dependencies
- 5 (jobs/quotas), 2 (capability). Soft: 7 (indexing of generated docs), 13 (cards from transcripts via normal document flows).

### May run concurrently
- 16, 17, 19, 20.

### Must not start yet
- —.

## Shared interfaces
- `transcribe` job kind; `transcript_segments.speaker` additive schema (owned here); transcript-document builder API; transcription engine routing config.

## Ownership boundaries
- **May modify**: transcription modules, media import hooks, transcript UI, podcast/youtube command additive paths.
- **Must treat as external**: media_server streaming, video player internals (locator contract only), job framework, quota mechanics, semantic index (feed it documents normally).

## Collision risks
- `transcription/job_queue.rs` + `commands/podcast.rs` (high-churn; additive routing only); migration numbering; `transcriptionQueueStore` (owned here).

## Integration contract
- Generated documents are ordinary documents (no special-casing downstream); timestamp locators use the established video-citation shape from 7; queue UI extends existing transcription queue store.

## Testing & acceptance

### Tests
- Engine routing rules (local default heuristics, cloud eligibility, BYO passthrough); quota pre-flight by duration.
- Pipeline fixtures: synthetic transcript JSONs (multi-speaker, long) → document structure (sections, speaker turns, timestamp locators), cleanup toggles, title/summary generation mocked deterministically.
- Correction flows: segment edit, speaker rename propagation, citation reflow.
- Job lifecycle: long-file chunking/checkpoint/resume; cancel non-destructive; failure retry.
- Privacy: audio-not-retained assertions (server fixture), log scans, exclusion enforcement; YouTube cloud-boundary test (cloud STT refuses YouTube-flagged sources).

### Acceptance criteria
- A 2-hour local lecture recording becomes a structured, speaker-labeled, highlightable document with working jump-to-media and downstream AI/index/cards via cloud tier under quota; local whisper path handles the same file Free (slower, no diarization) with identical downstream document quality; existing podcast/YouTube flows unchanged.

### Must remain unchanged
- Local whisper/sherpa behavior and models; YouTube client acquisition path; video player features; existing benches.

## Open questions
1. Diarization availability per cloud provider + pricing model (per-minute vs per-speaker).
2. Cleanup default (off, preserving fidelity, vs on) — default off, per-import toggle.
3. Max cloud file size / upload chunking strategy for multi-GB video (extract audio locally first — default: local audio extraction then upload).
