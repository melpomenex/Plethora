## Why

Plethora's desktop interface is authored at a fixed 100% scale, so on a 13–14-inch laptop the sidebar, tab strip, toolbars, settings rows, dialogs, and review controls consume a large share of the screen. The application already *advertises* `view.zoom-in` and `view.zoom-out` in Settings → Shortcuts, but neither action has a registered handler, no code calls Tauri's WebView zoom API, and there is no interface-scale preference. Users are therefore told a feature exists while the only available workaround is changing operating-system display scaling for every application.

Document-level zoom is a separate, already-working concern (PDF scale, EPUB/HTML typography, image/graph zoom) and must not be conflated with application chrome scaling. This change adds the missing product capability without taking reader functionality away.

## What Changes

- Add a desktop-only **Interface Zoom** preference with a 100% default, 70% minimum, 150% maximum, and fixed 10% steps. The preference is device-local, persisted in the existing settings store, and applied to the main application WebView with Tauri's native page-zoom API.
- Apply the persisted value during startup before the React application shell is imported, and apply every later change immediately without reload, CSS transform, or a new settings subsystem.
- Add a polished **Settings → Appearance → Display → Interface Zoom** control: current percentage, minus/plus buttons, a 70–150% slider, reset-to-100%, helper copy that distinguishes interface zoom from document zoom, keyboard access, visible focus, and screen-reader labels.
- Add global **Zoom In**, **Zoom Out**, and **Reset Zoom** commands to the Command Palette.
- Make the existing `view.zoom-in` / `view.zoom-out` shortcut definitions real, add `view.zoom-reset`, and honor Ctrl on Windows/Linux and Cmd on macOS including `Shift+=` plus variants and numeric-keypad keys. Keep the existing shortcut-customization store authoritative.
- **BREAKING for document shortcut owners:** reserve Ctrl/Cmd + `+`, `-`, and `0` for application interface zoom. Remove the duplicate document-zoom/font-size handlers from the document viewer, HTML reader, and EPUB reader so one key press cannot change both layers. Preserve document zoom through existing visible toolbar controls, reader typography controls, Ctrl/Cmd + wheel inside readers, and the (renamed) document-specific Command Palette actions.
- Register the minimum Tauri capability needed for `setWebviewZoom`, scoped to the `main` window only; do not enable Tauri/WebView2's built-in zoom hotkeys.
- Add focused unit, hook, settings-search, command-registry, persistence, and configuration tests, plus a Linux AppImage manual acceptance matrix. Windows and macOS behavior is specified and code-gated but cannot be runtime-verified in this environment.

## Capabilities

### New Capabilities

- `desktop-interface-zoom`: Desktop-only application-wide native interface zoom, including range/step rules, device-local persistence, startup restoration, shortcut ownership, Settings and Command Palette surfaces, failure recovery, serialization, accessibility, and responsive-layout guarantees.

### Modified Capabilities

- `html-reader-controls`: The requirement that Ctrl/Cmd + Plus/Minus/0 changes HTML font size is removed because those chords now belong to interface zoom. Font-size controls and Ctrl/Cmd + wheel remain; the replacement behavior is covered by the new capability.
- `tauri-desktop-interface`: The compact-window usability requirement is extended so the configured minimum window remains operable at the maximum supported interface zoom, when the effective CSS viewport is narrower than the previous 760×560 CSS-pixel target.

## Impact

- **State/persistence:** `src/stores/settingsStore.ts` (new `interface.interfaceZoom` field, default, normalization, hydration merge). No database migration, no sync payload, and no version bump are expected.
- **Native layer:** new `src/lib/interfaceZoom/` modules, a main-window-only `src-tauri/capabilities/interface-zoom.json`, and a startup gate in `src/main-bootstrap.ts`.
- **Shortcuts:** `src/components/common/KeyboardShortcuts.tsx`, `src/components/settings/KeyboardShortcutsSettings.tsx`, `src/components/layout/MainLayout.tsx`, `src/components/viewer/DocumentViewer.tsx`, `src/components/viewer/EPUBViewer.tsx`.
- **UI/search/palette:** `src/components/settings/SettingsPage.tsx`, new `src/components/settings/InterfaceZoomControl.tsx`, `src/components/settings/search/settingsSearchCatalog.ts` and its coverage inventory, `src/commandPalette/registry.tsx`, `src/commandPalette/contextualActions.ts`, and all six locale dictionaries.
- **Compatibility:** no new npm or Cargo dependency. The existing `@tauri-apps/api` 2.11.1 and Tauri 2.11.5 already expose `getCurrentWebview().setZoom(factor)`; the missing capability permission is the only native configuration change.
- **Out of scope:** Android/iOS interface scaling, mobile pinch-to-zoom, browser/PWA replacement of native browser zoom, CSS-transform scaling, redesigning readers, and unrelated responsive redesigns.
