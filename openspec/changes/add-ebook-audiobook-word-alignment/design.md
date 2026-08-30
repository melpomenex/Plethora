## Context

Plethora ships `AudiobookEpubSyncView` (split player + EPUB), runtime segment sync via `epubSync.ts`, TTS word highlighting (`WordHighlighter`, `readerSpeechIndex`), and audiobook transcription (Whisper/Nemotron sidecars). The deprecated `alignment.worker.ts` produced invalid CFIs. Storyteller's `@storyteller-platform/align` (MIT) implements production-grade error-tolerant alignment but depends on `@storyteller-platform/ghost-story` (GPL-3.0) for transcription/VAD/CTC.

**Current gaps:** segment-only sync, no persisted word map, no fuzzy ebook↔transcript alignment, no bidirectional word seek.

## Goals / Non-Goals

**Goals:**

- Word-level ebook ↔ audiobook timestamp mapping with error tolerance
- STT-provider-agnostic `TranscriptionTimeline` input
- Persisted `PlethoraAlignmentMap` sidecar (no EPUB modification)
- Efficient playback lookup (binary search + cursor advancement)
- Performant reader highlighting (DOM-level, no per-word React rerenders)
- Bidirectional seek, follow-narration scroll, shared progress locators
- Chapter-scoped alignment for novels (50k–200k words)
- Unit-testable aligner without live STT
- Desktop alignment generation; mobile map consumption

**Non-Goals (v1):**

- PDF word sync, EPUB Media Overlay export/import, cloud alignment service
- Pronunciation scoring, shadowing UI, AB repeat, clip flashcards
- Perfect alignment on severely mismatched editions

## Architecture

```
Audiobook files
    → Plethora STT (existing) → TranscriptionTimeline
    → Ebook chapter text (EPUB spine HTML)
    → Chapter matcher (title + n-gram boundary search, Storyteller-inspired)
    → errorAlign (ported MIT) per chapter window
    → Timestamp assignment + interpolation for gaps
    → PlethoraAlignmentMap (JSON sidecar + optional SQLite later)
    → PlaybackLookup (binary search)
    → EPUBViewer word highlight + AudiobookViewer seek
```

### Layer separation

1. **Transcription** — existing `api/transcription.ts`, providers unchanged
2. **Alignment** — `src/lib/ebookAudiobookAlignment/`
3. **Persistence** — sidecar JSON under app data `alignments/v2/`
4. **Playback sync** — `useAlignmentPlayback` hook
5. **Rendering** — extend `WordHighlighter` / EPUB sync CSS classes

## Storyteller Algorithm Analysis

**Studied files (MIT, `libraries/align/src/`):**

| File | Role |
|------|------|
| `errorAlign/errorAlign.ts` | Word-level pass + beam search subspan alignment |
| `errorAlign/editDistance.ts` | Error-align distance matrix (pure TS) |
| `errorAlign/backtraceGraph.ts` | Unambiguous match anchors |
| `errorAlign/utils.ts` | Tokenizer, normalizer, Alignment ops |
| `align/search.ts` | N-gram boundary voting for chapter matching |
| `align/interpolateSentenceRanges.ts` | Gap timestamp interpolation |
| `align/align.ts` | Full pipeline orchestration (EPUB repack — not adopted) |

**Algorithm summary:**

1. Tokenize ebook (reference) and transcript (hypothesis) with Unicode-aware regex
2. Normalize tokens (case fold, length-preserving transforms)
3. Levenshtein backtrace → unambiguous MATCH anchors
4. Between anchors: error-align beam search (we use pure-TS greedy backtrace fallback)
5. MATCH ops → word timestamps from transcript; DELETE/INSERT handled; SUBSTITUTE flagged
6. Chapter boundaries via n-gram voting (`findBoundaries`) on smooshed word strings
7. Interpolate timestamps for unmatched sentences/words proportionally to text length

## Licensing Decision

| Package | License | Use in Plethora |
|---------|---------|-----------------|
| `@storyteller-platform/align` | MIT | **Do not npm-import** — runtime dep on GPL ghost-story |
| `errorAlign/*` (pure TS subset) | MIT | **Port in-tree** with copyright notice |
| `@storyteller-platform/ghost-story` | GPL-3.0 | **Never import** |
| Native beam search (node-gyp) | MIT | **Skip** — use pure TS backtrace |

Plethora uses existing STT; only alignment logic is ported. Attribution in `src/lib/ebookAudiobookAlignment/ATTRIBUTION.md`.

## TypeScript vs Rust Decision

**Decision: TypeScript first** in `src/lib/ebookAudiobookAlignment/`.

- Aligns with existing `epubSync.ts`, `WordHighlighter`, web worker pattern
- Faster iteration from Storyteller TS source
- Clean interface (`alignChapter`, `PlethoraAlignmentMap`) allows future Rust port for mobile local alignment
- Run in Web Worker during generation to keep UI responsive

Rust remains appropriate later for Tauri background jobs on capable mobile devices.

## STT Abstraction

```typescript
interface TranscriptionWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

interface TranscriptionTimeline {
  providerId: string;
  providerVersion?: string;
  language?: string;
  words: TranscriptionWord[];
  segments?: { text: string; startMs: number; endMs: number }[];
}
```

Adapters:

- `fromAudiobookTranscript(segments)` — segment-only → synthesize word timings within segments
- `fromWordTimings(words)` — when provider returns word-level data
- Future: Nemotron, OpenRouter, Deepgram adapters reuse same output shape

## Alignment Engine

Per chapter:

1. Extract plain text from EPUB chapter HTML (strip tags, preserve word boundaries)
2. Slice transcript words to chapter audio time range
3. `errorAlign(ebookText, transcriptText)` → token alignments
4. Map MATCH/SUBSTITUTE tokens to `AlignedWord { locator, startMs, endMs, confidence, op }`
5. Interpolate remaining ebook words between anchored matches (length-weighted)
6. Compute chapter-level confidence = matched tokens / total ebook tokens

## Normalization Strategy

Deterministic, length-preserving where required by errorAlign:

- NFC Unicode normalization
- Lowercase (case fold)
- Smart quotes → straight; em/en dash → hyphen (display mapping preserved separately)
- Collapse whitespace in matching layer only
- Numbers/ordinals: optional spoken-form expansion (future)
- Mapping table: `normalizedIndex → original char offset` for highlight resolution

## Canonical Word Locator Strategy

```typescript
type EbookWordLocator =
  | { kind: "epub"; chapterHref: string; charOffset: number }
  | { kind: "html"; documentId: string; blockId: string; charOffset: number };
```

- **Primary:** `chapterHref + charOffset` in normalized chapter text (stable across re-render)
- **Runtime resolution:** map charOffset → DOM Range via indexed text walk (same as `WordHighlighter`)
- **CFI:** computed at runtime for epubjs navigation, not persisted (invalid when precomputed)
- Aligns with existing `SourceAnchor` `{ kind: "epub", spineIndex, sectionOffset }`

## Alignment Data Model

```typescript
interface PlethoraAlignmentMap {
  version: 2;
  bookPairId: string; // hash(ebookDocId + audioDocId + content hashes)
  ebookDocId: string;
  audioDocId: string;
  ebookContentHash: string;
  audioContentHash: string;
  transcriptFingerprint: string;
  granularity: "word";
  createdAt: string;
  chapters: AlignedChapter[];
  overallConfidence: number;
}

interface AlignedChapter {
  ebookChapterHref: string;
  audioChapterIndex: number;
  audioStartMs: number;
  audioEndMs: number;
  chapterConfidence: number;
  words: AlignedWord[];
}

interface AlignedWord {
  text: string;
  locator: EbookWordLocator;
  startMs: number;
  endMs: number;
  confidence: number; // 0-1
  interpolated: boolean;
  sentenceId?: number;
}
```

## Persistence

- **Path:** `{appData}/alignments/v2/{pairId}.json`
- **Invalidation:** stale when `ebookContentHash`, `audioContentHash`, or `transcriptFingerprint` changes
- **Size estimate:** ~40 bytes/word → 8MB for 200k words (acceptable for sync)
- **Partial alignment:** per-chapter status in map; resume from last completed chapter
- **DB:** defer SQLite table; sidecar sufficient for v1 (matches existing `alignmentCache.ts` pattern)

## Playback Synchronization

```typescript
class PlaybackLookup {
  private cursor: number;
  findWordAtTime(ms: number): AlignedWord | null; // binary search
  advance(ms: number): AlignedWord | null; // amortized O(1) forward
}
```

- Update on `audio.timeupdate` (throttled ~4–10 Hz, not per frame)
- Large seeks → binary search; forward play → cursor advance
- No alignment recomputation at playback time

## Reader Highlighting

- Reuse `WordHighlighter.highlightAnchoredWord` pattern with audiobook locators
- CSS classes: `.audiobook-sync-word`, `.audiobook-sync-sentence`, `.audiobook-sync-word--interpolated`
- Theme tokens via `color-mix(in srgb, var(--primary) …)` (existing TTS pattern)
- `useSpokenWordFollow` for scroll follow with user-scroll pause
- Sentence highlight: derive from `sentenceId` on aligned words
- Tap-to-seek: click handler on `.audiobook-sync-word` spans (not ordinary selection)

## Bidirectional Navigation

- **Audio → Text:** seek updates `syncCurrentTime` → lookup → highlight + optional `rendition.display(cfi)`
- **Text → Audio:** word span click → `audio.currentTime = word.startMs / 1000`
- Guard: require explicit sync-mode tap; text selection does not seek

## Progress Synchronization

- Store `{ pairId, locator, audioMs }` in document reading position metadata
- Opening ebook after listening: jump to aligned locator
- Opening audiobook after reading: seek to aligned `audioMs`
- Integrate with existing `useDocumentProgress` / audiobook position persistence

## Mobile Behavior

- **Generation:** desktop Tauri only (v1); show "Align on desktop" on mobile
- **Consumption:** load sidecar JSON; playback lookup + highlight work identically
- **Future:** Rust aligner in Tauri background task on capable devices

## Error Handling

- No transcript → prompt to transcribe first
- Chapter match failure → skip chapter, warn in UI
- Low confidence (<0.4) → sentence-level highlight fallback
- Corrupted sidecar → delete and regenerate
- Cancellation → abort worker, save partial map

## Confidence / Degraded Mode

| Tier | Threshold | Behavior |
|------|-----------|----------|
| high | ≥0.85 | Word highlight |
| medium | ≥0.5 | Word highlight, softer style for interpolated |
| low | ≥0.3 | Sentence/chunk highlight only |
| unusable | <0.3 | Chapter-level sync only; warn user |

## Performance Requirements

- Alignment: O(n·m) per chapter window, not whole book at once
- Worker offload for generation
- Playback lookup: <1ms per query
- Highlight: DOM mutation only, no React state per word
- Map load: parse JSON once, index by chapter

## Security / Privacy

- Local STT: audio stays local (existing behavior)
- Cloud STT: existing disclosure/consent flows
- Alignment sidecar contains text + timestamps only, no audio

## Testing

- **Unit:** normalization, errorAlign (Storyteller test vectors), interpolation, playback lookup
- **Fixtures:** synthetic ebook + transcript pairs covering adversarial cases
- **Integration:** fixture map → highlight controller → seek roundtrip
- No live Whisper in CI

## Migration / Backward Compatibility

- Deprecate v1 `AlignmentResult` / `alignment.worker.ts` (already marked deprecated)
- `alignmentCache.ts` reads v2 format; ignores v1 entries
- Existing segment sync remains fallback when no word map exists

## Rollout Strategy

- Feature flag: `experimentalWordSync` in settings (default on in dev)
- Existing `AudiobookEpubSyncView` auto-upgrades when map exists
- "Sync text and audio" action in sync view toolbar

## Future Features Enabled

Architecture supports without rewrite: Media Overlay export, bookmarks with audio timestamps, shadowing, AB repeat, cross-device sync of maps, cloud alignment, PDF with coordinate anchors, clip extraction for flashcards.

## Acceptance Criteria

See `tasks.md` — end-to-end: pair → transcribe → align → persist → play → highlight → seek → reopen → reuse map.

## File / Module Plan

| Module | Purpose |
|--------|---------|
| `src/lib/ebookAudiobookAlignment/types.ts` | Core types |
| `src/lib/ebookAudiobookAlignment/normalize.ts` | Text normalization |
| `src/lib/ebookAudiobookAlignment/errorAlign/*` | Ported MIT aligner |
| `src/lib/ebookAudiobookAlignment/chapterMatch.ts` | Chapter boundary matching |
| `src/lib/ebookAudiobookAlignment/alignChapter.ts` | Per-chapter alignment |
| `src/lib/ebookAudiobookAlignment/alignBook.ts` | Full book orchestration |
| `src/lib/ebookAudiobookAlignment/interpolate.ts` | Timestamp gap fill |
| `src/lib/ebookAudiobookAlignment/transcriptionAdapter.ts` | STT → timeline |
| `src/lib/ebookAudiobookAlignment/persistence.ts` | Sidecar read/write |
| `src/lib/ebookAudiobookAlignment/playbackLookup.ts` | Runtime lookup |
| `src/lib/ebookAudiobookAlignment/ATTRIBUTION.md` | Storyteller MIT notice |
| `src/hooks/useAlignmentPlayback.ts` | React integration |
| `src/workers/ebookAudiobookAlignment.worker.ts` | Background alignment |
| `src/components/viewer/AudiobookEpubSyncView.tsx` | UX integration |
| `src/components/viewer/EPUBViewer.tsx` | Word highlight props |

## Risks / Trade-offs

- **[No native beam search]** → Pure TS backtrace may differ slightly from Storyteller on edge cases; mitigated by word-level pass anchors
- **[Segment-only STT]** → Interpolated word times less accurate; mitigated by confidence tiers + sentence fallback
- **[Large maps]** → Chapter-scoped lazy load if needed later
- **[EPUB re-render]** → Locator is content-offset based, re-indexed on render like TTS

## Migration Plan

1. Ship alignment library + tests
2. Wire worker + persistence
3. Upgrade sync view UI
4. Remove deprecated worker after validation

## Open Questions

- SQLite table for sync lane integration (defer to progressive sync work)
- Default auto-align on pair detection vs manual trigger (manual for v1)
