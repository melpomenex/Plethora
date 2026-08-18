# Design: Fix mobile EPUB theme regression

## Context

`EPUBViewer` (src/components/viewer/EPUBViewer.tsx) is the single EPUB surface.
It is hosted by `DocumentViewer` (standalone reader) with `embedded={false}`,
and by `QueueScrollPage` (Queue Scroll Mode) with `embedded={true}`. Both run
the same component on desktop, Android Tauri WebView, and the mobile PWA.
Theming is driven by `ThemeProvider` from `src/contexts/ThemeContext.tsx`
(the only mounted theme provider; `src/main.tsx:400`); `useMobileShell()`
returns `usePresentation().isMobileShell` (a boolean).

### Current EPUB rendering lifecycle (HEAD 63c87737)

1. `loadEPUB()` effect runs when `containerHasSize && (fileUrl || fileData)`
   (`EPUBViewer.tsx:879-880`).
2. `ePub(...)` opens the book; `await epubBook.ready` (`:929`); TOC loaded
   (`:1001-1017`).
3. `initializeRendition()` (`:1024`):
   - waits for `viewerRef` and a sized container (up to 10 × 100 ms retries,
     `:1027-1049`);
   - resolves E-Ink mode → `flow: "scrolled"`/`"paginated"`, manager
     `"continuous"`/`"default"` (`:1051-1062`);
   - `const rendition = epubBook.renderTo(...)` (`:1055`);
   - `renditionInstance = rendition; setRendition(rendition)` (`:1064-1065`)
     — the state update is **asynchronous**;
   - registers `rendition.hooks.render` (no-op, `:1126`), the **content hook**
     (`:1131`), and `rendition.on("rendered", ...)` (`:1449`);
   - `rendition.themes.register("default", {})` (`:1455`);
   - **`applyRenditionTheme()` (`:1456`) — closes over the React `rendition`
     state, which is still `null` in this closure → early return at `:696`
     (`if (!rendition) return;`). The epub.js theme layer is never applied
     before the first display on any platform.**
   - `await rendition.display(target)` (`:1477-1482`) — inside epub.js this
     runs the chain `view.load()` → `hooks.content.trigger(view)` →
     `layout.format` → `view.display()` → `hooks.render.trigger` →
     `view.show()` → `rendered` event (node_modules/epubjs/src/rendition.js
     `render()`; content hooks registered by `Themes` at construction
     `themes.js:21-22` run first, then ours);
   - `finally { setIsLoading(false) }` (`:1711-1713`) — **the reader becomes
     visible when `display()` resolves, with no theme-verified readiness
     check** (`style={{ opacity: isLoading ? 0 : 1 }}` at `:3155`).
4. After the re-render that flushes `setRendition`, the re-apply effect
   (`:1778-1780`, deps include `theme`) runs `applyRenditionTheme()` for real:
   `rendition.themes.default({...})` (`:705`) + `themes.select("default")`
   (`:741`) + `applyContentOverrides()` on `rendition.getContents()` (`:744`).

### Theme resolution lifecycle

- `ThemeProvider` mounts with only three eager fallback themes
  (`ThemeContext.tsx:246-253`: biolume-abyss, super-game-bro, milky-matcha);
  the full built-in catalog is lazy-imported on mount (`:271-290`).
- `currentTheme = themes.find(id) || themes[0]` (`:266`) — a saved theme id
  from the lazy catalog resolves to the fallback until the import settles.
- `ThemeProvider` writes the theme to `document.documentElement` in a parent
  effect (`:293-314`). React runs child effects before parent effects, so a
  viewer effect can observe the new theme object while the CSS variables are
  still the previous theme's — the race `a9e32515` fixed by making the Theme
  object authoritative.
- `EPUBViewer` mirrors the context into `themeRef` in an effect (`:388`),
  declared before the load effect, so `themeRef` is fresh when the load effect
  runs. `resolveReaderPalette()` (`:480-511`) reads `themeRef.current` first,
  computed variables as fallback only.

## Root cause analysis

The theme-object-first fix (`a9e32515`) is correct but incomplete: it fixed
*what values* the reader resolves, not *when* they are installed. The mobile
symptom (raw white browser document under a dark app theme) is the
consequence of the installation being optional and late:

1. **Initial theming has exactly one mechanism.** The `applyRenditionTheme()`
   call in the initialization path is a guaranteed no-op (state-null closure,
   `:696`/`:1456`), so `rendition.themes.default()`/`select()` never run
   before the first `display()`. The only thing that styles the initial
   content is the content hook's `applyContentOverrides()` (`:1131-1158`).
2. **The content hook fires after an async iframe load on mobile.** epub.js
   creates the iframe, then either sets `srcdoc` (async `onload` → `Contents`
   → hooks) or writes the document synchronously
   (node_modules/epubjs/src/managers/views/iframe.js:384-430). Modern
   Android WebViews take the `srcdoc` path, so the hook runs in a later task;
   the empty iframe (browser-white, default styles) can be painted first.
3. **The content hook is destructive before it is constructive.** Publisher
   `<link>`/`<style>` nodes are removed (`:1135-1144`) before
   `applyContentOverrides()` injects `#epub-override-styles` (`:1158`), with
   no `try/catch` between. Any failure in resolution, injection, or a
   WebView-specific DOM quirk leaves a naked document — and if
   `resolveReaderPalette()` fell back to `#ffffff` (theme object missing
   colors at that moment, e.g. a lazy-catalog fallback theme or partial
   custom palette, plus stale variables), the white is baked with
   `!important`.
4. **Nothing re-verifies the content afterwards.** The `rendered` backstop
   (`:1449-1453`) re-applies overrides per view, and the re-apply effect
   re-runs on `theme` changes, but neither checks that the override node
   exists or that the iframe is non-default. If the hook errored or the
   palette was stale, the reader stays wrong until a later theme/settings
   change.
5. **The cleanup selector deletes epub.js's own theme layer.** The hook's
   `style:not(#epub-override-styles)` removal matches every style node epub.js
   generates: `Contents._getStylesheetNode()` creates
   `epubjs-inserted-css-<key>` (node_modules/epubjs/src/contents.js:728-747),
   so `rendition.themes.default(...)` + `select("default")` produce
   `style#epubjs-inserted-css-default` which the hook then deletes. The
   epub.js theme layer is therefore destroyed on every content document, and
   `#epub-override-styles` becomes the sole theme mechanism — a single point
   of failure for the white/un-themed reader. `Themes.inject` runs before our
   content hook (registered first), so the node exists at cleanup time and is
   deleted; `Themes.update` (theme change) recreates it afterwards, which is
   why the failure is intermittent across timing/platform.
5. **The tests cannot see any of this** (see Test blind spots below).

### Answers to the ten lifecycle questions

1. **Can `applyRenditionTheme()` execute before the React `rendition` state
   contains the freshly created rendition?** Yes — it is *guaranteed* to:
   `setRendition()` (`:1065`) is async, the call at `:1456` runs in the same
   closure where the state is still `null`, and the function early-returns
   (`:696`). The epub.js theme layer is never applied before the first
   `display()` on any platform.
2. **Does Android display initial content before the later React effect
   re-applies the theme?** Statically possible and timing-dependent: the
   content hook's `applyContentOverrides` is the only pre-display styling and
   runs after an async `srcdoc` load; the re-apply effect (`:1778`) runs at
   the next React commit. On desktop the scheduling hides the gap; on Android
   WebView the iframe paint can land before either. Runtime verification
   (Task 1) must confirm with the instrumentation checklist.
3. **Does the `content` hook execute on mobile for the initial spine item?**
   It should (epub.js triggers it in every manager), but this is not
   statically decidable for Android WebView; it is on the runtime checklist.
   The design does not depend on it.
4. **Is `#epub-override-styles` actually present in the mobile iframe after
   rendering?** Unknown until runtime verification; the design adds a
   verification step (`verifyContentThemed`) that re-applies when missing.
5. **Is it ever removed/replaced after the content hook?** Only by
   `applyContentOverrides` itself (remove-then-reinsert, `:542-545`), which is
   idempotent. epub.js's theme injection adds its own style node and does not
   remove ours. No third-party removal found.
6. **Are publisher styles removed before Plethora styling is guaranteed to
   exist?** Yes, by construction (`:1135-1144` before `:1158`). This is the
   naked-document failure path and is eliminated by installing the override
   first and only then removing publisher CSS.
7. **Does `rendition.getContents()` return the expected contents on Android
   at theme-change time?** The production call (`:744`) is correct; the test
   double exposes `getContents` under `themes` (`EPUBViewer.test.tsx:19`), so
   the try/catch at `:743-749` silently swallows a missing method in tests.
   Android runtime behavior is on the checklist.
8. **Can ThemeContext's lazy catalog/startup effects leave the reader with a
   stale fallback?** Yes, for a brief window: a saved lazy-catalog theme id
   resolves to the fallback theme until the catalog import settles
   (`ThemeContext.tsx:266`, `:271-290`). The reader is then themed with the
   fallback, and re-themed when the real theme object lands (the re-apply
   effect depends on `theme`). This is a flash, not a permanent failure —
   unless the resolved palette at content-hook time is the `#ffffff` fallback
   (missing colors + stale variables). Tested in Test C/J and Task 10.
9. **Why do the current tests pass despite the observed native-mobile
   failure?** Because they assert `rendition.themes.default(...)` argument
   values (`EPUBViewer.test.tsx:353-356`, `:397-400`) — the *later* effect
   path, which jsdom always runs — and never execute the content hook, never
   touch a content DOM, mock `useMobileShell` as a truthy object
   (`:113-117`), and place `getContents` where production never looks
   (`:19`). Every test silently runs the pseudo-mobile branch.
10. **Which test would have failed before this regression reached the app?**
    None in the current suite. The minimal failing regression would invoke the
    captured content hook against a realistic content document and assert the
    injected rules; the next would pin `themes.default` before `display`
    ordering; the next would run `useMobileShell() === true` against a dark
    theme and assert a non-white `#epub-override-styles`.

### epub.js hook ordering (verified in node_modules/epubjs@0.3.93)

- `Rendition` registers `hooks.content` handlers at construction
  (`handleLinks`, `passEvents`, `adjustImages`); `Themes` registers `inject`
  and `overrides` on `hooks.content` (`themes.js:21-22`).
- Display chain: `view.load()` → `hooks.content.trigger(view)` →
  `layout.format` → `view.display()` → `hooks.render.trigger` →
  `view.show()` (queued) → `rendered` event (rendition.js `render()`).
- `themes.default({...})` stores rules and calls `update()` →
  `contents.addStylesheetRules(rules, "default")` into **current** contents;
  future contents get them via the `inject` content hook (`themes.js:115-200`).
- Because our hook registers after `Themes`, ours runs after epub.js's theme
  injection for the same content document — with `!important` rules that win.

### Desktop vs mobile timing analysis

Desktop (macOS WKWebView / Windows WebView2 / Linux WebKitGTK):
`renderTo` → hook registration → `display()` → content hook runs
synchronously inside the display promise chain → `#epub-override-styles` is in
the content document before `view.show()`; the React re-render then installs
the rendition theme. The scheduling is forgiving.

Android Tauri WebView / mobile PWA:
- iframe content creation takes the `srcdoc` path (async `onload`), so the
  content hook runs in a later task; the WebView can paint the empty,
  browser-default iframe first;
- React commits and `requestAnimationFrame`-driven epub.js queue steps can
  interleave differently, widening the gap between "content visible" and
  "theme installed";
- viewport/`ResizeObserver` churn (address bar, keyboard) makes the
  post-display re-render timing less predictable.

Both platforms share the same code, so the fix must make the *order* explicit
and platform-independent, not rely on scheduling luck.

## Proposed architecture

### Core invariant

> An EPUB section must never become visibly readable before Plethora's reader
> theme has been installed onto that rendition/content document.

### Pinned initialization order

```text
EPUB source resolves
    ↓
Book ready (await epubBook.ready)
    ↓
create rendition instance (renderTo)
    ↓
register content/render hooks (including V2 selection wiring)
    ↓
resolve authoritative Plethora reader palette  ← single resolver
    ↓
install rendition theme ON THIS rendition instance  ← applyRenditionTheme(rendition)
    ↓
display initial CFI/chapter
    ↓
content hook: install Plethora override CSS FIRST, then remove publisher CSS
    ↓
verify content is themed (verifyContentThemed)
    ↓
reader becomes visible (readiness gate)
```

Not the current order:

```text
create rendition → display → (later React state/effect cycle) → eventually theme it
```

Concretely in `EPUBViewer.tsx`:

1. `applyRenditionTheme` is refactored to accept the concrete rendition
   instance (`applyRenditionTheme(renditionInstance)`) or to read an
   authoritative `renditionRef` that is assigned synchronously at `renderTo`
   time — never the async state. All call sites (initialization, the re-apply
   effect, settings changes) pass the same instance. The re-apply effect
   remains for *changes* only.
2. The initialization path becomes:
   `themes.register("default", {})` → `applyRenditionTheme(rendition)` →
   `display(...)` → `setRendition(rendition)` (state kept for other
   consumers). `rendition.themes.default({...})` and
   `themes.select("default")` therefore run **before** the first display, so
   epub.js's own theme layer styles every content document from creation.
3. A **readiness invariant** replaces the plain `display()`-resolved gate:
   the viewer container stays at `opacity: 0` until
   `bookReady && renditionCreated && contentRendered && themeInstalled` —
   i.e. the initial content document has been verified themed. This is
   implemented with a `themeInstalledRef`/state set by
   `verifyContentThemed()` on the initial content (first content-hook or
   `rendered` execution), not a timeout.

### Authoritative palette resolver

Extract `resolveReaderPalette()` into one shared implementation (e.g.
`src/lib/readerPalette.ts`), with the contract:

> The active `Theme` object from `ThemeContext` is the authoritative semantic
> palette for the EPUB reader. Root CSS variables may be used as
> compatibility/fallback values for missing optional tokens, but they must
> never override a newer Theme object merely because parent DOM effects have
> not completed.

It derives, in one place: `background`, `foreground/text`, `primary/link`,
`border`, `color-scheme` (via `theme.variant`), and the app font stack
(`getEpubFontFamily` with `settings.appearance.fontFamily` and
`theme.typography.fontFamily`). Both `applyRenditionTheme` (epub.js theme
rules) and `applyContentOverrides` (`#epub-override-styles`) call it. The
transparent-theme opacity handling stays in the callers (it needs the iframe
background decision).

### Failure-safe content style replacement (three theme layers)

In the content hook (`:1131-1158`):

1. `applyContentOverrides(contents)` runs **first** — it is idempotent and
   installs two independent Plethora layers on the content document:
   - `#epub-override-styles` (full descendant normalization, as today), and
   - **critical inline styles** directly on `documentElement` and `body`
     (`background-color`, `color`, and `body` `font-family`/`font-size`/
     `line-height`, all via `style.setProperty(..., "important")`). The
     reader's basic background/foreground correctness must not depend on a
     single dynamically inserted `<style>` node surviving.
2. Only then remove publisher nodes — but with a corrected selector that
   preserves Plethora's and epub.js's own nodes:
   `style:not(#epub-override-styles):not([id^="epubjs-inserted-css-"])`.
   epub.js's `Themes` layer (`style#epubjs-inserted-css-default`) is a
   legitimate third layer and must survive; `link[rel="stylesheet"]` removal
   stays (publisher stylesheets only).
3. Wrap the removal in a guard that verifies `doc.getElementById("epub-override-styles")`
   exists after injection; if injection failed, skip the removal (publisher
   styles remain rather than leaving a naked document) and report a
   development warning.
4. `verifyContentThemed(contents)`:
   - `#epub-override-styles` exists **and** its `textContent` contains the
     current background color; otherwise re-run `applyContentOverrides`;
   - **computed-style verification** on the content document:
     `getComputedStyle(documentElement).backgroundColor`,
     `getComputedStyle(body).backgroundColor`, and
     `getComputedStyle(body).color` are compared (normalized rgb triples)
     against the expected Plethora palette; mismatch → re-run
     `applyContentOverrides`;
   - the iframe element (`contents.window.frameElement` or the viewer's
     iframe) has the intended `backgroundColor`;
   - returns true when the critical computed colors agree — this feeds the
     initial-readiness gate.
   Called from the content hook, the `rendered` handler (`:1449-1453`), and
   the theme-change path (for all `rendition.getContents()` items).

The three layers, in document order, are: epub.js's `epubjs-inserted-css-*`
(installed by `Themes.inject` before our hook), Plethora's
`#epub-override-styles`, and Plethora's inline critical styles (highest
specificity, independent of any stylesheet). Desktop behavior is unchanged —
the layers are redundant reinforcement there.

### Theme change while open

`applyRenditionTheme(rendition)` on `theme`/settings change:

- resolve the new palette (theme object first);
- `rendition.themes.default({...})` + `themes.select("default")`;
- `rendition.getContents()` → `applyContentOverrides(contents)` +
  `verifyContentThemed(contents)` on every mounted content document.

No book/rendition recreation, no position loss (`relocated`/CFI untouched),
and the existing `selectionInteractionBridge.invalidate("epub-theme-changed")`
stays.

### Newly mounted spine sections

The content hook is the single mechanism for later sections (epub.js fires it
for every new content document in the continuous manager); the `rendered`
handler is the backstop. Both call the same `applyContentOverrides` +
`verifyContentThemed`. No per-`relocated` styling — the hook fires per content
document, not per scroll event.

### E-Ink interaction

`resolveEffectiveEinkMode`/`loadSavedDisplayMode` (src/lib/displayMode.ts)
only select flow/manager (`:1051-1062`). Standard mobile mode follows the app
theme exactly like desktop. If E-Ink mode intentionally forces a
high-contrast presentation, that must remain a *separate* presentation
concern (e.g. `data-display-mode="eink"` host styling) and must never be the
mechanism that "fixes" standard mobile theming. A dedicated test pins the
E-Ink behavior (Task 13).

### Failure/fallback behavior

- Content hook throw → publisher styles are retained (removal is
  post-verification), `#epub-override-styles` re-applied on `rendered` and on
  theme/settings change; a development warning is logged.
- Palette fallback: theme object missing a token → CSS variable → hardcoded
  default (existing behavior), but now only for genuinely missing tokens, and
  always re-checked on theme change.
- Lazy catalog: reader themed with the fallback theme during the catalog
  import window; when the real theme object arrives, the re-apply effect
  re-themes (already the case; covered by a test simulating the late theme
  object).
- Readiness: if the initial content never verifies themed within the normal
  lifecycle (no timeout as primary fix), the reader must still become usable
  via the `rendered`/content-hook backstops; the readiness gate has a
  *fallback* release on `rendered` for the initial section so a verified
  first paint is the goal, not a hang.

### Performance

- No `Book`/`Rendition` recreation, no ZIP reload, no `locations`
  regeneration on theme change.
- `applyContentOverrides` touches only the content document's head (one
  `getElementById`, one style node) — no DOM walks of body content.
- Styling runs only at: initial content mount, new spine content mount,
  explicit reader setting/theme change, and epub.js `rendered` (per section,
  not per scroll). No `relocated`-driven styling, no polling, no render loop.

## Testing strategy

### Corrected test doubles (src/components/viewer/__tests__/EPUBViewer.test.tsx)

- `useMobileShell` mock returns a real boolean; tests cover both
  `useMobileShell() === false` and `=== true` with separate cases (the mock is
  made mutable per test, like `themeState`).
- `getContents` moves to the rendition mock (`rendition.getContents()`),
  returning configurable `Contents`-like objects (each with a real
  `document`).
- `hooks.content.register` captures the callback; a helper builds an
  EPUB-like `Document` (via `DOMParser`) with `<html>/<head>`, publisher
  `<link rel="stylesheet">`, publisher `<style>`, `<body>` with
  paragraph/heading/link/image/table samples, invokes the hook, and returns
  the document for assertions.
- Call-order log on the rendition mock (e.g. `renderTo`, `themes.register`,
  `themes.default`, `themes.select`, `display`) so tests can pin
  theme-before-display ordering.
- `rendered` handler is invocable via `rendition.on("rendered", ...)` capture
  for the backstop tests.

### Regression cases (all under the new capability spec)

- A. `useMobileShell() === true` + dark theme → content document `html`/`body`
  rules contain the dark background and light foreground; iframe
  `backgroundColor` set.
- B. `useMobileShell() === false` — desktop parity.
- C. Stale CSS variables (`--color-background: #ffffff`) + dark Theme object
  → the injected rules use the Theme object colors (fails if resolution
  regresses to stale-DOM-first).
- D. Pin ordering: `themes.default`/`select` before `display`; content hook
  executed before the reader becomes visible.
- E. Content hook against the realistic document: `#epub-override-styles`
  exists with background, foreground, font family, size, line-height;
  publisher CSS removed only after override present.
- F. Theme switch while open: contents re-styled without recreation (book/
  rendition instances unchanged), `getContents` re-applied.
- G. Second spine section mounted after initial display receives the theme.
- H. Typography: serif / sans-serif (app-font inheritance) / monospace, font
  size, line height — mobile and desktop.
- I. Embedded (`embedded={true}`) and standalone (`false`) both themed.
- J. Light theme, dark theme, non-eager built-in theme (simulating the lazy
  catalog landing after mount), and a custom theme.
- K. E-Ink: standard mobile follows the app theme; explicit E-Ink mode keeps
  its deliberate high-contrast presentation (tested separately).
- L. No-white-frame: reader stays at `opacity: 0` until the initial content
  is verified themed.

### Native runtime verification (Task 1, 15)

On Android/Tauri (priority) and PWA: temporarily instrument `EPUBViewer` with
development-only logging — resolved theme id, `isMobile`,
background/foreground resolved, rendition creation, theme registration,
content-hook and `rendered` execution, `#epub-override-styles` presence,
computed `html`/`body` background and text color, iframe background, and
`rendition.getContents()` count. Settle the remaining platform-timing
questions, then remove the diagnostics before merge (Task 17).
