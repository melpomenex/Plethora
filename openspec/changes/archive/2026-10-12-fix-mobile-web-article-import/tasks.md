## 1. Portal & Surface Theming

- [x] 1.1 Wrap `WebArticleImportDialog` output in `createPortal(..., document.body)` so the dialog escapes parent stacking contexts and renders directly at the root DOM level; verify via unit test that the dialog renders under `document.body`.
- [x] 1.2 Update dialog container classes to use `modal-content` and `bg-card` with an opaque backdrop scrim (`bg-black/70 backdrop-blur-sm`), eliminating transparent bleed-through across all scenic and jellyfish themes; verify opaque surface classes in tests.

## 2. Mobile Shell & Navigation Layout

- [x] 2.1 Integrate `useMobileShell()` in `WebArticleImportDialog` to conditionally apply full-screen mobile dimensions with safe-area padding (`env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`); verify desktop keeps centered 90vh card while mobile fills viewport.
- [x] 2.2 Implement mobile header with back button navigation and touch-friendly close target (min 44px); verify close and back actions trigger `onClose`.
- [x] 2.3 Refactor URL input, fetch button, quick-tag pills, and custom tag chips to wrap and scale for mobile viewports without horizontal clipping.

## 3. Mobile Preview Flow & Action Docking

- [x] 3.1 Add mobile view switcher/segments (`Details & Tags` vs `Article Preview`) when `preview` is active on mobile shell, defaulting to `Article Preview` upon fetch; verify tab switching in mobile mode.
- [x] 3.2 Make preview container responsive on mobile, allowing full-height scrollable inspection of processed HTML iframe or plain text preview.
- [x] 3.3 Dock the "Import to Library" action button in a sticky mobile footer above the safe area inset when a preview is ready; verify import button triggers `handleImport`.

## 4. Verification & Testing

- [x] 4.1 Add comprehensive unit tests in `src/components/import/__tests__/WebArticleImportDialog.mobile.test.tsx` verifying portal mounting, opaque surface classes, desktop vs mobile layout branching, and mobile preview interaction.
- [x] 4.2 Run unit test suite and lint/type checks to verify no regressions.
