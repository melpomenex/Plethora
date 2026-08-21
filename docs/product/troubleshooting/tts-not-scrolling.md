---
id: troubleshooting.tts_not_scrolling
title: Troubleshooting: TTS Playback Not Auto-Scrolling Viewport
domain: troubleshooting
status: implemented
platforms:
  - all
summary: Step-by-step diagnostic and recovery guide for when TTS audio plays but the reader viewport does not scroll automatically.
how_to: Follow the recovery checklist below: verify followSpokenWord setting, check manual scroll lock timer, or switch TTS engine.
why: TTS auto-scrolling can be temporarily suspended by manual user touch interactions, legacy audio engines without word timestamps, or zoom overflow.
aliases:
  - tts stuck
  - auto scroll broken
  - tts not moving
  - reader not following audio
settings:
  - tts.followSpokenWord
actions:
  - id: settings.tts.highlighting
    label: Open TTS Settings
    shortcut: Alt+,
related:
  - tts.auto_scroll
  - tts.word_highlighting
  - tts.playback
---

# Troubleshooting: TTS Playback Not Auto-Scrolling Viewport

## Purpose
Provides an immediate recovery recipe when speech audio plays correctly but the document view does not scroll down with the narrator.

## User-Facing Behavior
- **Symptom**: Speech plays from speakers/headphones, but the text remains static on screen.
- **Cause 1**: The `tts.followSpokenWord` setting is disabled in Settings → TTS.
- **Cause 2**: You recently scrolled with mouse wheel or touch; auto-scroll is temporarily paused for 5 seconds to prevent fighting user input.
- **Cause 3**: Selected TTS cloud engine does not emit word timestamp alignments.

## Exact Behavioral Rules
1. Check that "Auto-Scroll with Speech" is toggled ON in reader header or Settings → TTS.
2. Allow 5 seconds of untouched reading time for manual scroll override lock to expire.
3. Switch TTS engine to Pocket TTS or Sherpa-ONNX to ensure high-resolution timestamp metadata.

## Rationale
Understanding the automatic suspension rules prevents confusion when user scrolling temporarily takes priority over automated view tracking.

## Platform Behavior
- E-ink devices use discrete paging instead of continuous smooth scrolling.
