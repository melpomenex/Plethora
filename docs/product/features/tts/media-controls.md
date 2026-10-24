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
- **Windows**: The desktop bridge now supplies the main window handle and owns its COM objects on one initialized worker thread. Packaged Windows compilation and physical SMTC verification remain pending; use in-app controls if the adapter reports an error.
- **Android**: Media3 session, ongoing notification, lock-screen/headset command queue, focus handling, and background lifecycle are implemented; physical lock-screen, car, watch, and Bluetooth verification remains pending.
- **iOS**: Conditional only. The shared contract includes an iOS source kind, but this target has no verified native adapter in the current build and therefore makes no native-control support claim.

## Persistent playback rollout

The application-owned persistent player is under development and its production rollout is disabled. Existing source players remain active in normal builds. The development path keeps ordinary playback above navigation, uses one service-owned Android decoder, and restores a cold session paused. Closing the expanded controls only collapses them; Stop saves progress and releases playback. A failed save retains an inline error and requires a successful retry before closing or switching accounts.

Prepared queue items advance under the owner, with chapter navigation separate from queue skips. Sleep takes precedence over continuation. Android stops at an unprepared boundary rather than relying on suspended JavaScript to synthesize or replay transport commands. Session intent and queue identities are local to the current profile. Full Listen Later synthesis, Study Mode, transcript/learning/DSP parity, complete-app continuity, memory/performance measurements and physical platform acceptance remain rollout requirements.

Paused desktop controls remain attached until the playback owner explicitly closes the session; they do not require periodic metadata updates to stay alive. Adapter failures leave the in-app transport available and are reported by the development player.
