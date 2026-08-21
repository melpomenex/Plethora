---
id: audio.media_controls
title: OS Media Key / Headphone Sync
domain: tts
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Native OS integration via Souvlaki (macOS Now Playing, Windows SMTC, Linux MPRIS, Android Media3) for system media keys and lock screen controls.
how_to: Use physical keyboard media keys (Play/Pause, Prev, Next) or Bluetooth headphone buttons to control playback from anywhere in the OS.
why: Learners listen in the background while coding, writing, or walking; native media control integration allows instant playback control without focusing Plethora.
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
1. Uses Rust `souvlaki` crate on desktop and Android `Media3 MediaSessionService` on mobile.
2. Updates OS metadata (playback state, position, duration, speed) continuously during speech.
3. Automatically pauses on system audio interruptions (incoming phone calls, Siri/Assistant activation).

## Rationale
Enables first-class desktop and mobile OS integration, making Plethora feel like a native system media player.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `media.enableOsMediaControls` | `true` | Register system media transport controls |

## Platform Behavior
- **macOS**: Full MPNowPlayingInfoCenter integration.
- **Windows**: Windows.Media.Playback SMTC bridge.
- **Linux**: org.mpris.MediaPlayer2 D-Bus service.
- **Android**: Foreground service with ongoing media notification.
