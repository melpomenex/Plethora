# Change: Fix mobile EPUB theme regression

## Why

EPUB rendering has regressed on mobile. On a native Android/mobile build the
EPUB content can render as essentially a raw browser document — plain white
background, default-looking dark text, Plethora's active theme absent — while
desktop continues to render the same book correctly. This is a regression: the
reader is supposed to visually inherit the active Plethora theme (background,
text, links, borders, typography) on every platform, and to re-theme live when
the app theme changes.

Two recent commits attempted to fix this exact class of problem:

- `70ed00ea` — `fix(epub): resolve theme colors and typography inheritance regression in EPUBViewer`
- `a9e32515` — `fix(epub): reader resolves palette from the theme object — theme changes reach the iframe again`

The second commit fixed the stale-`documentElement`-CSS-variable race (child
effects run before the parent theme effect writes the variables, so
`getComputedStyle` captured the previous/boot theme). The palette is now
resolved from the `Theme` object first, with the computed variable only as a
fallback. That fix is correct as far as it goes, but the mobile symptom
persists because three deeper lifecycle hazards remain:

1. **The rendition-state race was never eliminated.** `applyRenditionTheme()`
   is invoked during initialization (`EPUBViewer.tsx:1456`) but closes over the
   React `rendition` **state**, which `setRendition()` (`:1065`) has not yet
   updated. The function early-returns (`:696`). The epub.js theme layer is
   therefore never installed before the first `display()` on any platform —
   the initial styling depends entirely on the content hook, and on Android
   that hook fires only after an asynchronous iframe load
   (epub.js `srcdoc` path), so the first paint can precede theming.
2. **The content hook destroys publisher CSS before Plethora styling is
   guaranteed.** The hook removes every `link[rel="stylesheet"]` and
   `<style>` node (`:1135-1144`) and only then injects `#epub-override-styles`
   (`:1158`). If the injection fails, is delayed, or the palette resolves to
   the white fallback, the iframe is left with browser defaults — exactly the
   reported symptom. Nothing re-verifies the content afterwards.
3. **The cleanup also deletes epub.js's own theme layer.** The
   `style:not(#epub-override-styles)` selector is broader than intended:
   epub.js's `Contents.addStylesheetRules()` — the mechanism behind
   `rendition.themes.default(...)` — injects its rules through a style node
   whose id is `epubjs-inserted-css-<key>`
   (`node_modules/epubjs/src/contents.js:728-747`, i.e.
   `style#epubjs-inserted-css-default`). Plethora's cleanup therefore removes
   epub.js's own theme layer from every content document, leaving
   `#epub-override-styles` as the *only* theme mechanism. Any failure or
   delay in that single node leaves the reader with browser defaults — the
   reported white surface. The cleanup MUST preserve
   `#epub-override-styles` and `[id^="epubjs-inserted-css-"]`; not every
   non-Plethora `<style>` is publisher-owned.
4. **The tests cannot catch this.** The rendition mock never invokes the
   registered content hook, `rendition.getContents()` is mocked at the wrong
   location (`themes.getContents`), `useMobileShell` is mocked as an object
   (`{ isMobile: false }`) so it is always truthy, and the regression tests
   only assert the arguments passed to `rendition.themes.default()` — they
   never execute the code that actually styles the rendered EPUB document.

This change hardens the EPUB theming lifecycle so that a theme is installed on
the concrete rendition instance **before** its first content becomes visible,
on every platform, with one authoritative palette source and failure-safe style
replacement, and adds regression tests that execute the content hook against
realistic EPUB content documents.

## What Changes

- **One authoritative reader palette resolver.** A shared, single
  implementation resolves background, foreground/text, primary/link, border,
  `color-scheme` (dark/light), and the app font stack. Input contract: the
  active `Theme` object from `ThemeContext` is authoritative; root CSS
  variables are used only as fallbacks for missing optional tokens and must
  never override a newer Theme object because parent DOM effects have not
  completed.
- **Theme installed on the concrete rendition before first display.**
  `applyRenditionTheme` accepts the concrete rendition instance (or reads an
  authoritative `renditionRef`) and is executed synchronously in the
  initialization path after `renderTo()` and hook registration but **before**
  `rendition.display(...)`, eliminating the state-null no-op. The initial
  content document is also themed synchronously by the content hook.
- **Failure-safe style replacement with three theme layers.** The content
  hook installs `#epub-override-styles` **and** critical inline styles
  (documentElement/body background-color, color, body font-family/font-size/
  line-height, all `!important`) before removing publisher styles. epub.js's
  own theme nodes (`[id^="epubjs-inserted-css-"]`) and
  `#epub-override-styles` are never removed; publisher CSS is removed only
  after Plethora styling is confirmed present. The reader's basic
  background/foreground correctness never depends on a single dynamically
  inserted `<style>` node.
- **Readiness invariant for visibility.** The reader container only becomes
  visible (`opacity` gate) after the initial content document is verified
  themed — including a computed-style check
  (`getComputedStyle(documentElement/body).backgroundColor/color` agreeing
  with the expected palette): book ready + rendition created + content
  rendered + reader theme installed + critical computed colors verified. No
  arbitrary timeout as the primary fix.
- **Corrected test doubles and real content-document tests.** The
  `useMobileShell` mock returns actual booleans with separate mobile/desktop
  cases; `getContents` is exposed on the rendition mock where production calls
  it; the content hook is captured and executed against an EPUB-like DOM
  document; tests assert the actual injected `#epub-override-styles` rules
  (background, foreground, font family, size, line-height), theme switching
  while open, newly mounted spine sections, embedded vs standalone, light and
  dark and custom themes, typography, and explicit E-Ink behavior.
- **Temporary native instrumentation.** Development-only logging on the
  Android/Tauri path to settle remaining platform-timing questions
  (content-hook execution order, `getContents` contents, override-style
  presence, computed backgrounds), removed before merge.

## Capabilities

### New Capabilities

- `epub-reader-theming`: EPUB reader inherits and tracks the active Plethora
  theme on every platform, with a single palette-resolution source, a
  guaranteed pre-display theme installation, failure-safe content style
  replacement, and a verified-themed readiness gate. (No existing canonical
  spec in `openspec/specs/` covers EPUB reader theming.)

### Modified Capabilities

None — the fix is a delta on `EPUBViewer` behavior; no canonical capability
requirements are changed.

## Impact

- **Reader**: `src/components/viewer/EPUBViewer.tsx` (initialization order,
  palette resolution, content hook, readiness gate) and optionally a new
  shared module such as `src/lib/readerPalette.ts` for the palette resolver.
- **Tests**: `src/components/viewer/__tests__/EPUBViewer.test.tsx` (mock
  shapes, content-hook execution, parity/typography/theme-switch/new-section
  coverage). The existing `EPUBViewer` theme tests are extended, not replaced.
- **Surfaces verified, not reworked**: `DocumentViewer.tsx` (standalone),
  `QueueScrollPage.tsx` (embedded/Queue Scroll Mode), `ThemeContext.tsx`
  (lazy catalog behavior is preserved; tests simulate it), `displayMode.ts`
  / E-Ink path (preserved; covered by a dedicated test).
- **Native verification**: Android/Tauri build; mobile PWA where applicable.

## Non-Goals

- No redesign of the reader UI or of EPUB normalization behavior.
- No recreation of the epub.js `Book`/`Rendition` on theme change; no reload
  of the EPUB ZIP, no `locations` regeneration, no per-`relocated` re-styling,
  no polling, no arbitrary startup timeouts.
- No change to CFI position restore, progress, TOC, continuous scrolling,
  paginated/E-Ink mode, highlights (persisted/search/sync), selection UX,
  Vim runtime, TTS chapter advance, audiobook sync, images/tables/links,
  volume-rocker navigation, or teardown protections — these must keep working.
- Not a replacement for the `a9e32515` theme-object-first fix; that fix stays,
  and this change builds the same rule into every styling path via the shared
  resolver.
