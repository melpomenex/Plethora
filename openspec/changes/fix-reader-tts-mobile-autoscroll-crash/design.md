## Context

Plethora features an integrated reader text-to-speech (TTS) engine supporting multiple content types (EPUB, PDF fixed/reflow, Markdown, HTML, RSS) and multiple TTS providers (OpenRouter, Pocket TTS, fal.ai, MOSS, Web Speech, and native Android sherpa-onnx).

During TTS playback, the reader provides two complementary visual feedback mechanisms:
1. **Spoken-word highlighting**: Applying a visible emphasis class to the active word in the document DOM.
2. **Auto-follow scrolling**: Automatically scrolling the container to keep the active word comfortably centered in the reading viewport.

### Root Cause Analysis

A serious crash occurs on mobile devices (Android WebView) when TTS reaches the bottom of the initially visible viewport and auto-scrolling begins. Investigation across the codebase confirms four contributing architectural defects:

#### 1. Duplicate and Competing Scroll Controllers
- **Legacy Scroller in `WordHighlighter` (`src/utils/wordHighlighter.ts`)**: Built during early fluid-TTS development, `WordHighlighter.applyHighlights()` performs autonomous viewport scrolling using `findScrollableContainer()`, `getElementTopRelativeToContainer()`, `scrollContainer.scrollTo({ top: clampedTarget, behavior: "smooth" })`, and `span.scrollIntoView()`. It also registers separate user interaction listeners (`wheel`, `touchmove`, `pointerdown`, `keydown`) and tracks `lastTargetScrollTop`.
- **Authoritative Scroller in `useSpokenWordFollow` (`src/hooks/useSpokenWordFollow.ts`)**: Added during the reader-TTS overhaul as the unified follow controller. It implements comfort-band offsets (0.28 desktop / 0.18 compact), 150ms debouncing, arrival-based user-scroll detection, Re-center restoration, and reduced-motion instant positioning.
- **The Conflict**: When the active word leaves the comfort band or initial viewport, both `WordHighlighter` and `useSpokenWordFollow` calculate different target scroll tops and issue concurrent `scrollTo({ behavior: "smooth" })` calls to the same container, triggering animation collisions and scroll storms.

#### 2. Aggressive DOM Rewriting and Synchronous Reflow Churn
- On every word change, `WordHighlighter.clear()` replaces highlight `<span>` elements with new text nodes and calls `parent.normalize()`.
- Applying the new highlight splits text nodes with a `DocumentFragment` and `parent.replaceChild()`.
- Immediately following this DOM mutation, `WordHighlighter` queries `getBoundingClientRect()`, `scrollHeight`, and `clientHeight` to compute scroll targets, forcing synchronous layout recalculations.
- Simultaneously, `useSpokenWordFollow` queries `span.getBoundingClientRect()` and `container.getBoundingClientRect()`.
- On Android WebView's Blink engine, running continuous synchronous text node destruction, normalization, forced layout queries, and competing smooth-scroll animations multiple times per second leads to a fatal renderer crash (`SIGSEGV` in Chromium's `PaintLayerScrollableArea` / layout subsystem).

#### 3. Stale `IndexedText` Cache References
- `WordHighlighter` caches an `IndexedText` structure containing direct references to DOM `Text` nodes (`IndexedTextChar.node: Text`).
- The cache key is computed as `${this.container.childNodes.length}:${this.container.textContent?.length ?? 0}`.
- When `clear()` replaces a `<span>` with a text node and calls `parent.normalize()`, the child count and total text length of the container often remain identical, leaving the cache key unchanged.
- Subsequent calls to `getIndexedText()` return cached entries holding references to detached/destroyed `Text` nodes whose `parentNode` is `null`.
- When `rangesForNormalizedSpan()` maps ranges over these detached nodes, `applyHighlights()` encounters `if (!parent) continue;`, causing anchored highlight resolution to fail silently and fall back to chunk-level highlighting (`highlightChunk()`).
- `highlightChunk()` triggers another round of `clear()` and fallback DOM manipulation, multiplying layout thrashing.

#### 4. Redundant `clear()` Cycles
- `WordHighlightLayer.tsx` iterates through all target containers and calls `hl.clear()` on each render before dispatching to `highlightAnchoredWord()`.
- `WordHighlighter.highlightAnchoredWord()` immediately calls `this.clear()` again internally.
- If anchor resolution fails, `highlightChunk()` calls `this.clear()` a third time.
- A single word transition thus executes up to 3 redundant DOM destruction and normalization passes.

#### 5. Why OpenRouter Exposes This Clearly
- `openrouterAdapter` declares `supportsWordTimings: false`.
- `ReaderTTSControls` synthesizes word timings across the audio duration (`synthesizeWordTimings`) and drives word progression via a `requestAnimationFrame` audio clock.
- Word updates occur with high frequency and precision. When narration reaches the first viewport boundary, the duplicate scrolling conflict and DOM thrashing are triggered under rapid continuous timing updates.
- The defect is not specific to OpenRouter; any provider navigating past the initial viewport boundary under follow mode exercises the same buggy path.

---

## Goals / Non-Goals

**Goals:**
- **Single-Owner Viewport Movement**: Make `useSpokenWordFollow` the sole owner of viewport scrolling across all reader surfaces. Completely remove viewport scrolling, scroll container lookups, iframe geometry calculations, and interaction event listeners from `WordHighlighter`.
- **Highlight-Only `WordHighlighter`**: Restructure `WordHighlighter` to focus exclusively on finding text ranges, inserting highlight markup, applying karaoke/theme styling, and cleaning up DOM nodes.
- **Cache Correctness**: Ensure `IndexedText` cache invalidation guarantees that all indexed `Text` node references are connected and valid (`node.isConnected === true`).
- **Streamlined Lifecycle**: Eliminate duplicate `clear()` calls and minimize DOM mutations per word transition.
- **Defensive Lifecycle Guards**: Ensure follow scrolling and highlight resolution handle virtualized elements, detached nodes, unmounted iframes, zero-dimension containers, and document transitions gracefully without throwing.
- **Cross-Platform & Surface Parity**: Maintain robust behavior across Android WebView, Desktop (macOS/Linux/Windows), EPUB continuous scroll/iframes, PDF fixed text layers, PDF reflow (`[data-w]`), Markdown, and HTML viewers.

**Non-Goals:**
- Redesigning the TTS audio playback architecture, audio buffering, or remote media bridge.
- Adding special-case provider branches for OpenRouter in reader components.
- Replacing smooth scrolling globally with instant scrolling as a workaround.
- Completely rewriting the DOM text range highlighting system when focused repairs solve the defect.

---

## Architecture & Data Flow

### Before: Dual-Scroller Collision and Cache Invalidation Churn

```text
TTS Audio Clock (rAF / Boundary Event)
               │
               ▼
   ReaderTTSControls.commitWord()
               │
       ┌───────┴────────────────────────┐
       ▼                                ▼
WordHighlightLayer              useSpokenWordFollow
       │                                │
       ├─ hl.clear() (Pass 1)           ├─ Debounce (150ms)
       ├─ hl.highlightAnchoredWord()    ├─ Query .tts-word-highlight
       │   ├─ this.clear() (Pass 2)     ├─ Measure comfort band
       │   ├─ Stale IndexedText Cache   └─ container.scrollTo(smooth) #2
       │   ├─ Normalize DOM / Split     
       │   └─ applyHighlights()
       │       └─ scrollContainer.scrollTo(smooth) #1  ◄── COLLISION & CRASH
```

### After: Single-Owner Follow & Hardened Highlight Lifecycle

```text
TTS Audio Clock (rAF / Boundary Event)
               │
               ▼
   ReaderTTSControls.commitWord()
               │
       ┌───────┴────────────────────────┐
       ▼                                ▼
WordHighlightLayer              useSpokenWordFollow (SOLE SCROLL OWNER)
       │                                │
       ├─ Single clear/update pass      ├─ Debounce (150ms) & Comfort Check
       ├─ WordHighlighter               ├─ Query active highlight span
       │   ├─ Validated IndexedText     ├─ Check container.isConnected & height
       │   ├─ Connected Text Nodes      ├─ Arrival-based user-scroll detection
       │   └─ DOM Highlight Only (No Scroll) └─ container.scrollTo() (Single Owner)
```

---

## Technical Decisions

### Decision 1: Remove All Scrolling Responsibilities from `WordHighlighter`
- **Action**: Delete `findScrollableContainer()`, `getElementTopRelativeToContainer()`, `cachedScrollableContainer`, `cachedScrollableForContainer`, `lastTargetScrollTop`, `lastUserScrollTime`, and the `userInteractionListener` event listeners (`wheel`, `touchmove`, `pointerdown`, `keydown`) from `WordHighlighter`.
- **Action**: In `applyHighlights()`, delete the entire `if (!scrolled)` block calling `scrollContainer.scrollTo()` and `span.scrollIntoView()`.
- **Rationale**: Having a single authoritative controller (`useSpokenWordFollow`) eliminates competing animation frames, race conditions, and duplicate event listeners.

### Decision 2: Invalidate and Validate `IndexedText` Cache References
- **Action**: Invalidate `this.cachedIndexedText = null` and `this.cachedSignature = null` whenever `WordHighlighter.clear()` mutates the DOM or whenever `applyHighlights()` splits text nodes.
- **Action**: Before returning cached `IndexedText`, verify that its indexed `Text` nodes remain connected (`chars.every(c => c.node.isConnected)`). If any node was detached by external DOM operations or normalization, rebuild the index.
- **Rationale**: Guarantees that `rangesForNormalizedSpan()` always receives live, connected `Text` nodes, preventing anchor resolution failures and redundant chunk-highlight fallbacks.

### Decision 3: Eliminate Redundant `clear()` Invocations
- **Action**: Refactor `WordHighlightLayer.tsx` to avoid calling `hl.clear()` prior to calling `highlightAnchoredWord()` or `highlightWord()`. `WordHighlighter` will handle clearing its previous highlight in a single pass before inserting the new highlight.
- **Action**: Ensure `highlightAnchoredWord()` cleanly transitions to the new highlight range without intermediate redundant DOM normalization passes.
- **Rationale**: Halves the number of DOM node replacements and parent normalizations during continuous reading.

### Decision 4: Defensive Guards in `useSpokenWordFollow`
- **Action**: In `useSpokenWordFollow.scrollToWord()` and `findActiveTarget()`:
  - Verify `span.isConnected` and `container.isConnected`.
  - Guard against `container.clientHeight === 0` (hidden/backgrounded view).
  - Guard against unmounted iframe documents or cross-origin access errors during iframe ancestor traversal.
  - Cancel any pending debounce timer on unmount or when `active` becomes false.
- **Rationale**: Prevents runtime errors during document navigation, tab switching, and virtualized page unmounting.

---

## Surface & Provider Compatibility Matrix

| Surface | Highlight Mechanism | Viewport Follow Container | Special Considerations |
| :--- | :--- | :--- | :--- |
| **Markdown / Article Reader** | DOM Text Nodes via `WordHighlighter` | `[data-document-scroll-container]` | Direct ancestor scrolling, standard comfort offset |
| **HTML Reader** | DOM Text Nodes via `WordHighlighter` | `[data-document-scroll-container]` or iframe body | Safe iframe window traversal |
| **EPUB Continuous Scroll** | Section-routed iframe body DOM | `[data-epub-viewer]` or parent container | Section container mapping; cross-frame coordinates in hook |
| **PDF Reflow / OCR** | `[data-w]` attribute lookup via `WordHighlighter` | `[data-document-scroll-container]` | Uses `pdf-word` anchor mapping |
| **PDF Fixed / Text Layer** | Text layer spans | `[data-document-scroll-container]` | Virtualized page unmount safety |
| **Queue Scroll View** | Plain text indexed chunks | Scroll container | Lightweight fallback |

| Provider | Timing Source | Frequency | Follow Behavior |
| :--- | :--- | :--- | :--- |
| **OpenRouter** | Synthesized (`durationSec`) | rAF continuous (~60fps sampled) | Debounced 150ms follow; approximate highlight styling |
| **Cloud (e.g. Groq/ElevenLabs)** | Measured `wordTimings` | Boundary timestamps | Measured highlight styling; debounced follow |
| **Web Speech (System)** | `onboundary` char index | Utterance events | Accurate boundary sync; debounced follow |
| **Android Native (sherpa-onnx)** | Utterance/Sentence events | Sentence & word callbacks | Monotonic utterance guard; debounced follow |

---

## Risks / Trade-offs & Mitigations

- **Risk: A reader surface loses auto-follow if not passed to `useSpokenWordFollow`**
  - *Mitigation*: Verify that `ReaderTTSControls` supplies `followContainers` covering `highlightContainerRef`, `iframeWindow`, and `sectionContainers`. Add unit and component tests verifying follow execution on all document types.
- **Risk: Cache rebuilding introduces garbage collection pauses**
  - *Mitigation*: `IndexedText` indexing is lightweight (single `TreeWalker` pass over the active container/section). Rebuilding only on highlight mutation or container signature mismatch preserves high performance.
- **Risk: Rapid user gesture conflicts with follow animation**
  - *Mitigation*: Arrival-based detection in `useSpokenWordFollow` cleanly differentiates user input from programmatic scroll arrival, pausing follow immediately on real gesture.

---

## Test & Verification Strategy

1. **Automated Unit Tests**:
   - `wordHighlighter.test.ts`: Verify `WordHighlighter` no longer calls `scrollTo` or `scrollIntoView` under any circumstance.
   - `wordHighlighter.anchored.test.ts`: Verify `IndexedText` cache validity after multiple consecutive highlight-clear-highlight cycles.
   - `useSpokenWordFollow.test.ts`: Test rapid word transitions across comfort-band boundaries, unmounted container handling, and Re-center behavior.
   - `ReaderTTSControls.*.test.tsx`: Verify integration of timing loop, highlight layer, and follow controller.
2. **Mobile Validation**:
   - Build Android APK using project build scripts.
   - Test OpenRouter TTS on Android device/emulator: narrate past initial screen, cross chunk boundaries, pause/resume, and Re-center.
