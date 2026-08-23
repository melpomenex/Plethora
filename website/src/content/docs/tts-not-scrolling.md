---
title: "Troubleshooting: TTS Playback Not Auto-Scrolling Viewport"
description: "Step-by-step diagnostic and recovery guide for when TTS audio plays but the reader viewport does not scroll automatically."
category: "start-here"
order: 100
published: true
featureStatus: "shipping"
platforms: ["all"]
keywords: ["tts stuck","auto scroll broken","tts not moving","reader not following audio"]
aliases: ["tts stuck","auto scroll broken","tts not moving","reader not following audio"]
relatedDocs: ["tts.auto_scroll","tts.word_highlighting","tts.playback"]
owner: "E"
claimIds: []
sourcePath: "docs/product/troubleshooting/tts-not-scrolling.md"
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