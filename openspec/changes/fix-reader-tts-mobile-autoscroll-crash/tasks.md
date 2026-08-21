## 1. Setup & Regression Test Suite

- [x] 1.1 Add regression test in `src/utils/__tests__/wordHighlighter.test.ts` verifying that `WordHighlighter` does not call `scrollTo` or `scrollIntoView` when applying highlights.
- [x] 1.2 Add cache invalidation test in `src/utils/__tests__/wordHighlighter.anchored.test.ts` verifying that `IndexedText` cache invalidates after DOM mutation and always returns connected `Text` nodes (`node.isConnected === true`).
- [x] 1.3 Add boundary transition tests in `src/hooks/__tests__/useSpokenWordFollow.test.ts` verifying debounced scroll arrival and no duplicate scroll commands.

## 2. Eliminate Legacy Scrolling from `WordHighlighter`

- [x] 2.1 Remove `findScrollableContainer()` and `getElementTopRelativeToContainer()` helper methods from `src/utils/wordHighlighter.ts`.
- [x] 2.2 Remove `scrollTo()` and `scrollIntoView()` execution from `applyHighlights()` in `src/utils/wordHighlighter.ts`.
- [x] 2.3 Remove `userInteractionListener`, interaction event registrations (`wheel`, `touchmove`, `pointerdown`, `keydown`), and scroll-tracking properties (`lastTargetScrollTop`, `lastUserScrollTime`, `cachedScrollableContainer`, `cachedScrollableForContainer`) from `src/utils/wordHighlighter.ts`.

## 3. Fix Cache Invalidation & Streamline Highlight Lifecycle

- [x] 3.1 Invalidate `cachedIndexedText` and `cachedSignature` in `WordHighlighter.clear()`, `WordHighlighter.init()`, and `WordHighlighter.applyHighlights()`.
- [x] 3.2 Add node connectivity validation in `WordHighlighter.getIndexedText()` to ensure stale cached instances pointing to detached `Text` nodes trigger a clean rebuild.
- [x] 3.3 Refactor `src/components/common/WordHighlightLayer.tsx` to remove the redundant `hl.clear()` loop over all targets prior to calling `highlightAnchoredWord()`.
- [x] 3.4 Verify single-pass clear and highlight execution in `WordHighlighter.highlightAnchoredWord()` and fallback paths.

## 4. Defensive Hardening in `useSpokenWordFollow`

- [x] 4.1 Add node connectivity (`span.isConnected`, `container.isConnected`) and dimension (`container.clientHeight > 0`) guards in `useSpokenWordFollow.ts`.
- [x] 4.2 Harden iframe hierarchy traversal in `useSpokenWordFollow.findScrollableContainer()` against unmounted or cross-origin iframes.
- [x] 4.3 Ensure pending debounce timers, programmatic scroll timeouts, and listeners are cleanly reset when `active` changes or when the hook unmounts.

## 5. Verification & Validation

- [x] 5.1 Run all unit test suites (`npx vitest run src/utils/__tests__/wordHighlighter* src/hooks/__tests__/useSpokenWordFollow* src/components/common/__tests__/ReaderTTSControls*`).
- [x] 5.2 Run performance benchmarks and baseline check (`npm run bench:check` or `npm run test:scripts`).
- [x] 5.3 Validate OpenSpec change with `npx openspec validate fix-reader-tts-mobile-autoscroll-crash`.
- [ ] 5.4 Verify reproduction matrix across Android WebView and Desktop readers with OpenRouter TTS, cloud TTS, and system/native TTS.
