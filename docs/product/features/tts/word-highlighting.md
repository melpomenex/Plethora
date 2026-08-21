---
id: tts.word_highlighting
title: TTS Word Highlighting
domain: tts
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Synchronizes real-time text highlight with spoken audio words across PDF, EPUB, HTML, and Markdown readers.
how_to: Open any document, click the TTS Play button in the reader header or press Alt+P. Highlighting follows active speech automatically.
why: Word-level highlighting creates dual-coding cognitive reinforcement, maintaining visual focus and preventing eye fatigue during high-speed listening.
aliases:
  - audio karaoke
  - read aloud highlight
  - follow speech
  - spoken word tracking
settings:
  - tts.highlightSpokenWord
  - tts.followSpokenWord
actions:
  - id: settings.tts.highlighting
    label: Configure TTS Highlighting
    shortcut: Alt+,
related:
  - tts.playback
  - tts.auto_scroll
  - tts.resume_position
---

# TTS Word Highlighting

## Purpose
Provides word-level and sentence-level visual synchronization with synthesized audio playback across all supported document formats.

## User-Facing Behavior
- Highlights the currently spoken word with a crisp colored bounding box or background fill.
- Applies subtle sentence-level shading to provide surrounding reading context.
- Clicking any word during playback immediately jumps audio synthesis to that position.

## Exact Behavioral Rules
1. Uses word timestamp metadata emitted by the TTS engine (Pocket TTS, Kokoro, Sherpa-ONNX).
2. For engines without native word alignments, calculates proportional character-duration offsets.
3. Automatically transitions highlight across page boundaries in PDF and EPUB readers.

## Rationale
Dual-modal reading (simultaneously seeing and hearing words) enhances focus, reduces mind-wandering, and significantly boosts reading comprehension.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `tts.highlightSpokenWord` | `true` | Toggles real-time word highlighting |

## Platform Behavior
- **All Platforms**: Smooth CSS animations; automatically disabled in E-ink mode to eliminate display flicker.
