## Context

Plethora ships document TTS through `ReaderTTSControls` with:
- `ReaderSpeechIndex` — anchored chunking preserving `SourceAnchor` per word
- `WordHighlighter` / `WordHighlightLayer` — DOM-range highlighting without per-word React trees
- `useSpokenWordFollow` — debounced narration follow with user-scroll pause
- `wordTimings.ts` + `api/tts/timing.ts` — provider timing normalization
- `ttsListeningPosition` — persisted playback position per document+profile
- `ttsCache` — audio cache with optional measured `wordTimings`

Parallel work (`add-ebook-audiobook-word-alignment`) adds `PlethoraAlignmentMap` + `PlaybackLookup` for ebook↔external-audiobook sync using Storyteller-inspired alignment. Both pipelines need the same runtime question: *at audio time T, which semantic text location is active?*

**Constraint:** Do not run fuzzy alignment on Plethora-generated TTS — source text is known before synthesis.

## Goals / Non-Goals

**Goals:**
- One shared `TimedTextMap` / `TimedTextPlaybackLookup` for TTS and audiobook alignment
- Word-level highlighting when timing precision permits; sentence/chunk fallback when not
- Stable semantic locators surviving reflow, font changes, orientation, pagination
- Intelligent narration follow (not per-word `scrollIntoView`)
- Pause/resume/seek/rate changes preserve semantic position
- Cache measured timings with generated audio; invalidate on input changes
- Deterministic unit tests without live TTS API calls

**Non-Goals:**
- Building OCR infrastructure for scanned PDFs (detect + degrade only)
- Forced-alignment fallback on TTS audio (future hook only)
- Replacing `ReaderSpeechIndex` chunking or provider adapters
- Media Overlay import/export
- Duplicating Storyteller `errorAlign` for TTS

## Decisions

### 1. Shared timed-text module (`src/lib/timedText/`)

```
TimedTextMap
  version, documentId, sourceType, fingerprint, entries[]

TimedTextEntry
  startMs, endMs, text, locator, granularity, confidence?, interpolated?, timingSource?

TextLocator (union)
  epub-spine | epub-href | pdf-word | pdf-token | text | page | html-block
```

`TimedTextPlaybackLookup` provides `findAtTime(ms)` (binary search) and `advance(ms)` (cursor). TTS builds a per-chunk map from `WordTiming[]` + `SpeechWord[]`; audiobook alignment adapts `PlethoraAlignmentMap`.

**Alternative considered:** Extend `WordTiming` directly — rejected because locators and source metadata differ from karaoke transcripts.

### 2. TTS timing generation (no re-transcription)

```
ReaderSpeechIndex chunks (words carry SourceAnchor)
    → synthesize TTS per chunk
    → provider returns timings OR boundary events OR duration only
    → normalize to WordTiming[] (positional 1:1 with chunk words)
    → build TimedTextMap slice for chunk
    → playback clock → lookup → WordHighlighter.highlightAnchoredWord
```

**Provider tiers:**

| Tier | Providers | Strategy |
|------|-----------|----------|
| BEST | ElevenLabs, fal (word/char timestamps) | `api/tts/timing.ts` normalizers, `source: measured` |
| GOOD | System Web Speech `onboundary` | charIndex → wordIndex via `charIndexToWordIndex` |
| GOOD | Android `onWordPosition` | charIndex in sentence → word index |
| ACCEPTABLE | Cloud without timings | `synthesizeWordTimings` over audio duration, softer CSS |
| DEGRADED | No duration yet | chunk-level highlight until duration known |

### 3. Locator strategy (reuse existing)

- **EPUB:** `{ kind: "epub", spineIndex, sectionOffset }` — runtime CFI from offset
- **PDF canonical:** `{ kind: "pdf-word", wordId }` — `[data-w="pN:wM"]` in reflow DOM
- **Plain/HTML:** `{ kind: "text", surface, startOffset }`
- **Audiobook alignment:** `{ kind: "epub", chapterHref, charOffset }` — adapter maps to highlight path

Locators are persisted; DOM nodes are never persisted.

### 4. Highlight rendering

Reuse `WordHighlighter`:
- `.tts-word-highlight` — measured timing
- `.tts-word-highlight--approx` — synthesized timing
- `.tts-chunk-highlight` — sentence/chunk fallback
- Theme via `color-mix(in srgb, var(--primary) …)` (existing)

No per-word React components. `WordHighlightLayer` effect runs on word index change only.

### 5. Narration follow

`useSpokenWordFollow` with `followSpokenWord` setting:
- Comfort-band scroll (28% desktop / 18% compact)
- 150ms debounce, 400ms same-word minimum
- User wheel/pointer/key suspends follow; re-center resumes
- E-ink / reduced motion → instant scroll, no smooth animation

### 6. PDF scanned detection

When canonical pipeline reports no usable body text or `source: "graphical"` dominance:
- TTS may still read extracted text if any
- Highlight degrades to chunk/page level
- UI indicates OCR required when no text layer (no fake word highlights)

### 7. Persistence & cache invalidation

`ttsListeningPosition` stores `{ chunkIndex, wordIndex, anchor, audioMs }`.

Cache key includes text digest + voice + provider. Measured `wordTimings` cached with audio; synthesized timings are never persisted.

Invalidate when: document text changes, chunking limit changes, voice/provider/model changes.

### 8. Parallel audiobook compatibility

`ebookAudiobookAlignment/playbackLookup.ts` re-exports shared `TimedTextPlaybackLookup` with `AlignedWord` adapter. No duplicate binary-search implementation.

Future `useAlignmentPlayback` and TTS both call the same lookup interface.

## Risks / Trade-offs

- **[Positional timing mismatch]** Provider returns N timings for M words → reject timings, fall back to synthesis. Mitigation: `wordTimingsAlignWith` guard (existing).
- **[System TTS boundary gaps]** Not all engines fire `onboundary`. Mitigation: chunk-level highlight; document in capability matrix.
- **[PDF non-canonical mode]** Legacy pdf.js text layer lacks word IDs. Mitigation: constrained text search fallback in `WordHighlighter`; canonical pipeline preferred.
- **[Large EPUBs]** Indexed text walk per section cached by DOM signature in `WordHighlighter`. Mitigation: signature cache (existing).
- **[Parallel merge conflicts]** Shared `timedText` is new directory; minimal edits to alignment files.

## Migration Plan

1. Add `src/lib/timedText/` with types, lookup, adapters
2. Point `ebookAudiobookAlignment/playbackLookup` at shared engine (thin wrapper)
3. Add `useTimedTextPlayback` hook; integrate in `ReaderTTSControls` word-tracking path
4. Add tests + run validation suite
5. Audiobook swarm adopts `TextLocator` union extension as needed

## Open Questions

- Sentence-level subtle highlight CSS (derive from word stream) — defer to v2 if perf concern
- SQLite backing for timing maps — sidecar/cache sufficient for v1
