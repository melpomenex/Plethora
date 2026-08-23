---
title: "TTS Word Highlighting"
description: "Synchronizes real-time text highlight with spoken audio words across PDF, EPUB, HTML, and Markdown readers."
category: "start-here"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["audio karaoke","read aloud highlight","follow speech","spoken word tracking"]
aliases: ["audio karaoke","read aloud highlight","follow speech","spoken word tracking"]
relatedDocs: ["tts.playback","tts.auto_scroll","tts.resume_position"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/tts/word-highlighting.md"
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