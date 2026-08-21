---
id: audio.media_controls
title: OS Media Key / Headphone Sync
domain: tts
status: partial
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Shared native-media integration for macOS/Linux desktop controls and Android Media3 lock-screen controls, with Windows and iOS capability limits documented explicitly.
how_to: Use physical keyboard media keys (Play/Pause, Prev, Next) or Bluetooth headphone buttons to control playback from anywhere in the OS.
why: Learners listen in the background while coding, writing, or walking; a single source-aware media contract keeps OS commands, reading position, and playback metadata synchronized without allowing stale sources to take control.
aliases:
  - media keys
  - now playing
  - souvlaki
  - lock screen controls
  - bluetooth headset
settings:
  - media.enableOsMediaControls
actions:
  - id: settings.audio.hands_free
    label: Open Media Settings
    shortcut: Alt+,
related:
  - tts.playback
  - audio.hands_free_study
  - review.audio_review
---

# OS Media Key / Headphone Sync

## Purpose
Integrates Plethora audio playback with native operating system media controllers, lock screens, and hardware Bluetooth headphone remotes.

## User-Facing Behavior
- Displays document title, cover art, author, and interactive scrubber in:
  - macOS Control Center & Touch Bar / Lock Screen Now Playing widget.
  - Windows 10/11 System Media Transport Controls (SMTC) overlay.
  - Linux desktop MPRIS D-Bus interfaces.
  - Android lock-screen notification and Wear OS media tile.
- Physical Play/Pause, Next Track, Previous Track, and Seek buttons control Plethora directly.

## Exact Behavioral Rules
1. Uses the Rust `souvlaki` bridge on desktop and one Android `Media3 MediaSessionService` foreground owner on mobile.
2. Routes play/pause, next/previous, relative seek, and absolute seek through the shared source/session-aware dispatcher.
3. Publishes metadata, artwork, section identity, duration, playback rate, and truthful seek capabilities; stale source snapshots and queued commands are ignored or discarded.
4. Audio focus pauses, ducks, or restores playback according to interruption type, but never auto-resumes playback that the user had already paused.

## Rationale
Enables first-class desktop and mobile OS integration, making Plethora feel like a native system media player.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `media.enableOsMediaControls` | `true` | Register system media transport controls |

## Platform Behavior
- **macOS**: Souvlaki Now Playing metadata and hardware-control bridge; manual device regression remains pending.
- **Linux**: Souvlaki/MPRIS metadata and hardware-control bridge; manual desktop regression remains pending.
- **Windows**: In-app and shared-dispatcher behavior is supported, but the current Tauri platform configuration does not provide the native window handle required to claim full SMTC wiring. In-app playback remains the fallback until HWND plumbing is added.
- **Android**: Media3 session, ongoing notification, lock-screen/headset command queue, focus handling, and background lifecycle are implemented; physical lock-screen, car, watch, and Bluetooth verification remains pending.
- **iOS**: Conditional only. The shared contract includes an iOS source kind, but this target has no verified native adapter in the current build and therefore makes no native-control support claim.
