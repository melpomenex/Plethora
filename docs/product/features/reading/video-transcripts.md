---
id: reader.video.transcript
title: Video Transcript Karaoke
domain: reading
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Synchronized word-level transcript player for YouTube and local video lectures with one-click timestamped extracts.
how_to: Open a video lecture or import a YouTube URL. The transcript scrolls automatically as video plays; click any sentence to seek the video.
why: Video is linear and slow to consume; synchronized transcript reading allows 3x faster skimming with direct audio/video reinforcement on complex passages.
aliases:
  - video reader
  - youtube transcript
  - transcript sync
  - video karaoke
settings:
  - viewer.video.autoScroll
  - viewer.video.playbackRate
actions:
  - id: action.search.command_center
    label: Search Video Library
    shortcut: Cmd+K
related:
  - reader.selection.actions
  - reader.position.restore
  - podcast.whisper
---

# Video Transcript Karaoke

## Purpose
Transforms passive video watching into active, searchable incremental reading through synchronized interactive transcripts.

## User-Facing Behavior
- Plays embedded YouTube videos or local video files alongside an auto-scrolling transcript pane.
- Clicking any transcript paragraph or sentence seeks video playback directly to that timestamp.
- Spoken sentences are highlighted in real-time.
- Select text in the transcript to create extracts or flashcards linked to that video timestamp.

## Exact Behavioral Rules
1. Fetches official YouTube captions or Whisper-generated subtitles.
2. Binary-searches segment timestamps during playback to maintain active sentence focus.
3. Extracts created from video transcripts preserve start/end timestamp metadata for 1-click video review.

## Rationale
Reading text is cognitively faster than listening to speech, but hearing natural inflection helps comprehension of difficult concepts. Dual-mode transcript sync bridges both advantages.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `viewer.video.autoScroll` | `true` | Keep active transcript segment in view |
| `viewer.video.playbackRate` | `1.0` | Default video speed (0.5x - 3.0x) |

## Platform Behavior
- **Desktop**: Side-by-side video and transcript layout.
- **Mobile**: Stacks video player on top with scrolling transcript below.
