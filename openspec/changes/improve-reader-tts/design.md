## Context

Plethora's document readers (Markdown, HTML/article, EPUB via epub.js, PDF via pdf.js fixed/reflow/OCR-HTML) all mount `ReaderTTSControls` (`src/components/common/ReaderTTSControls.tsx`) with a single flat `text` string, an optional `startPosition {pageNumber, scrollPercent}`, and `docType`. The component chunks that string (`buildChunks`, ~420/700 chars), buffers generated audio (`ttsCache` IndexedDB, 60s waterfall), and plays via one of three engines: `<audio>` from cloud/local providers, Web Speech `speechSynthesis`, or the Android native plugin (sentence-level events only).

Current anchoring is heuristic in three places:

1. `startPosition` → `TextPositionIndex.getPosition()` (`src/utils/ttsTextExtraction.ts:247–309`) maps `scrollPercent × totalChars` to a chunk and guesses the word offset as `chars / 5`; it is applied **once per text fingerprint** and ignores later position changes.
2. The de-facto Play anchor is `findVisibleChunkIndex()` (`ReaderTTSControls.tsx:348–451`): it takes the first 5 visible block elements and returns the first chunk whose normalized text contains (or is contained by) one of them — substring containment that mis-anchors on repeated text, TOC jumps, multiple mounted EPUB iframes, and mid-chunk viewports.
3. `WordHighlighter` (`src/utils/wordHighlighter.ts`) locates the spoken word by `indexOf` from an approximate cached offset over the whole container, falling back to whole-chunk highlight; word position for generated audio is a linear char-fraction estimate (`getWordOffsetAtTime`), not timing.

Meanwhile the repo already contains everything needed to do this exactly:

- **Selection snapshots** (`src/types/selection.ts`, `selectionInteraction/machine.ts`) carry exact anchors: EPUB `cfiRange` (epub.js CFI), PDF canonical v2 `startWordId/endWordId` (`p{N}:w{M}`), v1 `tokenData.startTokenId`, and `TextSelectionContext.startOffset/endOffset` (char offsets in the rendered root's flattened text).
- **Imperative reader runtimes**: `EpubVimRuntime` (`sections[].cfiForTextOffset/cfiForRange`, `reveal(cfi)`, `currentCfi()`, `rangeFromCfi`) and `PdfVimRuntime`, plus `pdfTextLayerRoots`/`pdfScrollContainer` already surfaced to DocumentViewer.
- **Canonical PDF model**: word IDs `p{N}:w{M}`, `data-w` spans in reflow DOM, `pdfAnchorResolver` with wordId → blockId → textQuote → best-rect resolution order.
- **Karaoke timing stack**: `WordTiming`, `findActiveWordIndex`, `synthesizeWordTimings` (`src/utils/wordTimings.ts`) with a measured-vs-synthesized contract; `useKaraokeClock` rAF interpolation and arrival-based user-scroll detection in `TranscriptSync`.

Constraints: do not replace epub.js, PDF.js, the selection state machine, the provider registry, or the audio cache; keep `QueueScrollPage`'s text-only usage of `ReaderTTSControls` working; Android must not regress. Related-but-separate: `improve-pocket-tts` (implemented, unarchived; its `word-highlighting`/`tts-auto-scroll`/`position-aware-tts` deltas are superseded here — archive it alongside this change) and `add-audio-editions-and-hands-free-study-mode` (audio-edition "Listen from here" is a different pipeline; share utilities where cheap, don't couple).

## Goals / Non-Goals

**Goals:**

- Play begins at an exact word: the first visible readable word, a selected word, or a TOC target — deterministically, including mid-chunk and on duplicated text.
- A "Read from here" selection action using each reader's strongest anchor.
- TOC navigation rebases TTS (auto-resume if playing, rebase-only if paused, never auto-start from stopped).
- A unified boundary/timing model: measured provider timings when available, real `onboundary` for System, `onRangeStart` for the Android fallback engine, shared synthesized fallback (marked approximate) otherwise.
- Default-on spoken-word highlighting anchored to the correct occurrence, in the transcript karaoke visual vocabulary.
- Transcript-style follow with user-scroll pause + Re-center, without ever retargeting playback on passive scroll.
- Race-safe retargeting (epoch IDs); cached audio survives retargets.

**Non-Goals:**

- No "read selection only" mode (continuous reading from the selection start only).
- No reader, provider-registry, cache, or selection-state-machine replacements; no new providers.
- No audiobook/audio-edition pipeline changes beyond optionally reusing shared anchor utilities.
- No PDF "page number = position" model, no scroll-percent math except as the last-resort fallback.

## Decisions

### D1. Four coordinate systems, never conflated

All TTS position state is expressed in exactly one of four coordinate systems, with explicit conversion functions between them:

| Concept | Representation | Owner |
|---|---|---|
| Document anchor | `SourceAnchor` (CFI, canonical word ID, token ID, text offset, page+offset) | reader/viewer |
| Speech position | `{chunkIndex, wordIndex}` into `ReaderSpeechIndex` | speech index |
| Audio timing | `WordTiming[]` with `source: "measured" \| "synthesized"` | timing model |
| Visual range | DOM `Range` / rect, resolved per anchor kind | highlighter |

Scroll percentages may only feed the last-resort fallback. This is the core fix: today all four are approximated by one string/percent space.

### D2. `ReaderSpeechIndex` — an anchored speech index (new `src/utils/readerSpeechIndex.ts`)

```ts
export type SourceAnchor =
  | { kind: "epub"; spineIndex: number; sectionOffset: number }   // char offset in the section's flattened text; CFI resolved lazily
  | { kind: "pdf-word"; wordId: string }                          // canonical p{N}:w{M}
  | { kind: "pdf-token"; tokenId: string }                        // v1 reflow token
  | { kind: "text"; surface: string; startOffset: number }        // flattened-text offset (markdown/html/ocr-html)
  | { kind: "page"; pageNumber: number; pageOffset: number };     // legacy PDF text window fallback

export interface SpeechWord { text: string; anchor: SourceAnchor | null; normStart: number; normEnd: number }
export interface SpeechSectionInput {
  key: string;                       // spine href / "page:37" / document key
  text: string;                      // extraction-cleaned text of the section
  anchorAt?: (offset: number) => SourceAnchor | null;
}
export interface TTSChunk {
  index: number;
  text: string;
  words: SpeechWord[];
  sectionKey: string;
  pageNumbers?: number[];
  transient?: boolean;               // sliced leading chunk from a mid-chunk start
}
```

`buildSpeechIndex(sections: SpeechSectionInput[], maxChunkSize)` concatenates sections in order, chunks with the existing sentence-greedy algorithm (`CHUNK_TARGET`/`CHUNK_MAX` preserved), and records every word's `normStart/normEnd` and `anchor`. Word boundaries come from the word stream, so chunk↔word mapping is exact, not `chars / 5`. Lookup APIs:

- `locate(anchor): {chunkIndex, wordIndex} | null` — per-kind resolution (see D4); O(log n) via per-section cumulative-offset binary search.
- `sliceChunkAtWord(chunkIndex, wordIndex): TTSChunk` — the mid-chunk start primitive (D5).
- `getScrollPercent(chunkIndex)` — retained for the legacy scroll sync path.

`TextPositionIndex` remains for the fallback level and for `getScrollPercent`, but `ReaderSpeechIndex` becomes the source of truth. Anchors are optional end-to-end (`anchorAt` may be null / absent), so the text-only `QueueScrollPage` usage keeps working with anchor-less words (highlighting then falls back to today's constrained text match).

**Text sources become section-structured and DOM-derived:**

- EPUB: new optional `EPUBViewer` prop `onSpeechSectionsChange(sections: {spineIndex, href, text}[])`, fired at the same cadence as today's `onContextTextChange` (350ms after `relocated`), one section per mounted spine item, text = the section document's flattened text (same extraction rules as `extractTextFromEPUBSection`). `anchorAt(offset) → {kind:"epub", spineIndex, sectionOffset}`.
- Markdown/HTML/OCR-HTML: sections built from the **rendered DOM** (`extractSpeechSectionsFromDOM` below), so `TextSelectionContext.startOffset` (flattened-text offsets via `buildTextSelectionContext`, `src/utils/textHighlights.ts:18–54`) and speech offsets live in the same coordinate space. Replaces DocumentViewer's current HTML-strip of `content`.
- PDF canonical path: the existing text-window builder (`PDFViewer.tsx` ~2320–2378) already emits per-page body blocks; extend it to also emit a per-page `offset → wordId` table built from the canonical blocks (blocks carry `wordIds` in reading order). Legacy path keeps `<page number="N"/>` markers → `page` anchors.

**Normalization with preserved mapping**: normalization is applied per section/segment while recording source spans, never to the whole document at once. Spoken text keeps original characters (whitespace collapse + marker stripping only); all cross-surface comparisons (chunk↔DOM, selection↔chunk) go through a new shared `foldForMatch()` (NFC + curly quotes/apostrophes → ASCII, ligatures expanded, em/en dashes normalized, whitespace folded). `foldForMatch` lives next to the speech index and is used by `WordHighlighter` matching too — fixing today's smart-quote/dash match failures.

### D3. `TTSStartAnchor` and the start-priority order

```ts
export type TTSStartAnchor =
  | { kind: "epub-cfi"; cfi: string }                       // selection / TOC fragment target
  | { kind: "pdf-word"; wordId: string }
  | { kind: "pdf-token"; tokenId: string }
  | { kind: "text-offset"; surface: string; startOffset: number }
  | { kind: "page-offset"; pageNumber: number; pageOffset: number }
  | { kind: "viewport" }                                    // resolve visible start now (D6)
  | { kind: "position"; pageNumber: number | null; scrollPercent: number | null }  // legacy fallback
  | { kind: "start" };
```

`resolveStart(anchor, index, ctx)` returns `{chunkIndex, wordIndex}` or null (null → next priority). On Play from a stopped state the resolver MUST attempt, in order: (1) explicit anchor (selection action, TOC-while-paused rebase), (2) `{kind:"viewport"}` resolved live at press time, (3) `position` from the reader's authoritative current location (EPUB CFI → section+offset; PDF visible page+offset), (4) saved persisted position, (5) start. A stale saved scroll percentage can never override a resolvable live viewport.

Pause/resume semantics: paused + no deliberate user scroll → resume at the exact paused word; paused + deliberate scroll → next Play re-anchors to the viewport (explicit intent); stopped → priority chain above. (This generalizes today's "restart fresh from visible if the user scrolled while paused" behavior.)

### D4. Anchor resolution per kind

- `epub-cfi`: `EpubVimRuntime.rangeFromCfi(cfi)` → DOM Range in the section → `textOffsetWithinSection(range.start)` → `locate({kind:"epub", spineIndex, sectionOffset})`.
- `pdf-word` / `pdf-token`: page from the `p(\d+)` prefix → that page's word/token table → section offset → `locate`.
- `text-offset` / `page-offset`: direct section lookup.
- Multi-iframe EPUB: the spine index disambiguates the section; never search across all mounted iframes (today's `findVisibleChunkIndex` failure mode).

`EpubVimRuntime.sections[i].cfiForTextOffset(el, offset, edge)` already exists for the reverse direction (word → CFI, used for reveal after follow-scroll jumps across sections).

### D5. Mid-chunk start: slice, don't seek

`sliceChunkAtWord` produces a `transient` chunk whose text is exactly `words[wordIndex..]` and which replaces that chunk's slot in the current **playback session's playlist** (`[...chunks.slice(0,i), sliced, ...chunks.slice(i+1)]`); the underlying index is untouched so a later start at chunk `i` from its beginning still hits the original cache entry. The sliced text has a distinct cache identity (key already includes the text digest), so generated-audio providers synthesize and cache the leading partial naturally. Text engines (System, Android) simply receive the sliced text. Blindly seeking into a cached full-chunk clip without measured timings is explicitly disallowed.

### D6. Viewport anchor: deterministic first-visible-word

New `src/utils/visibleText.ts`:

- `findFirstVisibleWord(candidates, viewport): {node, start, end, rect} | null` where candidates are word-level DOM ranges.
- **Visibility rule (normative, tested)**: a word qualifies when the intersection of its bounding rect with the reading viewport has height ≥ 50% of the word rect's height (fully-clipped or 1-px slivers never qualify) and non-zero width. If a line's words all fail, the next line is considered; if a paragraph yields nothing, the next paragraph is considered.
- Rects are translated through iframe boundaries via `frameElement.getBoundingClientRect()` (same math as `selectionInteraction/geometry.ts` / `wordHighlighter`).
- Scanning is top-down in document order and **stops at the first qualifying word**; paragraphs are pre-rejected with a single `getBoundingClientRect`. Runs only on Play/retarget — never per frame.

Per reader, implemented as `resolveVisibleStart(): Promise<TTSStartAnchor | null>` and exposed to DocumentViewer through the existing runtime handles:

- **EPUB**: among mounted sections (continuous manager keeps several), pick the one whose iframe intersects the viewport top-most; walk its text nodes; anchor = `{kind:"epub", spineIndex, sectionOffset}` (CFI via `cfiForTextOffset` when a Range target is needed later).
- **PDF fixed**: iterate rendered text-layer roots (already collected in `pdfTextLayerRoots`) in page order; candidates from pdf.js text spans; map the winning span to `pdf-word` via the page's canonical word table (rect-overlap match, falling back to text-order index within the page), else `page-offset`. Halfway down page 37 ⇒ first visible word on page 37, never page start.
- **PDF reflow**: first visible `[data-pdf-reflow-block]` → first visible `[data-w]` span → `pdf-word` anchor.
- **OCR-HTML**: iframe `.page` divs → word nodes → `text-offset` (surface `"pdf-ocr-html"`).
- **Markdown/HTML**: flattened-text walk of the scroll container / iframe body → `text-offset`.

Fallback if nothing resolves (virtualized/unrendered pages, hidden doc): level 3–5 of D3. PDFs with no usable text and no OCR: fail gracefully (no playback jump), preserving today's OCR behavior.

### D7. Unified timing model (extends `wordTimings.ts` + provider types)

```ts
export type WordTimingSource = "measured" | "synthesized";
export interface WordTiming { word: string; start_ms: number; end_ms: number; source?: WordTimingSource }
```

Optional field: transcript producers keep compiling; TTS always sets it. Approximate timings MUST never be represented or persisted as measured (same contract as transcripts: distinct rendering, never persisted).

Provider surface (`src/api/tts/types.ts`):

- `TTSAdapterCapabilities` gains `supportsWordTimings: boolean` (default false in `createBaseCapabilities`-style helpers so unmodified adapters compile).
- `TTSSynthesizeRequest` gains `includeTimings?: boolean`; `TTSAudioResult` and `GenerateSpeechResult` gain `wordTimings?: WordTiming[]` (always `source:"measured"` when set by an adapter).
- New `src/api/tts/timing.ts`: per-provider normalizers mapping char/word timestamp payloads onto the chunk's `SpeechWord[]` boundaries (positional, never string re-splitting; char indices → word via `normStart/normEnd`).

Per-provider strategy (capability-driven; adapters that gain timings opt in):

| Provider | Strategy |
|---|---|
| elevenlabs | Use the `/text-to-speech/{voice}/with-timestamps` endpoint when `includeTimings`; map `character_start/end_times` chars → words. |
| openai | Request timed output only per current OpenAI speech API docs at implementation time (gpt-4o-mini-tts timed-text support varies by account); keep binary otherwise. |
| openai-compatible | Parse Azure-style word-boundary metadata when the endpoint returns it; tolerate unknown bodies. |
| fal | Parse known timing shapes from the model JSON (the adapter already surfaces full provider JSON in `rawOutput`); unknown shapes → no timings. |
| plethora | The hosted model already advertises timestamp synchronization — implement the payload's word timestamps; until the API ships them, leave `supportsWordTimings: false`. |
| groq, pocket, openrouter | No timing API → synthesized fallback (pocket's real `durationSec` feeds the synthesis, making it materially better than today's heuristic). |
| system | Keep real `onboundary`: map `charIndex` → word via chunk word `normStart/normEnd` (binary search), replacing the re-splitting `charIndexToWordOffset`. |
| android | See D8. |

Playback clock and active word (replaces `getWordOffsetAtTime`):

- `<audio>`: rAF loop reading `audio.currentTime` (authoritative), re-anchored on coarse updates, committing React state **only when `findActiveWordIndex` changes** (~per word, not per frame). Interpolation pattern from `useKaraokeClock` (50ms min step) if coarse `timeupdate` proves janky.
- Chunk timings: measured `wordTimings` when `wordTimingsAlignWith(chunk.text, t)`; else `synthesizeWordTimings(chunk.text, 0, durationSec)` (char-weighted, 60ms floor — strictly better than the removed linear estimate) with `source:"synthesized"`.
- Suspend the loop while paused/stopped/hidden; paused state highlights the paused word with no loop.
- The measured-vs-synthesized distinction reaches the highlighter (subtler tint for approximate — mirrors `KaraokeText` EXACT/APPROXIMATE classes).

### D8. Android native timing

- Bridge (`src/api/tts/android/bridge.ts`, `AndroidTtsPlugin.kt`, Rust shim): add event `tts://word-position` with `{utteranceId, sentenceIndex, charIndex, charLength?}`. `SystemTtsFallback.kt` overrides `onRangeStart(utteranceId, start, end, frame)` (Android's word-boundary callback — currently unimplemented) and emits it; utterance/sentence bookkeeping already exists in `startUtterance`.
- Sherpa engine path cannot surface word timings (streams PCM only): keep `sentencePosition` events as timing anchors and interpolate within the sentence via the shared synthesized fallback — marked approximate.
- Frontend: word events drive the active word directly when present; `ReaderTTSControls` filters native events by `utteranceId` against a monotonic ref (the stale-guard pattern already documented in `useNativeAndroidTTS.ts`) — today it subscribes without that guard. Sentence-level auto-advance behavior unchanged.

### D9. Anchored highlighting (`WordHighlighter`/`WordHighlightLayer` upgrade)

New primary API: `highlightAnchoredWord(chunk: TTSChunk, wordIndex: number): boolean`.

- `text` anchors resolve via the existing `IndexedText` flattened-text cache to `{node, startOffset, endOffset}` — direct range, no search.
- `epub` anchors select the highlighter instance for that section's iframe (`WordHighlightLayer` already keeps per-body instances; add section-key → instance mapping) — duplicate text in another spine item can never match.
- `pdf-word`: reflow → `[data-w="{wordId}"]` direct lookup; fixed → canonical word table → text-layer span range.
- Anchor-less words (text-only callers) use the legacy match, but constrained to the chunk's section container and using `foldForMatch` — globally-first `indexOf` is removed.
- Return `false` on resolution failure → whole-chunk fallback highlight (existing graceful degradation retained).
- Styling: same span-wrapping mechanism; the spoken-word style moves to theme tokens matching the karaoke vocabulary (`bg-primary/15 text-primary` measured, `bg-primary/10` synthesized; flat variant under e-ink via `:root[data-display-mode="eink"]`), clearly distinct from user highlights (amber `<mark>`s), search marks, and selection. No per-word animation/pulse.

### D10. Follow behavior (new `useSpokenWordFollow` controller)

Ports `TranscriptSync`'s follow semantics to the reader scroll container:

- Target: active word rect top pinned at a comfort offset above center (reuse `FOLLOW_OFFSET_RATIO_DESKTOP = 0.28` / compact 0.18), debounced (`FOLLOW_DEBOUNCE_MS = 150`), coalesced per line — never per frame; skip if already inside the comfort band.
- **User-scroll detection is arrival-based** (record programmatic target, ±2px arrival epsilon, 120ms grace; real `wheel`/`pointerdown`/`keydown`/`touchstart` input always wins) — identical semantics to `TranscriptSync` so behavior is predictable across surfaces.
- On deliberate user scroll during playback: playback and highlighting continue, follow pauses, and the existing Re-center affordance (`autoScrollPaused` + `onReCenter` props / amber button in `ReaderTTSControls`) restores follow. Passive scrolling NEVER retargets playback (retargets happen only via the explicit operations in D12's state model).
- Reduced motion / e-ink (`usePresentation().reducedMotion`, `useIsEink()`): instant `auto` scrolling instead of smooth; no animations. (Today neither TTS surface consults this — fixing here for the reader path.)
- PDF fixed mode follows via the text-layer rect in the page scroll container; page auto-advance through `onComplete` is preserved. EPUB: intra-section follow scrolls the iframe's scroll container (continuous manager) — the existing `findScrollableContainer` iframe-aware logic is reused; cross-section reveal uses `reveal(cfi)`.

### D11. "Read from here" selection action

- `SelectionBarAction` gains `"readFromHere"`; a `SpeakerHigh` (bold) chip is inserted **after Ask, before Extract** (discoverable, before lower-frequency Extract/Copy); horizontally scrollable bar already tolerates the extra chip. Gated by a new `canReadAloud?: boolean` prop (host passes TTS-enabled && surface supports anchoring). Accessible label from new i18n key `selectionBar.readFromHere` (all locales).
- DocumentViewer handler: `controller.captureForAction()` → map `snapshot.selectionContext` to `TTSStartAnchor` in anchor-preference order:
  - EPUB: `cfiRange` (start of range; first of `cfiRanges` for cross-section selections).
  - PDF: `canonical?.startWordId` → `tokenData?.startTokenId` → native text-layer range → `{kind:"page-offset"}` from `pages[0]`. Canonical selection is never reduced to string matching.
  - Reflow: canonical word IDs (same as above via the canonical v2 anchor).
  - OCR-HTML / markdown / html: `startOffset` (surface-tagged).
- Then: stop/cancel current session, `startFrom(anchor)` (D12), dismiss the selection UI via the existing `dismiss` path. Unmappable anchor → error toast, no playback change, selection still dismissed. The action starts **continuous reading from the first selected word** — it is not selection-only playback, and no settings dialog is opened.

### D12. Session state model and race strategy

Playback session states: `stopped → starting → playing ⇄ paused`, plus orthogonal `follow: following | paused-by-user`, plus `pendingAnchor` (TOC/paused-rebase target awaiting consumption). Transitions:

- Play (from stopped): resolve anchor per D3 priority → `starting` → first audible word = anchor word → `playing`.
- Pause/Resume: freeze/restart the clock at the exact word; no re-anchoring unless the user deliberately scrolled while paused (then viewport re-anchor on resume).
- `startFrom(anchor)` (selection, TOC-while-playing, rapid re-invocations): `stopped`→ resolve → `starting` at the new anchor.
- TOC while paused: consume anchor into `pendingAnchor`; resume point rebased; no audio.
- Document switch / unmount: full teardown (existing effects extended).

Race safety generalizes `playbackIdRef` into a **session epoch**:

- `sessionIdRef` bumped on every stop/retarget/voice/text change. Generation tasks (`generateChunkAudio`, prefetch waterfall) capture the epoch at start and validate before enqueueing results; stale results are dropped and their non-cached object URLs revoked. IndexedDB cache entries survive (only the active buffer/session is invalidated).
- Native listeners filter `utteranceId` (D8). Old-location audio can never start after a retarget.
- Buffer rebase: `preBufferChunks` restarts from the new anchor index; in-flight generation for dropped chunks is ignored on completion (not aborted mid-flight — provider requests are allowed to finish and simply aren't played; their cache writes are still valid).

### D13. TOC synchronization

- **EPUB** (`handleTocClick`): after `rendition.display(target)` (fragments preserved by the existing href normalization) resolves **and** the `relocated` event + one iframe render pass settle, call `resolveVisibleStart()` and emit `{anchor, wasPlaying}` via a new narrow prop `onNavigationAnchorResolved`. Never trust `currentScrollPercent` right after a jump. An `#anchor` fragment target resolves to the visible target (the section the fragment scrolls to), not the spine-item start.
- **PDF** (`handleTocClick`): after the nav-stability scroll settle (existing tokens), resolve the first visible token anchor and emit the same callback.
- DocumentViewer consumes it: playing → `startFrom(anchor)` (epoch bump + auto-resume); paused → `pendingAnchor` rebase; stopped → store as the next Play's level-1 anchor. Clicking a TOC entry never starts playback from a stopped state.

### D14. Settings and persistence

`TTSSettings` schema v3 → v4 (`src/utils/ttsSettings.ts`): add `highlightSpokenWord: boolean` (default **true**) and `followSpokenWord: boolean` (default **true**) as separate preferences with separate semantics; migration fills defaults; `sanitizeTTSSettings` handles them. DocumentViewer replaces the unpersisted `useState(false)` (line 573) with the store; the ReaderTTSControls toggle and follow toggle persist through the store. This intentionally supersedes `improve-pocket-tts`'s "off by default" delta — that change must be archived alongside this one.

### D15. Performance

- The speech index is built once per text/sections change (memoized), never per frame; `locate()` is O(log n) after build; the active-word path after indexing is O(1) amortized (state commits only on word change; DOM range from anchor, no scans).
- No global `indexOf` against large books; no full-document DOM walks per word (D6 runs only at Play/retarget and stops at first hit); no reader-wide re-render per word (word state stays inside `ReaderTTSControls`/`WordHighlightLayer`; DocumentViewer is untouched per word).
- Iframe listeners and injected styles are cleaned up on section unmount/theme change (extend existing `WordHighlightLayer` sync logic); stale `<audio>` elements and object URLs are revoked on rebase/teardown; transient sliced chunks participate in the existing cache LRU (no unbounded growth).
- New `src/utils/readerSpeechIndex.bench.ts` + `visibleText.bench.ts` benchmarks follow the `scripts/perf-baselines.json` protocol (seeded PRNG from `src/test/bench-support.ts`); intentional cost changes update baselines in the same PR.

## Risks / Trade-offs

- [epub.js CFI↔offset fidelity: `cfiForTextOffset` edge cases, multi-iframe continuous manager] → anchors resolve lazily and may return null, which falls through the priority chain (never worse than today); property-style tests against fixture EPUBs; `reveal(cfi)` retry pattern already exists in the runtime.
- [Provider timing payloads are API-version-dependent] → normalizers tolerate unknown shapes (return no timings → synthesized fallback); `supportsWordTimings` defaults false, so behavior changes only where implemented; exact request shapes verified against current provider docs during implementation.
- [Android `onRangeStart` exists only on the fallback engine] → sherpa path stays sentence-anchored + synthesized (marked approximate); no Android regression; word events are additive.
- [Virtualized PDF: target pages may not be rendered when resolving anchors] → resolution restricted to rendered text layers with graceful fallback to the position anchor; `PdfVimRuntime.revealPage` used when follow needs an unrendered page.
- [Selection offsets unstable under re-render] → the snapshot is immutable and consumed immediately; anchored index rebuilt on content change; `data-highlight-wrapper` filtering already excludes wrapper spans from flattened text.
- [Two chunkers coexist (`buildChunks` vs `chunkTextForTTS`)] → `chunkTextForTTS` becomes a thin wrapper over the shared word-stream packer with identical semantics for `useTTS`/native callers; covered by existing `ttsTextExtraction` tests plus new parity tests.
- [Text source moves from string-stripping to DOM-derived for markdown/HTML] → parity tests assert the spoken text is equivalent modulo whitespace; skippable-element rules (`nav`, `script`, `style`, hidden, `aria-hidden`, app chrome) codified in `extractSpeechSectionsFromDOM`.
- [Bigger surface area in `ReaderTTSControls`] → the component keeps its prop contract; new behavior arrives via the speech index, the imperative handle, and the follow hook; no consumer rewrite (QueueScrollPage unchanged).

## Migration Plan

Incremental, each step shippable:

1. Timing foundations: `WordTiming.source`, provider type extensions (no behavior change), `useKaraokeClock`-style clock loop replacing `getWordOffsetAtTime`.
2. Speech index + section-structured text (EPUB `onSpeechSectionsChange`, DOM-derived markdown/HTML sections, PDF anchor tables); `TextPositionIndex` demoted to fallback; chunker unification with parity tests.
3. Viewport anchor resolution + start priority + mid-chunk slicing wired into Play.
4. Anchored highlighting default-on + settings v4 + persisted toggles.
5. Follow controller + Re-center + reduced-motion handling.
6. Selection "Read from here" action (bar chip, host handlers, i18n).
7. TOC sync (EPUB/PDF anchor callbacks, playing/paused retarget).
8. Provider timing adapters + Android word events (bridge, Kotlin, Rust shim) — additive.
9. Tests/benchmarks throughout; archive `improve-pocket-tts` alongside.

Rollback: every step is behind ordinary commits; settings v4 fields are ignored harmlessly by v3 readers after `sanitize`; no data migrations beyond the settings schema. Reverting a step restores the previous heuristic via the retained fallback chain.

## Open Questions

- Exact OpenAI speech timed-text request shape (account/model dependent) — resolved during step 8 against current OpenAI docs; gated behind `supportsWordTimings`, so no blocking dependency.
- Whether the plethora hosted endpoint's advertised timestamp payload ships before this change — handled identically (adapter opts in when the payload exists).
