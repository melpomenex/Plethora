# Verification — desktop-global-interface-zoom

Date: 2026-10-21
Branch: `main` (working tree)
Environment: Linux (Hyprland/Wayland session, Xwayland present), Node 26.8.1, Vitest 4.0.18.

Status legend:

- **Pass** — executed in this environment with the stated evidence.
- **Not run** — not executed here; do not treat as verified.
- **Not verified** — platform is unavailable in this environment.

## 1. Automated verification

All commands were run from the repository root.

| Command | Result | Evidence |
| --- | --- | --- |
| `npx vitest run src/lib/interfaceZoom/__tests__ src/hooks/__tests__/useInterfaceZoomBridge.test.tsx src/components/settings/__tests__/InterfaceZoomControl.test.tsx src/components/settings/search/__tests__/interfaceZoomSearch.test.ts src/components/settings/search/__tests__/settingsSearchCoverage.test.ts src/commandPalette/__tests__/interfaceZoomCommands.test.tsx src/commandPalette/__tests__/registry.test.tsx src/commandPalette/__tests__/contextualActions.test.ts src/stores/__tests__/interfaceZoomSettings.test.ts src/__tests__/interfaceZoomConfig.test.ts src/lib/i18n/__tests__/i18n-completeness.test.ts` | **Pass** | 17 files, 169 tests passed. |
| `npx vitest run src/components/common/__tests__/KeyboardShortcuts.test.ts src/components/settings/__tests__/KeyboardShortcutsSettings.interfaceZoom.test.tsx src/components/common/__tests__/KeyboardShortcutsHelp.interfaceZoom.test.tsx` | **Pass** | 3 files, 12 tests passed (includes `Ctrl++` / `⌘+` formatting and the desktop-only row filter). |
| `npx vitest run src/components/viewer/__tests__/EPUBViewer.test.tsx src/components/viewer/__tests__/EPUBViewer.reflow.test.tsx` | **Pass** | 44 tests passed after removing the EPUB reserved-chord branches. |
| `npx vitest run src/components/viewer/__tests__/DocumentViewer.ratingOrbsGating.test.tsx` | **Pass** | 10 tests passed; the surrounding viewer handler behavior is preserved. |
| `npx vitest run src/commandPalette/__tests__` | **Pass** | 17 files, 149 tests passed (registry ids/intents/aliases unique, app and document zoom names distinct). |
| `npx tsc --noEmit` | **Pass** | No diagnostics. |
| `npx eslint <changed source files>` | **Pass (0 errors)** | Warnings are pre-existing in the touched large files; no new lint errors. |
| `npm run build:check` | **Pass** | Docs validation, help index, `tsc`, Vite production build, and bundle budget all passed (`[bundle-budget] OK — entry 5 KB, 1 PDF worker, total 26.8 MB`). |
| `npx openspec validate desktop-global-interface-zoom --strict` | **Pass** | `Change 'desktop-global-interface-zoom' is valid`. |
| `openspec status --change desktop-global-interface-zoom` | **Pass** | `Progress: 4/4 artifacts complete`. |

`src/lib/interfaceZoom/__tests__` contains the required suites:
`constants.test.ts`, `native.test.ts`, `startup.test.ts`, `controller.test.ts`,
`shortcuts.test.ts`, `iframeForwarding.test.ts`, and
`documentShortcutOwnership.test.ts`.

A broader regression sweep also ran the Settings component tests, the
shortcut help/settings tests, the EPUB/DocumentViewer suites, and the two
MainLayout suites. The relevant suites passed. Two pre-existing
`MainLayout.defaultView` failures reproduce with the interface-zoom bridge
removed: the test file mocks `Toast` without `useToastStore`, which
`ActiveRecording` requires. They are unrelated to this change.

## 2. Browser / PWA smoke check

Executed with Playwright Chromium (headless) against the Vite dev server
(`npm run dev`, `http://127.0.0.1:15173/`), fresh browser context.

| Check | Result | Evidence |
| --- | --- | --- |
| Application bootstrap reaches the React shell with the new startup module | **Pass** | `#root[data-plethora-mounted="true"]`; console showed `[startup] plethora-ready: true (React mounted)`. |
| Ctrl+`=` is not intercepted on an unsupported runtime | **Pass** | A document keydown probe recorded `{ key: "=", prevented: false }`; `handleInterfaceZoomKeyDown` returns false before `preventDefault` when support is false. |
| No `[interfaceZoom]` native call/log appears in browser mode | **Pass** | Captured console contained no `[interfaceZoom]` entries. |
| Branded launch overlay eventually clears in this dev-browser profile | **Not run (blocked)** | The Knowledge Peck startup overlay stayed visible in the fresh Playwright profile because startup-data readiness did not settle in this environment; the shell underneath had mounted, so the key-handling probe was valid. This is not an interface-zoom behavior and was not investigated further. |

The browser Settings control therefore renders the localized non-interactive
unsupported explanation by construction (component test:
`InterfaceZoomControl.test.tsx`); the full browser Settings screenshot was not
captured because of the startup-overlay issue above.

## 3. Linux desktop (AppImage) manual matrix

Build command: `npm run tauri:build:linux:appimage`
Expected artifact: `src-tauri/target/release/bundle/appimage/Plethora_3.4.0_amd64.AppImage` (not produced by this run)

**Status: Not run / Not verified.**

The build was started, but this machine was simultaneously running a
`npm run tauri:android:build`, an installed AppImage instance, browsers, and
other tooling. The Linux build first waited on Cargo's target-directory lock
for ~25 minutes, then compiled dependencies and reached the final
`plethora_tauri_lib` codegen/link. At that point the host was at 22/23 GB RAM
with ~32 GB swap in use and the link was thrashing; the build was terminated to
avoid a system-wide OOM. The prior `Plethora_3.4.0_amd64.AppImage` on disk
predates this change and was not used for acceptance.

A second blocker applies even to a successful build: an installed
`/opt/plethora/Plethora.AppImage` instance is currently running and the app
registers `tauri-plugin-single-instance`. Launching the newly built AppImage
would signal and exit in favor of that running instance (and use its real user
profile), so a clean isolated cold-start/zoom test would have required closing
the user's running app without permission.

Consequently the following required checks are **not verified**:

- cold start with 130% persisted and first interactive frame at 130% (8.2);
- restart, tab switching, and AppImage reinstall/update with the preference;
- screenshot overlay remaining at 100%;
- 1280×800, 1366×768, 1440×900, 1920×1080, and 900×600 at 70–150%;
- page-level two-axis scroll, clipped actions, and secondary-pane collapse at
  150% on the minimum window (7.1);
- PDF/EPUB/HTML zoom isolation, reader wheel gestures, visible toolbar
  controls, and document palette actions (7.2);
- keyboard tab order, focus rings, screen-reader labels/value text, 44 px
  targets, reduced motion/E-Ink, light/dark/high-contrast themes, tooltip and
  dialog positioning at 150%, and PDF/Knowledge Sphere high-DPI rendering (7.3).

The source-level coverage for these behaviors is the automated suites above
plus the static ownership guard; **source inspection and unit tests are not a
substitute for the manual matrix**.

## 4. Document isolation

| Check | Result | Evidence |
| --- | --- | --- |
| DocumentViewer no longer handles primary + `+`/`-`/`0` | **Pass (static)** | `documentShortcutOwnership.test.ts`; `rg` finds no legacy block. |
| HTML reader no longer handles primary + `+`/`-`/`0` for font size | **Pass (static)** | The keydown branch and its window registration are gone; the Ctrl/Cmd + wheel listener and A+/A−/reset controls remain. |
| EPUB reader no longer handles primary + `+`/`-`/`0` for font size | **Pass (static)** | Branches removed; J/K chain converted to a plain `if`; visible controls remain. |
| Same-origin iframe forwarding is single-attachment | **Pass (unit)** | `iframeForwarding.test.ts` attaches repeatedly to one window and observes one listener; detach re-enables a later attach. |
| Live PDF/EPUB/HTML isolation | **Not run** | Requires the Linux desktop runtime matrix above. |
| Document palette actions are distinctly named and keep their routes | **Pass (unit/static)** | `contextualActions.test.ts`, `interfaceZoomIntegration.test.ts`; `DocumentViewer` still maps `doc.zoomIn/Out/Reset`. |
| Vision/asset modal, Knowledge Graph/Sphere, fullscreen reading, text inputs, palette-open, modal dialog | **Not run (partially unit-covered)** | Matcher tests cover text inputs, palette-open, and rejected modifiers; visual/manual behavior is not verified. |

## 5. Accessibility and high-DPI

| Check | Result | Evidence |
| --- | --- | --- |
| Control semantics | **Pass (component)** | Slider exposes min 70/max 150/step 10 and `aria-valuetext`; icon buttons have accessible names; `<output aria-live="polite">`; reset is disabled at 100; bounds disable the matching button. |
| Unsupported state is non-interactive | **Pass (component)** | No slider/buttons render; the localized explanation renders as `role="status"`. |
| Inline error and retry | **Pass (component)** | One localized error plus a Retry action; error clears when status clears. |
| 44 px touch targets | **Pass (implementation)** | Buttons use `h-11 w-11` / `min-h-11` (44 px) with theme tokens only. |
| Keyboard-only tab order, focus rings, screen readers | **Not run (live)** | Component assertions cover labels/values; live tab order and screen-reader output were not run. |
| Reduced motion, E-Ink, light/dark/high-contrast themes | **Not run (live)** | No new animation/transition was added; live theme checks require the desktop runtime. |
| 150% tooltip/dialog containment and high-DPI canvases | **Not run (live)** | Requires the desktop runtime matrix. |

## 6. Windows and macOS

**Status: Not verified.** No Windows or macOS machine is available in this
environment. The source is platform-gated as specified:

- Windows/Linux: `isTauri() && !isNativeMobile()` with a Ctrl primary modifier.
- macOS: `version()` from `@tauri-apps/plugin-os` must report major ≥ 11; if it
  cannot be read, the feature reports unsupported. Cmd is the primary modifier.
- The Tauri capability is limited to the `main` window/webview and only grants
  `core:webview:allow-set-webview-zoom`; `app.zoomHotkeysEnabled` remains absent
  (configuration test).

### Windows WebView2 checklist (not run)

- [ ] Build and launch; `Ctrl` + `+`/`-`/`0` and numeric-keypad equivalents.
- [ ] `Shift` + `=` and bare `=` both step once.
- [ ] No double handling with WebView2's built-in zoom (hotkeys stay disabled).
- [ ] Cold start with 130% persisted; first interactive frame at 130%.
- [ ] 900×600 at 150%: no two-axis page scroll; dialogs and palette reachable.
- [ ] Text input and palette-open chord behavior.
- [ ] PDF/EPUB/HTML isolation; toolbar/wheel document controls.
- [ ] Screenshot overlay and YouTube popout remain at 100%.
- [ ] Light/dark/high-contrast/E-Ink, high-DPI PDF and Knowledge Sphere.

### macOS WKWebView checklist (not run)

- [ ] Repeat the Windows checklist with Cmd as the primary modifier.
- [ ] macOS 11+: `pageZoom` applies and the shell reflows.
- [ ] macOS 10.x or an unreadable version: feature hidden and inert (no call,
      no chord interception, no palette commands, non-interactive Settings
      explanation).
- [ ] Native menu bar is expected to stay outside the WebView scale; verify
      in-app menus/popovers are inside it.

## 7. Residual limitations

- **macOS < 11** is intentionally unsupported; `version()` failure also reports
  unsupported rather than risking a WKWebView `pageZoom` crash.
- **Cross-origin iframe focus** (proxied web pages, YouTube/embedded players)
  is outside the parent capture dispatcher. The app toolbar, Settings, and
  Command Palette remain available; the feature does not claim universal
  capture.
- **900×600 at 150%** produces a ~600×400 CSS viewport. The responsive layout
  work was not visually verified here; only source/capability behavior is
  covered by automated tests.
- The branded static boot frame may render at the platform scale before native
  zoom applies; the interactive shell is gated on the startup promise (with a
  2000 ms safety timeout).
- No benchmark was added; the change has no hot-path algorithm and
  `scripts/perf-baselines.json` was not modified.
