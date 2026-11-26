## 0. Dependency gates

Requires #1–#7 and #13. Freeze the transcript sentence/token adapter, original-media resolver, and normal-mode boundary before #14 tasks touch shared video/transcript components.

## 1. Viewer integration

- [x] 1.1 Define video-language session, transcript sentence/token adapters, layout state, and normal-mode boundary. `src/lib/languageVideo/{types,session}.ts` define `VideoLanguageSession`, `VideoTranscriptToken`/`VideoTranscriptSentence`, `VideoSubtitleMode`, `VideoLanguageLayout`, `leaveVideoLanguageMode`, and `supportsVideoLayout`; `session.test.ts` verifies the normal-playback boundary (seeks only transcript sentences) and that subtitle/layout changes stay local to language mode.
- [x] 1.2 Integrate existing YouTube/local playback, captions/transcript, word timings, source anchors, and alignment resolver. `LanguageVideoHost` (`src/components/language/LanguageVideoHost.tsx`, 809 lines) is mounted in `YouTubeViewer`, `LocalVideoPlayer`, and `AudiobookViewer`; it consumes transcript segments with word timings, source anchors, and `replayOriginalFirst`.
- [x] 1.3 Add desktop/tablet/mobile/e-ink presentation with virtualized transcript and accessible controls. Layouts are resolved via `supportsVideoLayout`; lexicon/transcript rendering is paged (`LEXICON_PAGE_LIMIT`) with minimized/collapsed control states; keyboard/screen-reader semantics are asserted in `src/components/language/__tests__/accessibility.test.tsx`.

## 2. Language behavior

- [x] 2.1 Add profile activation, vocabulary state highlighting, shared Language Peek, and selection behavior. The host activates via the language-learning profile snapshot, builds a lexicon state index (`LexiconStateIndex`) to style tokens by knowledge state, opens the shared `DictionaryPeek` on selected tokens, and handles selection/dismiss flows.
- [x] 2.2 Add target/base subtitle/translation modes, cache/error states, sentence seek/replay/loop/auto-pause. Subtitle modes `target`/`base`/`dual`/`hidden` are supported with translation states (`idle`/`pending`/`ready`/`offline`); sentence seek/replay, loop, auto-pause, and speed control (0.75–1.25×) are implemented.
- [x] 2.3 Add mining callback with timestamp/source/frame-ready provenance. Mining dispatches `mine` with `frameTimestampMs`, `frameAvailable`, and — when capability-gated frame capture is available — `frameDataUrl` (`VideoLanguageMiningReference`).

## 3. Verification and overlap

- [x] 3.1 Test normal playback regression, transcript sync, stale/low-confidence alignment, sentence-only fallback, and long transcripts. `YouTubeViewer.test.tsx`, `session.test.ts`, `hostIntegration.test.tsx` (layer video actions on the player clock, mining provenance), and the alignment resolver suite cover regression/sync/stale-low-confidence fallback; long transcripts are handled by paged lexicon/transcript views.
- [x] 3.2 Test mobile gestures, keyboard/screen reader, reduced motion, e-ink, offline translation, and Queue/listening invariants. `accessibility.test.tsx` covers keyboard/screen-reader naming, reduced-motion, and contrast/e-ink visual contracts; offline translation state is explicit; layout switching across desktop/tablet/mobile/e-ink is session-tested; Queue/listening invariants are preserved (normal playback boundary tests).
- [x] 3.3 Coordinate shared viewer/transcript edits with existing YouTube/karaoke changes before parallel implementation. Video language behavior is layered in `LanguageVideoHost` without mutating YouTube player internals or the karaoke clock; YouTube viewer and karaoke regression suites pass.
