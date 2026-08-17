# Change: Implement Plethora Premium Neural TTS and Audiobook Generation

> Wave 3 — Cloud Capabilities. Hard-depends on proposals 2 + 5. Capability: `premium_tts`. **Existing TTS stays entirely Free — this change adds Plethora-hosted premium generation on top.**

## Why

The app already speaks (9 provider adapters). Pro adds: premium neural voices hosted by Plethora, long-form/book generation as resumable jobs, a listening queue derived from reading materials, synchronized text highlighting during playback, and robust offline caching — turning documents and decks into personal audiobooks.

## What exists today (rich — this is an additive tier, not a rebuild)
- **TTS registry**: `src/api/tts/registry.ts` with 9 adapters — fal (incl. voice cloning), groq, pocket (local Kyutai sidecar), system, openrouter (24h catalog + snapshot + cost tiers), elevenlabs, openai, openai-compatible, android (sherpa-onnx Kokoro/Kitten via native plugin); unknown ids fall back to system. Pricing types (`TTSModelPricing`).
- **Playback integration**: `useTTS`/`useNativeAndroidTTS` hooks; audiobook viewer with epub↔audio sync (`AudiobookEpubSyncView`, `useSyncedPlayback`, `epubSync.ts`); karaoke text (`KaraokeText.tsx`) for transcripts with word timings; alignment cache (`alignmentCache.ts`, worker); audio-review mode (`audioReviewMode` settings); reading-position persistence (positions API).
- **Job-queue precedent**: transcription queue (states/retry/cancel/priority).
- **TTS state (Rust)**: `PocketTTSState`, `pocket_tts.rs` sidecar lifecycle — the pattern for managed local voices.

## What Changes

### 1. Plethora Premium voices (hosted)
- New registry adapter `plethora` (id namespace `plethora:*`): premium neural voice catalog served from the cloud service (catalog endpoint; voices/versioned metadata; cost handled by quota, not user-visible pricing).
- Segmented synthesis: text → sentences/paragraphs (existing segmentation) → chunks generated server-side with **word/sentence timestamps returned** (enables karaoke highlighting reuse) → client-side assembly with gapless playback (AudioContext scheduling; existing player patterns).

### 2. Long-form generation jobs (`tts_generate` kind on proposal-5 framework)
- Unit: characters; envelope `premium_tts` (chars/month). Pre-flight estimate per document/chapter with disclosure.
- Chapter segmentation from document structure (TOC/headings; existing chapter utils); per-chapter progress; partial generation usable (listen to chapter 1 while 2 renders); resumable (chunk-level checkpoints); cancellation keeps completed chunks.
- Offline caching: generated audio cached locally (per-document, eviction policy, storage accounting surfaced); cache export for full offline listening.
- Failure recovery: per-chunk retry with provider fallback to a secondary voice tier (config); never leaves a half-assembled file.

### 3. Listening queue
- A "Listen" queue derived from reading materials: documents/extracts/deck sessions enqueueable; derived from queue/reading list with filters; honors audio-review mode interplay.
- Playback position sync per item (existing positions API extended with `tts_position`); continue-listening surface on dashboard; skip/rewind controls; chapter/paragraph navigation (existing transcript-panel patterns).
- Synchronized highlighting: karaoke-style word highlighting for premium voices (timestamps) and best-effort sentence highlighting otherwise (alignment worker fallback) across document types incl. reflowed PDFs (canonical text) and EPUB (CFR/paragraph anchors).

### 4. Voice selection & controls
- Voice picker with previews (short sample generation, cached); per-document voice override + defaults; speed/pitch controls (existing knobs extended); pronunciation handling: user dictionary (word → phoneme/alias, e.g. "TLB → T-L-B"), applied pre-synthesis (local text transform, no content exfiltration beyond synthesis itself).

### 5. Privacy & eligibility
- Text of synthesized content leaves the device for premium synthesis (disclosed); audio artifacts TTL'd server-side (short, default 24h, then only local cache remains); logs carry no content; exclusion-flagged documents ineligible for cloud synthesis (enforced); local providers (pocket/system/android/BYO keys) remain fully free and unaffected.

## Impact

### Affected Specs
- `premium-tts-audiobooks` — New (premium tier, jobs, caching, listening queue, sync highlighting, pronunciation, privacy).

### Affected Code Areas
- `src/api/tts/` (new adapter + catalog), `src-tauri/src/plethora_cloud/` TTS client pieces, `hooks/useTTS` extensions, listening-queue store/UI, audiobook viewer sync extensions, positions API, server job kind, i18n.

### Non-goals
- No changes to existing provider adapters' behavior/pricing flows (BYO stays), no voice cloning via Plethora (fal BYO remains the cloning path), no music/soundscapes, no cross-device audio streaming (cache/download only), no podcast-feed changes (18).

## Dependencies

### Hard dependencies
- 5 (job framework/storage/quotas), 2 (capability), 3 (auth for cloud).

### Soft dependencies
- 16 (reconstructed documents become TTS-ready — natural composition, not a dependency).

### May run concurrently
- 16, 18, 19, 20.

### Must not start yet
- —.

## Shared interfaces
- `plethora` TTS provider adapter registered in the existing registry (consumes the registry's interfaces — no registry redesign); `tts_generate` job kind contract; `tts_position` in positions; listening-queue store API.

## Ownership boundaries
- **May modify**: TTS registry (additive adapter), useTTS extensions, audiobook/listening UI surfaces, positions extension.
- **Must treat as external**: registry architecture, alignment worker internals (extend inputs only), job framework, quota mechanics.

## Collision risks
- `src/api/tts/registry.ts` + provider dir (additive file; catalog refresh logic shared — additive); `hooks/useTTS.ts` (high-traffic file — keep changes additive behind the provider abstraction); settings `tts` subtree (7 adds `embedding` — different subtree); migration numbering (positions column).

## Integration contract
- Premium adapter implements the existing provider interface exactly (drop-in for all call sites); timestamps in the established word-timing shape used by `KaraokeText`/transcript sync.

## Testing & acceptance

### Tests
- Adapter: registry integration (selection, fallback-to-system on missing capability, catalog caching/versioning).
- Jobs: chunk-level resume; cancel-keeps-completed; quota pre-flight math (chars); fallback-voice path; artifact TTL deletion (server fixture).
- Playback: gapless assembly (no audible gaps at chunk boundaries in synthetic fixtures); position persistence round-trip; synchronized highlighting alignment (timestamps → karaoke ranges; sentence fallback).
- Listening queue: derivation filters; continue-listening; eviction policy.
- Pronunciation dictionary: applied pre-synthesis; no effect on local providers' text beyond the same transform (shared, documented).
- Privacy: content-in-logs scans; exclusion enforcement; local-provider regression suite unchanged.

### Acceptance criteria
- A user turns a 300-page document into a cached audiobook with chapter progress, premium voice, word highlighting, resume-everywhere positions, and offline playback; Free tier behavior byte-identical to today; quota surfaces accurate.

### Must remain unchanged
- All existing TTS providers and their settings; existing audiobook/podcast playback flows; perf gates (audio paths unmeasured — add bench only if hot paths identified).

## Open questions
1. Voice catalog size/refresh cadence and per-voice character pricing internalization (quota-only UX assumed).
2. Cache storage budget vs sync-storage accounting (6) separation.
3. Whether deck/review listening (audio review mode) uses premium voices under the same quota (default: yes, shared envelope).
