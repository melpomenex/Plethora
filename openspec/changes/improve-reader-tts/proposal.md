## Why

Document-reader TTS today starts from heuristics, not from where the user actually is. Pressing Play anchors via substring matching of the first few visible blocks against TTS chunks (`findVisibleChunkIndex`), via a `scrollPercent × totalChars` estimate with a flat "5 chars per word" conversion (`TextPositionIndex`), or via a stale saved scroll percentage — so after a TOC jump, on a repeated phrase, or halfway down a PDF page, playback routinely begins at the wrong paragraph, the wrong occurrence, or the beginning of a coarse chunk. Word highlighting exists but is default-off, unpersisted, anchored by global `indexOf`, and for generated audio the "current word" is a linear character-fraction estimate rather than real timing. The result feels nondeterministic, while the transcript/audiobook side of the app already ships a polished measured-vs-synthesized karaoke pipeline (`wordTimings`, `KaraokeText`, `TranscriptSync`) that document TTS does not share.

## What Changes

- **Exact start anchoring**: replace heuristic viewport/position resolution with a stable anchor model (`TTSStartAnchor`) resolved against an anchored speech index that preserves `displayed document text → normalized TTS text → word` mappings per reader (EPUB CFI + spine, PDF canonical word IDs / text-layer tokens / reflow blocks, text offsets for Markdown/HTML). Start priority on Play: explicit selection anchor → live visible-viewport anchor → authoritative reader position → saved position → beginning.
- **Mid-chunk starts**: starting at a word inside an existing TTS chunk plays from that exact word (sliced transient leading chunk with its own cache identity), never from the chunk start.
- **"Read from here" selection action**: new `readFromHere` action in the existing `SelectionActionBar` (Phosphor `SpeakerHigh`), driven by the existing selection snapshot's exact anchors (EPUB `cfiRange` start, PDF `canonical.startWordId` → `tokenData.startTokenId` → native range, text `startOffset`). Starts continuous reading, not selection-only playback.
- **TOC/TTS synchronization**: EPUB and PDF TOC navigation resolves the new visible location (after the rendition/scroll settles) into the authoritative next TTS start; while playing, playback retargets to the new location automatically; while paused, the resume anchor is rebased without playing.
- **Unified word-boundary timing model**: `WordTiming` gains a measured/synthesized source distinction; provider adapters declare timing capability and normalize word timestamps/speech marks when the upstream API supplies them; System Web Speech keeps real `onboundary` data; Android native gains a word-position event via `onRangeStart` where the engine supports it; audio-only providers use the shared `synthesizeWordTimings` fallback marked approximate.
- **Default-on spoken-word highlighting**: the spoken word is highlighted in the reader by default (persisted `TTSSettings` preference, default enabled), anchored to the correct document occurrence (CFI / canonical word ID / text offset), visually consistent with the transcript karaoke vocabulary and distinct from user highlights, search marks, and annotations.
- **Follow behavior**: the reader follows the spoken word using the transcript auto-follow semantics (comfort offset, debounced movement, arrival-based user-scroll detection); deliberate user scroll pauses following while playback continues; the existing Re-center affordance resumes following. Manual scrolling never retargets playback.
- **Safe retargeting**: generation/playback sessions carry epoch IDs so stale audio, native events, and buffers from a previous location can never play after a retarget; cached audio remains cached.
- No replacement of epub.js, PDF.js, the selection state machine, the provider registry, or the audio cache; this is an incremental evolution of `ReaderTTSControls`, the TTS provider result types, `wordTimings`, `WordHighlighter`, and the readers' anchor plumbing.

## Capabilities

### New Capabilities
- `tts-exact-start-anchoring`: Resolving an exact reader location (visible viewport, selection, TOC target, saved position) into an exact TTS chunk + intra-chunk word start, per reader type, including mid-chunk slicing and start-priority order.
- `tts-selection-start`: The "Read from here" selection action — toolbar integration, per-reader anchor extraction from the selection snapshot, and continuous-read semantics.
- `tts-word-boundary-sync`: The unified TTS timing model — measured vs synthesized sources, per-provider timing strategies (including System Web Speech and Android native), playback clock behavior, and active-word resolution.
- `tts-spoken-word-highlighting`: Default-on spoken-word highlighting in document readers — anchored to the correct occurrence, lifecycle-correct across pause/resume/stop/chapter/document switches, and visually distinct from other marks.
- `tts-toc-sync`: Synchronization between TOC/navigation events and TTS position, including playing/paused retarget behavior and stale-state invalidation.
- `tts-follow-behavior`: Auto-follow of the spoken word in the reading viewport, user-scroll pause detection, and re-center resume, with reduced-motion/e-ink handling.

### Modified Capabilities

(None — the related `word-highlighting`, `tts-auto-scroll`, and `position-aware-tts` specs exist only as unarchived deltas inside `openspec/changes/improve-pocket-tts/` and were never promoted into `openspec/specs/`; the capabilities above supersede them. Archive `improve-pocket-tts` before or alongside this change to avoid merge conflicts. `transcript-karaoke-sync` requirements are unchanged; this change only generalizes its shared timing utilities.)

## Impact

- **Components**: `src/components/common/ReaderTTSControls.tsx` (anchored chunking, start resolution, imperative start API, timing-driven word state), `src/components/common/WordHighlightLayer.tsx`, `src/components/viewer/DocumentViewer.tsx` (TTS wiring, selection action, TOC anchor plumbing, highlight preference), `src/components/viewer/EPUBViewer.tsx` (section-structured TTS text, TOC anchor resolution), `src/components/viewer/PDFViewer.tsx` (visible-token anchor, canonical mapping), `src/components/viewer/MarkdownViewer.tsx`, `src/components/viewer/selectionInteraction/SelectionActionBar.tsx`.
- **Utils**: new anchored speech index + anchor resolution modules (extending `src/utils/ttsTextExtraction.ts` / `src/utils/wordHighlighter.ts`); `src/utils/wordTimings.ts` gains timing-source metadata and TTS normalizers.
- **API/providers**: `src/api/tts/types.ts` (`TTSAdapterCapabilities`, `TTSAudioResult`, `GenerateSpeechResult` gain optional timing fields), adapters under `src/api/tts/providers/` (request/normalize timing where the provider supports it), `src/api/tts.ts`.
- **Native**: Android bridge (`src/api/tts/android/bridge.ts`, `SystemTtsFallback.kt`, `AndroidTtsPlugin.kt`, Rust shim) gains an optional word-position event; no regression to sentence-level events.
- **Settings**: `src/utils/ttsSettings.ts` (schema v4: persisted `highlightSpokenWord`, `followSpokenWord`, defaults on) and `src/stores/settingsStore.ts` migration.
- **i18n**: new `selectionBar.readFromHere`-style keys across locales.
- **Tests**: new suites for the speech index, anchor resolution, visibility threshold, timing normalization, ReaderTTSControls races/retargeting, follow behavior, and selection action (existing `surfaceIntegration.test.tsx` chip-count assertion must be updated).
- **Performance gate**: new/updated benchmarks for index build and active-word lookup follow `scripts/perf-baselines.json` protocol.
