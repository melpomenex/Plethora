## Why

During text-to-speech (TTS) playback with spoken-word follow enabled in Plethora's mobile application (observed on Android WebView), the application immediately or near-immediately crashes when narration reaches the bottom of the initially visible viewport and auto-scrolling begins.

Investigation confirms that Plethora has **two independent auto-scrolling subsystems** fighting over viewport control during spoken-word transitions:
1. **Legacy scrolling in `WordHighlighter.applyHighlights()`**: Contains pre-overhaul scrolling code (`findScrollableContainer`, `getElementTopRelativeToContainer`, `scrollContainer.scrollTo({ top: clampedTarget, behavior: "smooth" })`, and `span.scrollIntoView()`) dating back to early fluid TTS work.
2. **Authoritative `useSpokenWordFollow` hook**: Introduced in the reader TTS overhaul to provide centralized, debounced, comfort-band aware auto-follow with arrival-based programmatic-scroll detection and Re-center support.

When the active spoken word crosses the initial viewport boundary, both subsystems simultaneously issue smooth-scroll commands to the scroll container. Compounding this, every word transition executes aggressive DOM mutations (destroying highlight spans, inserting text nodes, invoking `parent.normalize()`, splitting text nodes via `DocumentFragment`, and querying forced synchronous layouts). Due to a stale cache signature in `WordHighlighter.getIndexedText()`, destroyed text node references are retained and reused across word transitions.

On Android WebView (Chromium Blink engine), this storm of concurrent smooth-scroll animations, synchronous DOM normalization, detached-node operations, and forced layout reflows triggers a fatal renderer/layout crash.

While OpenRouter TTS exposes this issue especially clearly because it synthesizes word-boundary clock updates at animation frame rates (`supportsWordTimings: false`), the root defect is architectural and exists in the shared reader TTS and highlighting pipeline.

This change is needed now to stabilize TTS playback on mobile devices, eliminate duplicate scroll ownership, fix cache invalidation bugs, and ensure seamless continuous reading.

## What Changes

- **Establish `useSpokenWordFollow` as the Single Viewport Controller**: Remove all viewport scrolling logic, container lookups, iframe geometry calculations, and user interaction event listeners from `WordHighlighter`. `WordHighlighter` will strictly own highlight DOM markup and styling.
- **Fix `IndexedText` Cache Correctness**: Invalidate or rebuild the cached indexed text representation whenever DOM mutations or normalizations alter text node identity, ensuring that `IndexedTextChar` references always point to valid, connected `Text` nodes.
- **Eliminate Redundant Clear & Mutation Cycles**: Remove redundant `clear()` invocations between `WordHighlightLayer` and `WordHighlighter`, ensuring a single cleanup/re-highlight pass per spoken word transition.
- **Defensive Lifecycle and Virtualization Guards**: Harden highlight resolution and follow scrolling against detached nodes, unmounted EPUB iframes, zero-dimension containers, and rapid document/chunk transitions.
- **Comprehensive Regression and Provider Coverage**: Add automated unit/integration tests covering single-owner scrolling, boundary transition stress, cache invalidation across mutations, and provider-agnostic timing safety without special-casing OpenRouter.

## Capabilities

### New Capabilities

- `tts-follow-behavior`: Defines requirements for single-owner viewport follow control during TTS narration, comfort-band positioning, user-scroll detection with programmatic distinction, Re-center restoration, reduced-motion handling, and crash-safe viewport boundary traversal across all reader surfaces.
- `tts-spoken-word-highlighting`: Defines requirements for pure highlight DOM presentation, single-pass highlight application, cache validity across DOM mutations, graceful anchor resolution degradation, and detached/virtualized node safety.

### Modified Capabilities

*(None. Requirements from earlier prototype change specs in `improve-reader-tts` are formalized into the above capability specs).*

## Impact

- **Core Files**:
  - `src/utils/wordHighlighter.ts`: Strip legacy scrolling code, interaction listeners, and scroll container caching; fix `IndexedText` cache invalidation; eliminate internal redundant clears.
  - `src/components/common/WordHighlightLayer.tsx`: Streamline highlight lifecycle to avoid duplicate `clear()` calls before delegating to `WordHighlighter`.
  - `src/hooks/useSpokenWordFollow.ts`: Ensure robust, defensive handling for virtualized, detached, or unmounted target elements.
  - `src/components/common/ReaderTTSControls.tsx`: Retain sole control over playback timing, coordinate tracking, and follow container propagation.
- **Reader Surfaces**: EPUB iframes, PDF text and reflow layers, Markdown viewer, HTML reader, and Queue scroll page.
- **Platforms**: Mobile (Android WebView / Tauri) and Desktop (macOS, Linux, Windows).
- **APIs / Data Stores**: No breaking changes to settings stores, listening position persistence, or external TTS provider APIs.
