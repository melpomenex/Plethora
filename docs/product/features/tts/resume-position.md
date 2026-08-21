---
id: tts.resume_position
title: TTS Position Persistence
domain: tts
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Resumes audio playback exactly at the last spoken sentence rather than restarting from the beginning of the document or chapter.
how_to: Pause TTS playback or close the app. When you return and click Play, TTS resumes from the exact sentence where you left off.
why: Re-listening to previously heard passages wastes valuable study time; sentence-exact persistence makes listening friction-free across sessions.
aliases:
  - tts resume
  - audio bookmark
  - remember spoken position
  - speech restore
settings:
  - tts.resumePosition
actions:
  - id: action.reader.toggle_tts
    label: Resume TTS Playback
    shortcut: Alt+P
related:
  - tts.playback
  - reader.position.restore
  - tts.word_highlighting
---

# TTS Position Persistence

## Purpose
Guarantees sentence-exact audio playback resumption across all document formats without restarting from the top of the chapter.

## User-Facing Behavior
- Resuming TTS instantly highlights the exact sentence where audio was paused and begins speaking.
- Remembers audio position across tab switches, application restarts, and cross-device sync.
- Shows total audio time elapsed and remaining estimated audio duration.

## Exact Behavioral Rules
1. Records `lastSpokenSentenceIndex` and `lastSpokenCharOffset` in the SQLite position store upon pause or tab change.
2. Synchronizes position across desktop and mobile via delta logs.
3. Automatically pre-buffers the resumed sentence so audio playback begins with <50ms latency.

## Rationale
Supports interrupted, multi-tasking lifestyles where users study in 5-10 minute audio increments throughout the day.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `tts.resumePosition` | `true` | Save and restore exact spoken sentence position |

## Platform Behavior
- **All Platforms**: Position persisted locally and resilient against unexpected app termination.
