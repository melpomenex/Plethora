# Change: Native Tray / Menu-Bar / Status-Area Icon

Covers numbered requirement **#20 (Plethora top-bar/system-tray/status-bar icon)**.

## Why

Plethora currently has **no tray/status-icon functionality** on any platform.

### Current state discovered

- **Tauri 2.11.0** is used with the `unstable` feature enabled; the `tray-icon` crate (0.23.1) with its Linux `libappindicator` backend is already a transitive dependency — so the built-in `tauri::tray::TrayIconBuilder` / `TrayIcon` API is available **without adding a new plugin**. `muda` (menus) is also present.
- **No tray config:** no `trayIcon`/`systemTray` key in any `tauri.conf.json` (base or platform variants); no `TrayIconBuilder` usage; no `tauri-plugin-tray` dependency.
- **No window-close interception:** there is no `on_window_event`, `RunEvent`, `CloseRequested`, or `ExitRequested` handling anywhere. Tauri's default applies: **closing the last window quits the app**. The builder ends directly at `.run(tauri::generate_context!())` (`src-tauri/src/lib.rs:2181–2182`).
- **Quit paths today:** macOS menu `PredefinedMenuItem::quit` (`lib.rs:942`); frontend `gen.quit` shortcut → `window.close()` (`MainLayout.tsx:184`); title-bar close button → `appWindow.close()` (`LinuxWindowControls.tsx:165`). No `app.exit`/`process.exit` calls.
- **Single instance:** not handled (no `tauri-plugin-single-instance`). Reopening the binary spawns a second process.
- **Icons available:** `src-tauri/icons/32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `macos-dock-icon.png`; `assets/brand/plethora-icon-512.png`. No dedicated monochrome/template tray icon exists yet (needed for macOS menu-bar conventions).
- **Reusable patterns:** `apply_window_icons()` decodes `include_bytes!("../icons/icon.png")` via `tauri::image::Image::from_bytes` (`lib.rs:649–665`); per-platform `#[cfg]` gating discipline is established.

### Important lifecycle note

The requirement explicitly states: **a tray icon does not inherently mean "Close hides instead of quits."** The current behavior — closing the main window quits Plethora — SHALL be preserved unless this change explicitly specifies and justifies a different lifecycle. This proposal SHALL keep close-to-quit behavior and add the tray as a convenience (Show/Open, Hide/Show if supported, Quit), not silently convert to "minimize to tray forever."

## What Changes

1. **Tray/status icon (all supported platforms):** Create a `TrayIconBuilder` in `setup()` with the Plethora icon asset (32×32 for Linux/Windows; a monochrome/template icon for macOS menu bar, or a properly sized non-blurry variant per macOS conventions), a sensible minimal menu (Show/Open Plethora, Hide/Show window where supported, Quit), and platform-conventional click behavior (left-click shows/focuses the window, right-click opens the menu on Windows/Linux; macOS uses menu-bar conventions).
2. **Linux/Ubuntu:** Use the standard status-notifier/appindicator backend already available through `tray-icon`; be realistic about desktop fragmentation (GNOME may need an extension; KDE Plasma/COSMIC typically support SNI) — use standard protocols, no desktop-specific hacks. Ensure it works under the Ubuntu configurations Plethora supports when tray/status icons are available.
3. **macOS:** Use the proper menu-bar/status-item implementation with template/monochrome handling so the icon renders correctly with menu-bar conventions and HiDPI.
4. **Lifecycle:** Preserve "close quits." Add `RunEvent`/close handling only to the extent needed for correct tray-driven show/hide and Quit (Quit through the tray SHALL actually terminate the application per the existing lifecycle). If window close were ever changed to hide-to-tray, it would be a separate explicit decision — not part of this change.
5. **Reopen behavior:** If feasible without a new dependency, make reopening an already-running instance focus the existing window (e.g. via `tauri-plugin-single-instance` or platform handling); otherwise document the current multi-instance behavior as known limitation.

## Impact

### Affected Specs
- `tray-integration` (new, #20)

### Affected Code Areas
- `src-tauri/src/lib.rs` — `TrayIconBuilder` in `setup()`, menu construction (`muda`), `RunEvent`/window-event handling if required for show/hide/quit, optional single-instance
- `src-tauri/tauri.conf.json` (+ platform variants) — only if tray/icon config keys are needed
- `src-tauri/icons/` or `assets/brand/` — add a monochrome/template tray icon for macOS (e.g. `tray-icon-macos.png` / template) and reuse 32×32 for Linux/Windows
- Platform cfg-gating for mobile targets (tray code must not compile on Android/iOS)

### Non-goals
- No conversion of close-to-quit into minimize-to-tray (lifecycle change out of scope unless explicitly approved).
- No custom fake top bars / in-app tray UI.
- No overbuilt menu (no playback controls unless already architecturally useful).
- No desktop-specific hacks for Linux.