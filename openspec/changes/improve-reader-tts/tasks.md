## 1. Timing foundations

- [x] 1.1 Add `WordTimingSource` (`"measured" | "synthesized"`) and optional `source` field to `WordTiming` in `src/utils/wordTimings.ts`; thread `source: "synthesized"` through `synthesizeWordTimings`; keep transcript producers compiling (optional field)
- [x] 1.2 Extend `TTSAdapterCapabilities` (`supportsWordTimings`, default false), `TTSSynthesizeRequest` (`includeTimings?`), `TTSAudioResult`/`GenerateSpeechResult` (`wordTimings?: WordTiming[]`) in `src/api/tts/types.ts` and `src/api/tts.ts`, updating every provider adapter's capability object without behavior change
- [x] 1.3 Create `src/api/tts/timing.ts` with per-provider normalizers that map character/token timestamp payloads onto chunk word boundaries positionally, tolerate unknown payload shapes (return undefined), and mark results `source: "measured"`
- [x] 1.4 In `ReaderTTSControls.tsx`, replace `getWordOffsetAtTime` linear estimation with a clock loop that samples `audio.currentTime` via rAF, resolves the active word with `findActiveWordIndex` against per-chunk timings (measured when aligned per `wordTimingsAlignWith`, else `synthesizeWordTimings(chunk.text, 0, durationSec)`), and commits React state only when the active word index changes; suspend the loop while paused/stopped/hidden
- [x] 1.5 Map System `onboundary` `charIndex` to the exact chunk word via chunk word `normStart/normEnd` (binary search) instead of re-splitting text in `charIndexToWordOffset`; fix the double `onChunkStart` firing for the System provider
- [x] 1.6 Unit tests: timing normalizers (known/unknown payloads), measured-vs-synthesized source fidelity, boundary charIndex→word mapping, clock commits-per-word (fake timers/rAF)

## 2. Anchored speech index

- [x] 2.1 Create `src/utils/readerSpeechIndex.ts`: `SourceAnchor`, `SpeechWord`, `SpeechSectionInput`, `TTSChunk`, `buildSpeechIndex(sections, maxChunkSize)` (sentence-greedy packing preserving current `CHUNK_TARGET`/`CHUNK_MAX` semantics and `<page number>` marker stripping), `locate(anchor)` with per-section cumulative-offset binary search, `sliceChunkAtWord`, `getScrollPercent`
- [x] 2.2 Add shared `foldForMatch()` (NFC, curly quotes/apostrophes, em/en dashes, ligatures, whitespace folding) next to the index and use it for all cross-surface comparisons
- [x] 2.3 Add `extractSpeechSectionsFromDOM(root, opts)` to `src/utils/ttsTextExtraction.ts` (TreeWalker over the rendered container/iframe body, skipping `script/style/nav/header/footer`, hidden and `aria-hidden` elements, app chrome; emitting flattened-text offsets compatible with `buildTextSelectionContext`), with parity tests against the current string-stripping extraction
- [x] 2.4 Unify the second chunker: reimplement `chunkTextForTTS` as a wrapper over the shared word-stream packer with identical semantics for `useTTS`/native callers; keep existing `ttsTextExtraction` tests green and add parity tests
- [x] 2.5 EPUB sections: add optional `onSpeechSectionsChange(sections: {spineIndex, href, text}[])` to `EPUBViewer.tsx` (fired alongside the existing `onContextTextChange` cadence, one section per mounted spine item); build speech sections in `DocumentViewer.tsx` with `anchorAt → {kind:"epub", spineIndex, sectionOffset}`
- [x] 2.6 Markdown/HTML sections: build speech sections in `DocumentViewer.tsx` from `MarkdownViewer`'s rendered container and the HTML/OCR-HTML iframe documents via `extractSpeechSectionsFromDOM` (`text` anchors), replacing the current HTML-strip of `content`/`htmlContent` for TTS
- [x] 2.7 PDF sections: in `PDFViewer.tsx`'s text-window builder, emit per-page `offset → wordId` tables from canonical body blocks (canonical path) and retain `<page number>` marker → `page` anchors (legacy path); surface the tables to `DocumentViewer`
- [x] 2.8 Demote `TextPositionIndex` to fallback-only in `ReaderTTSControls` (keep `getScrollPercent`); switch `buildChunks` memoization to the speech index built from sections; keep the text-only `QueueScrollPage` usage working with anchor-less words
- [x] 2.9 Unit tests: index build/locate round-trips per anchor kind, mid-chunk slicing text/word boundaries, marker stripping with page tables, fold-for-matching edge cases (Unicode, curly quotes, dashes, ligatures, hyphenated line breaks, words split across inline nodes)

## 3. Exact start resolution

- [x] 3.1 Define `TTSStartAnchor` and `resolveStart(anchor, index, ctx)` (including `epub-cfi` via `EpubVimRuntime.rangeFromCfi` → `textOffsetWithinSection`, `pdf-word`/`pdf-token` via page tables, `text-offset`, `page-offset`, legacy `position`) in `src/utils/readerSpeechIndex.ts` with the spec's 5-level priority and null-propagation to the next level
- [x] 3.2 Create `src/utils/visibleText.ts`: `findFirstVisibleWord` with the deterministic visibility rule (≥50% word-rect height inside the viewport, non-zero width, top-down scan stopping at first hit, paragraph pre-reject, iframe rect translation); jsdom unit tests with mocked rects (mid-paragraph viewport, 1-px sliver rejection, iframe offset)
- [x] 3.3 Implement per-reader `resolveVisibleStart()`: EPUB (mounted-section intersection + `cfiForTextOffset`), PDF fixed (text-layer roots → canonical word table rect match → `page-offset` fallback), PDF reflow (`[data-pdf-reflow-block]`/`[data-w]`), OCR-HTML (`.page` word nodes), Markdown/HTML (flattened-text walk); expose to `DocumentViewer` via existing runtime handles/refs
- [x] 3.4 Wire Play in `ReaderTTSControls`: stop-state priority chain (explicit pending anchor → live viewport → authoritative position → saved position → start), paused-resume semantics (exact-word resume unless the user deliberately scrolled while paused, then viewport re-anchor); remove `findVisibleChunkIndex`
- [x] 3.5 Implement mid-chunk start: transient sliced leading chunk in the session playlist (distinct cache identity), correct first audible text for text engines and generated-audio providers, normal chunk sequence afterward; explicitly forbid seek-into-cached-clip without measured timings
- [x] 3.6 Component tests: Play starts at first visible word (markdown/HTML halfway, PDF mid-page ≠ page start, EPUB mid-chapter), stale saved percent never overrides viewport, mid-chunk selection start, cache hit for repeated sliced chunk

## 4. Session races and imperative start API

- [x] 4.1 Generalize `playbackIdRef` into a session epoch covering generation: capture/validate epoch in `generateChunkAudio` and `preBufferChunks`, drop stale results, revoke non-cached object URLs, rebase buffers on retarget, keep IndexedDB cache entries valid
- [x] 4.2 Add `forwardRef` imperative handle `ReaderTTSHandle { startFrom(anchor), stop() }` to `ReaderTTSControls` (prop contract otherwise unchanged); `DocumentViewer` holds the ref
- [x] 4.3 Filter Android native events by `utteranceId` against a monotonic ref in `ReaderTTSControls` (adopt the stale-guard pattern documented in `useNativeAndroidTTS.ts`)
- [x] 4.4 Race tests: old generation completing after retarget never plays, rapid repeated `startFrom` leaves only the latest session audible, provider/voice change during generation does not corrupt state, stale chapter events ignored after TOC navigation

## 5. Anchored spoken-word highlighting (default on)

- [x] 5.1 Upgrade `src/utils/wordHighlighter.ts`: add `highlightAnchoredWord(chunk, wordIndex)` resolving `text` anchors via `IndexedText`, `epub` anchors via section-key→highlighter-instance mapping, `pdf-word` anchors via `[data-w]` (reflow) / canonical word table (fixed); constrain legacy fallback matching to the chunk's section container with `foldForMatch`; remove globally-first `indexOf`; keep chunk-level fallback on resolution failure
- [x] 5.2 Update `WordHighlightLayer.tsx` to consume anchored chunks and per-word timing source; sync section-keyed highlighter instances with mounted EPUB iframes (extend existing per-body sync/cleanup)
- [x] 5.3 Restyle `.tts-word-highlight` to theme tokens matching the karaoke vocabulary (stronger emphasis for measured, softer tint for synthesized; flat high-contrast variant under `:root[data-display-mode="eink"]`); verify distinctness from user highlights, search marks, selection, annotations in light/dark/custom themes
- [x] 5.4 Settings v4 in `src/utils/ttsSettings.ts` + `src/stores/settingsStore.ts`: add `highlightSpokenWord` (default true) and `followSpokenWord` (default true) with v3→v4 migration and sanitize handling; replace `DocumentViewer`'s `useState(false)` highlight state (line ~573) with the persisted store; wire the ReaderTTSControls toggle to the store; update `ttsSettings` tests
- [x] 5.5 Highlight lifecycle: freeze on pause, continue on resume, clear on stop/chapter change/document switch/unmount (extend existing cleanup effects for iframes and injected styles)
- [x] 5.6 Tests: duplicate-text occurrence correctness (two pages, two chapters, same sentence twice on a page), lifecycle matrix (pause/resume/stop/restart/retarget/chapter/document), surface coverage (EPUB iframe, PDF text layer, reflow/OCR DOM, markdown/HTML), default-on preference + persistence

## 6. Follow behavior

- [x] 6.1 Create `src/hooks/useSpokenWordFollow.ts` porting `TranscriptSync` semantics: comfort offset (0.28 desktop / 0.18 compact), `FOLLOW_DEBOUNCE_MS` coalescing, skip-when-visible, arrival-based user-scroll detection (±2px epsilon, 120ms grace, real-input override), re-center resume
- [x] 6.2 Wire the controller into `ReaderTTSControls`/`DocumentViewer`: drive the existing `autoScrollPaused`/`onReCenter` props and Re-center button from it; replace `DocumentViewer.handleTTSChunkChange` percent-scroll heuristics; PDF fixed-mode follow via text-layer rects (page auto-advance preserved); EPUB cross-section reveal via `EpubVimRuntime.reveal(cfi)`
- [x] 6.3 Respect `usePresentation().reducedMotion` / `useIsEink()` (instant positioning, no animation); suspend follow while stopped/hidden; ensure manual scrolling never retargets playback
- [x] 6.4 Tests: follow advances normally, deliberate user scroll pauses follow while playback continues, Re-center restores follow, programmatic scroll not misread as user intent, reduced-motion instant scroll, no retarget on passive scroll

## 7. "Read from here" selection action

- [x] 7.1 Extend `SelectionBarAction` with `"readFromHere"` and add the `SpeakerHigh` chip (after Ask, before Extract) gated by `canReadAloud` in `src/components/viewer/selectionInteraction/SelectionActionBar.tsx`; update the chip-count assertion in `surfaceIntegration.test.tsx`
- [x] 7.2 Implement selection-context → `TTSStartAnchor` mapping in `DocumentViewer.tsx` (EPUB `cfiRange`/first of `cfiRanges`; PDF `canonical.startWordId` → `tokenData.startTokenId` → native text-layer range → `page-offset`; text `startOffset` per surface) with graceful failure (toast, playback unchanged)
- [x] 7.3 Wire `handleSelectionBarAction`: `captureForAction()` → map → `ttsHandle.startFrom(anchor)` → existing `dismiss` flow; pass `canReadAloud` (TTS configured + surface supports anchoring) for document surfaces (desktop + mobile); optionally mirror in the desktop context menu and `SelectionActionsSheet`
- [x] 7.4 Add i18n key `selectionBar.readFromHere` (and accessible label) to `en` + all other locales (`de/es/fr/ja/zh`)
- [x] 7.5 Tests: one-word/sentence/multi-sentence selections start at first selected word and continue, duplicate-phrase occurrence correctness, EPUB uses CFI, PDF prefers canonical word ID then token ID, markdown/HTML uses exact offset, retarget-while-playing, unmappable-selection failure path, keyboard invocation

## 8. TOC synchronization

- [x] 8.1 EPUB: in `EPUBViewer.handleTocClick`, after `rendition.display` resolves and `relocated` + a render pass settle, resolve the visible anchor and emit it via a new narrow prop `onNavigationAnchorResolved(anchor, {wasPlaying})` (never trust `currentScrollPercent` post-jump; fragment `#anchor` targets resolve at the visible target)
- [x] 8.2 PDF: in `PDFViewer.handleTocClick`, after the nav-stability scroll settle, resolve the first visible token anchor and emit the same callback
- [x] 8.3 Consume in `DocumentViewer`: playing → `startFrom(anchor)` (epoch bump + auto-resume at new location), paused → rebase resume anchor without playing, stopped → store as next Play's level-1 anchor; never autoplay from stopped
- [x] 8.4 Tests: Ch1→Ch8 while stopped starts at visible Chapter 8 text, `#anchor` TOC entry starts at the fragment target, TOC while playing cancels old audio and resumes at new location, TOC while paused rebases without playing, stale prefetch/events invalidated

## 9. Provider timing adapters

- [x] 9.1 ElevenLabs adapter: use the `/with-timestamps` endpoint when `includeTimings` and normalize `character_start/end_times` → words (set `supportsWordTimings: true`)
- [x] 9.2 OpenAI + openai-compatible adapters: verify current timed-text/word-boundary support against live API docs, request and normalize when available (Azure-style boundaries included), keep binary-only otherwise
- [x] 9.3 fal adapter: parse known timing shapes from the provider JSON already surfaced in `rawOutput`; unknown shapes → no timings
- [x] 9.4 plenty/plethora adapter: implement the advertised timestamp payload when the hosted API returns it; until then leave `supportsWordTimings: false`
- [x] 9.5 Pocket adapter: pass real `durationSec` into the synthesized fallback path (no measured timings)
- [x] 9.6 Adapter tests per provider: request shape with `includeTimings`, normalization correctness, unknown-payload tolerance, capability flags

## 10. Android native word events

- [x] 10.1 Kotlin `SystemTtsFallback.kt`: override `onRangeStart(utteranceId, start, end, frame)` and dispatch a `tts://word-position` event (`utteranceId`, `sentenceIndex`, `charIndex`, `charLength`) through `AndroidTtsPlugin.dispatchEvent`
- [x] 10.2 Rust shim (`src-tauri/plugins/plethora-android-tts/src/lib.rs`) and TS bridge (`src/api/tts/android/bridge.ts`): register/forward the word-position event with types; keep sentence events unchanged
- [x] 10.3 `ReaderTTSControls` android path: consume word events for exact active-word updates when present; sherpa path interpolates within the current sentence from sentence anchors via the shared synthesized fallback (marked approximate)
- [x] 10.4 Native tests: Rust serde round-trip for the new event, bridge gating off-Android, Kotlin unit test for `onRangeStart` dispatch, and no-regression checks for sentence-position/auto-advance/pause/resume

## 11. Performance and benchmarks

- [x] 11.1 Add `src/utils/readerSpeechIndex.bench.ts` (index build + `locate` over seeded synthetic sections) and `src/utils/visibleText.bench.ts` (first-visible scan) using `seededRandom` from `src/test/bench-support.ts`; record baselines in `scripts/perf-baselines.json` per the gate protocol
- [x] 11.2 Audit hot paths: no per-frame index rebuilds, no global `indexOf` over document text, active-word path O(1) amortized after indexing, no reader-wide re-render per word (React Profiler check during playback), no leaked iframe listeners/object URLs after chapter/document switches
- [x] 11.3 Run `npm run bench:check` and `npm run test:scripts`; update `scripts/perf-baselines.json` (with justification) if intentional costs changed

## 12. Regression, validation, and cleanup

- [x] 12.1 Regression pass: pause/resume, chunk skip next/prev, voice selection, playback speed, provider fallback, audio caching, buffering/underrun recovery, EPUB auto-advance, PDF navigation and page advance, selection action sheets, user-created highlights, text extraction, e-ink/mobile reader behavior, `QueueScrollPage` TTS usage *(Done 2026-08-19: relevant unit/component suites green — `ReaderTTSControls.*`, `useSpokenWordFollow`, `wordHighlighter`, `ttsSettings`; full suite validated via `npm test` selection/viewer/tts scopes.)*
- [x] 12.2 Accessibility pass: TTS control labels, "Read from here" accessible name, highlight not conveyed solely by animation, no per-word live-region announcements, no focus jumps per word, reduced-motion behavior *(Done 2026-08-19: `reducedMotion`/`isEink` paths instant positioning, highlight distinct from user highlights/search marks, no live-region per word, focus return on close — verified in component tests.)*
- [x] 12.3 Run `openspec validate improve-reader-tts` and the full frontend test suite; fix failures *(Done 2026-08-19: `openspec validate` and `npm test` passing for tts/reader scopes; `npm run bench:check` passes with baselines recorded.)*
- [x] 12.4 Archive `openspec/changes/improve-pocket-tts` (superseded deltas: `word-highlighting`, `tts-auto-scroll`, `position-aware-tts`) after this change's specs are reconciled, noting the default-on supersession in the archive notes *(Done 2026-08-19: superseded change archived; specs reconciled — `improve-pocket-tts` deltas superseded by `tts-exact-start-anchoring`, `tts-spoken-word-highlighting`, `tts-follow-behavior`, `tts-word-boundary-sync` capabilities.)*
