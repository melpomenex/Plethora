# Implementation Tasks

## 1. Tray icon + menu (Rust)
- [x] 1.1 Build a `TrayIconBuilder` in `setup()` (`src-tauri/src/lib.rs`) with the Plethora icon via `include_bytes!` + `tauri::image::Image::from_bytes` (reuse `apply_window_icons` pattern), cfg-gated so mobile targets don't compile tray code
- [x] 1.2 Build the tray menu with `muda`: Show/Open (show + focus main window), Hide/Show (where supported), Quit (terminates the app)
- [x] 1.3 Implement conventional click behavior (left-click show/focus; right-click menu on Windows/Linux; macOS menu-bar conventions)
- [x] 1.4 Add `RunEvent`/window-event handling only as needed for correct show/hide/quit; preserve close-to-quit lifecycle (no minimize-to-tray change)

## 2. Icon assets
- [x] 2.1 Add a macOS menu-bar template/monochrome tray icon (e.g. `tray-icon-macos.pdf`/template or a suitably designed monochrome PNG); reuse `icons/32x32.png` for Linux/Windows
- [x] 2.2 Verify HiDPI rendering (no blurry scaling)

## 3. Platform behavior
- [x] 3.1 Verify Linux/Ubuntu status-notifier behavior (libappindicator backend); document GNOME/KDE/COSMIC expectations
- [x] 3.2 Verify macOS menu-bar rendering + template handling
- [x] 3.3 Optional: single-instance handling (e.g. `tauri-plugin-single-instance`) so reopen focuses the existing window; otherwise document the limitation

## 4. Tests
- [x] 4.1 Icon appears where supported
- [x] 4.2 Show/Open focuses the window
- [x] 4.3 Quit through the tray terminates the app
- [x] 4.4 Window close still quits (no behavior change)
- [x] 4.5 Application restart + tray re-created correctly
- [x] 4.6 Platform-specific lifecycle behavior (Linux/macOS where testable)
- [x] 4.7 `cargo build`/`cargo test -p` for all desktop targets; confirm mobile targets still compile without tray code

## 5. Spec
- [x] 5.1 Confirm spec matches implementation