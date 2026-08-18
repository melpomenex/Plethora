# Tasks: Fix mobile EPUB theme regression

## 1. Reproduce and trace the mobile lifecycle

- [ ] 1.1 Reproduce the regression on a native Android/Tauri build (and mobile PWA where available): open an EPUB under a dark theme and record whether the reader shows an un-themed white/browser-default frame, permanently or transiently.
- [ ] 1.2 Temporarily instrument `src/components/viewer/EPUBViewer.tsx` with development-only logging: resolved active theme id, variant, resolved reader background/foreground, `isMobileShell`, rendition creation, theme registration, content-hook and `rendered` execution, `#epub-override-styles` presence, `#epubjs-inserted-css-default` presence, computed `html`/`body` background and text color, iframe background, and `rendition.getContents()` count. Gate behind a development flag so release builds stay quiet.
- [ ] 1.3 Use the diagnostics to settle the remaining platform-timing questions on Android: whether the content hook executes for the initial spine item, whether `#epub-override-styles` is present after first paint, whether `rendition.getContents()` returns expected contents at theme-change time, and whether publisher styles are removed before Plethora styling exists.
- [ ] 1.4 Record findings in the change notes; keep the instrumentation only until Task 17 removes it.

## 2. Correct the test doubles

- [ ] 2.1 Change the `useMobileShell` mock in `src/components/viewer/__tests__/EPUBViewer.test.tsx` to return a real boolean (mutable per test, like `themeState`), so `useMobileShell() === false` and `=== true` are both representable. Remove the object-shaped mock that made `isMobile` always truthy.
- [ ] 2.2 Move `getContents` to the rendition mock where production calls it (`rendition.getContents()` at `EPUBViewer.tsx:744`); make it return a configurable list of `Contents`-like objects, each backed by a real DOM `Document`.
- [ ] 2.3 Make `hooks.content.register` capture its callback, and make `rendition.on("rendered", ...)` invocable, so tests can execute the real styling paths.
- [ ] 2.4 Add a call-order log to the rendition mock (`renderTo`, `themes.register`, `themes.default`, `themes.select`, `display`, content-hook execution) so tests can pin theme-before-display ordering.
- [ ] 2.5 Add a helper that builds an EPUB-like content document (via `DOMParser`): `<html>`, `<head>` with publisher `<link rel="stylesheet">` and publisher `<style>`, `<body>` containing paragraph, heading, link, image, and table samples.

## 3. Establish the authoritative reader-palette resolver

- [ ] 3.1 Extract `resolveReaderPalette()` (`EPUBViewer.tsx:480-511`) into one shared implementation (e.g. `src/lib/readerPalette.ts`) with the contract: the active `Theme` object from `ThemeContext` is authoritative; root CSS variables are fallbacks only; theme tokens never lose to a stale variable.
- [ ] 3.2 Have the resolver return, in one place: `background`, `foreground/text`, `primary/link`, `border`, `color-scheme` (from `theme.variant`), and the app font stack (`getEpubFontFamily` with `settings.appearance.fontFamily` and `theme.typography.fontFamily`).
- [ ] 3.3 Route every EPUB styling path through the resolver: `applyRenditionTheme` (epub.js theme rules) and `applyContentOverrides` (`#epub-override-styles`). Verify no remaining path reads stale root variables first.

## 4. Eliminate the stale rendition-state initialization race

- [ ] 4.1 Refactor `applyRenditionTheme` to accept the concrete rendition instance (`applyRenditionTheme(renditionInstance)`) or read an authoritative `renditionRef` assigned synchronously after `renderTo()` — never the async `rendition` state.
- [ ] 4.2 Reorder the initialization path to: create rendition → register hooks → `themes.register("default", {})` → `applyRenditionTheme(rendition)` → `display(...)` → then `setRendition(...)` for other consumers.
- [ ] 4.3 Update the re-apply effect (`EPUBViewer.tsx:1778-1780`) to call the same instance-based function for theme/settings changes; keep it as the change path only.

## 5. Consolidate theme installation

- [ ] 5.1 Ensure `applyRenditionTheme` performs, in order: resolve palette → `rendition.themes.default({...})` → `themes.select("default")` → `rendition.getContents().forEach(applyContentOverrides + verifyContentThemed)`.
- [ ] 5.2 Make the content hook and the `rendered` handler (`EPUBViewer.tsx:1449-1453`) call the same content-theme installer (`applyContentOverrides` + verification) so initial sections, later spine sections, and re-renders share one mechanism.
- [ ] 5.3 Confirm no separate ad hoc desktop vs mobile styling systems remain unless a platform-specific requirement is proven; if one is needed, document it in the change.

## 6. Make content style replacement failure-safe

- [ ] 6.1 In the content hook (`EPUBViewer.tsx:1131-1158`), run `applyContentOverrides(contents)` (which installs/refreshes `#epub-override-styles` AND critical inline styles on `documentElement`/`body`) before removing publisher nodes.
- [ ] 6.2 Guard the publisher-style removal: only remove after `doc.getElementById("epub-override-styles")` is confirmed present; otherwise keep publisher styles and log a development warning.
- [ ] 6.3 Correct the removal selector to preserve epub.js's own theme nodes: `style:not(#epub-override-styles):not([id^="epubjs-inserted-css-"])`. Never remove `style#epubjs-inserted-css-default` (epub.js `Themes` layer, contents.js:728-747) — publisher `<style>` nodes without that prefix are still removed.
- [ ] 6.4 Add the third theme layer in `applyContentOverrides`: `documentElement`/`body` `background-color`/`color` and `body` `font-family`/`font-size`/`line-height` via `style.setProperty(..., "important")`, updated on every re-apply.
- [ ] 6.5 Add `verifyContentThemed(contents)`: `#epub-override-styles` exists and its `textContent` contains the current background color; computed styles (`getComputedStyle(documentElement/body).backgroundColor`, `getComputedStyle(body).color`) match the expected palette (normalized rgb triples); iframe element carries the intended background color; re-applies the override when missing/stale.
- [ ] 6.6 Call `verifyContentThemed` from the content hook, the `rendered` handler, and the theme-change path (for all mounted contents). Verify the style node survives after `content` and `rendered` lifecycle callbacks.

## 7. Gate visibility on themed initial content

- [ ] 7.1 Replace the plain `display()`-resolved `isLoading` gate (`EPUBViewer.tsx:1711-1713`, `:3155`) with a readiness invariant: book ready + rendition created + initial content rendered + reader theme installed + critical computed colors verified on that content → reader visible.
- [ ] 7.2 Keep `opacity: 0` (or the spinner state) until the initial content document has been verified themed (computed `html`/`body` background and `body` color agree with the palette); do not use an arbitrary timeout as the primary fix.
- [ ] 7.3 Add a fallback release on the initial section's `rendered` event so a verification hiccup cannot permanently hang the reader.

## 8. Add real content-document regression tests

- [ ] 8.1 Test E: capture the content hook, invoke it with the EPUB-like document from Task 2.5, and assert `#epub-override-styles` exists with the active theme's background and foreground, the font family, font size, and line height.
- [ ] 8.2 Assert publisher `<link>`/`<style>` nodes are removed only after the override node exists, and retained when the override cannot be installed.
- [ ] 8.3 Assert the epub.js theme layer survives: a pre-existing `style#epubjs-inserted-css-default` in the content document is NOT removed by the publisher cleanup.
- [ ] 8.4 Assert the third layer: `documentElement`/`body` carry inline `background-color`/`color` (and body font-family/size/line-height) matching the palette, and the document's computed `html`/`body` background and `body` color match the dark palette.
- [ ] 8.5 Assert the iframe element receives the intended background color where applicable.
- [ ] 8.6 Keep the existing `themes.default` argument assertions, but extend them with the content-document assertions so the tests no longer pass on argument checks alone.

## 9. Add mobile/desktop parity tests

- [ ] 9.1 Test A: `useMobileShell() === true` + dark theme → the content document's `html`/`body` rules carry the dark background/light foreground, not white browser defaults.
- [ ] 9.2 Test B: `useMobileShell() === false` → identical theming (desktop parity).
- [ ] 9.3 Test C: stale `documentElement` CSS variables (light) + dark Theme object → injected rules use the Theme object palette; fails if resolution regresses to stale-DOM-first.
- [ ] 9.4 Test D: pin call ordering — `themes.default`/`select` before `display`; content hook executed before the reader becomes visible.

## 10. Add theme-change and new-section tests

- [ ] 10.1 Test F: open under Theme A, switch to Theme B while open; assert all mounted content documents re-styled without book/rendition recreation and without losing the CFI/reading position.
- [ ] 10.2 Test G: simulate a second spine section mounted after initial display; assert it receives the active theme via the content hook.
- [ ] 10.3 Test J: cover one dark built-in theme, one light theme, a non-eager built-in theme (simulate the ThemeContext lazy catalog landing after mount), and a custom theme.
- [ ] 10.4 Test K: standard mobile follows the app theme; explicit E-Ink mode keeps its deliberate high-contrast presentation (tested separately).
- [ ] 10.5 Test L: no-white-frame — the reader stays hidden until the initial content is verified themed.

## 11. Add typography and surface coverage

- [ ] 11.1 Test H: serif, sans-serif/app-font inheritance, monospace, font size, and line height on mobile and desktop.
- [ ] 11.2 Test I: embedded reader (`embedded={true}`) and standalone reader (`embedded={false}`) both themed.
- [ ] 11.3 Verify highlights (persisted, live search), links, tables, images, and headings still render correctly under the themed content in tests.

## 12. Run existing EPUB/reader/selection suites

- [ ] 12.1 Run `npx vitest run src/components/viewer/__tests__/EPUBViewer.test.tsx` (new and existing cases) and the related reader/selection suites (selection-interaction, queue scroll, document viewer tests).
- [ ] 12.2 Run the frontend typecheck (`npx tsc --noEmit`) and lint; fix any fallout.
- [ ] 12.3 Run the repository's standard test gate (e.g. `npm run test:run`) and confirm no regressions in reader/selection/viewer areas.

## 13. Mobile device / manual QA

- [ ] 13.1 On a native Android build with a dark Plethora theme: opening an EPUB shows the theme background immediately, body text uses the theme foreground, typography matches settings, no persistent or transient white browser-default reader appears, subsequent chapters remain themed, changing themes updates the open book, and the Queue embedded reader behaves the same.
- [ ] 13.2 Verify reopening/restoring at a saved CFI remains correct and themed.
- [ ] 13.3 Verify E-Ink mode still applies its deliberate presentation where enabled.
- [ ] 13.4 Spot-check the mobile PWA/browser path where applicable.

## 14. Desktop regression QA

- [ ] 14.1 Confirm desktop EPUB rendering is unchanged (background, text, typography, links, tables, highlights).
- [ ] 14.2 Confirm theme switching, chapter navigation, pagination, continuous scrolling, CFI restore, TOC, selection, Vim runtime, TTS chapter advance, and audiobook sync still work.

## 15. Performance verification

- [ ] 15.1 Confirm theme changes do not recreate the Book/Rendition, reload the EPUB, or regenerate locations.
- [ ] 15.2 Confirm no per-`relocated` re-styling, no polling, and no React render loop (spot-check with the existing bench/test gates if applicable).

## 16. Remove temporary diagnostics

- [ ] 16.1 Remove or fully gate the Task 1.2 instrumentation; confirm release builds contain no noisy permanent diagnostics.

## 17. Document remaining platform-specific caveats

- [ ] 17.1 Record any remaining Android WebView–specific caveat (e.g. srcdoc timing, `getContents` behavior) in the change notes with the evidence gathered in Task 1.
- [ ] 17.2 Update this change's artifacts if implementation diverges from the design (spec deltas, task checkboxes).
