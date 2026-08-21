---
id: platform.desktop_native
title: Desktop Native Window & Tray
domain: platform
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
summary: Native OS window state restoration, system tray icon with quick-study shortcuts, multi-window split panes, and global hotkeys.
how_to: Use standard desktop shortcuts (Cmd+T new tab, Cmd+W close, Cmd+\ split pane). Minimize to system tray or click tray icon for quick actions.
why: Power users require window position restoration, multi-pane side-by-side reading, and global hotkey access without browser sandbox limitations.
aliases:
  - system tray
  - window state
  - multi window
  - split panes
  - desktop app
settings:
  - window.minimizeToTray
  - window.rememberSizeAndPosition
actions:
  - id: action.search.command_center
    label: Open Command Palette
    shortcut: Cmd+K
related:
  - palette.command_center
  - platform.battery_saver
  - settings.themes
---

# Desktop Native Window & Tray

## Purpose
Leverages native desktop operating system capabilities through Tauri 2.0 Rust bindings to deliver a fast, multi-pane desktop learning workstation.

## User-Facing Behavior
- Remembers exact window dimensions, multi-monitor display positions, and split pane layouts across restarts.
- System Tray icon (macOS Menu Bar / Windows Taskbar / Linux Status Bar) with quick actions:
  - "Start Review Session"
  - "Continue Reading [Active Book]"
  - "Paste Web Clip from Clipboard"
- Global keyboard hotkeys triggerable from any application.

## Exact Behavioral Rules
1. Uses `tauri-plugin-window-state` to persist window coordinates in SQLite.
2. Supports horizontal and vertical split panes (e.g. PDF viewer on the left, Flashcard Studio on the right).
3. Closes or hides gracefully to tray based on user preference.

## Rationale
Knowledge work is multitasking work. True desktop integration gives learners full screen real estate and zero-latency keyboard control.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `window.rememberSizeAndPosition` | `true` | Restore exact window coordinates on launch |
| `window.minimizeToTray` | `false` | Keep running in background tray when closed |

## Platform Behavior
- **macOS**: Native vibrancy backdrops, dock badge counter, and menu bar extras.
- **Windows**: Windows 11 Mica/Acrylic materials and taskbar jump lists.
- **Linux**: AppImage and native DEB packaging supporting Wayland and X11.
