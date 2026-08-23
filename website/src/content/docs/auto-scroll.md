---
title: "TTS Viewport Auto-Scroll"
description: "Automatically scrolls the reader viewport to keep the active spoken sentence centered without visual jitter or sudden jumps."
category: "start-here"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["tts scroll","auto scroll speech","follow audio","keep speech in view"]
aliases: ["tts scroll","auto scroll speech","follow audio","keep speech in view"]
relatedDocs: ["tts.playback","tts.word_highlighting","reader.pdf.scroll_mode"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/tts/auto-scroll.md"
---
# TTS Viewport Auto-Scroll

## Purpose
Keeps the reader viewport aligned with the active TTS audio playback stream, enabling completely hands-free reading.

## User-Facing Behavior
- Smoothly scrolls the document container to keep the active spoken paragraph within the vertical center zone (20% - 70% viewport height).
- User manual scrolling temporarily suspends auto-scrolling for 5 seconds before resuming smoothly.
- Automatically turns to the next page in paginated PDF and EPUB viewers.

## Exact Behavioral Rules
1. Calculates target scroll delta using `SafeScrollContainer.tsx` with smooth requestAnimationFrame interpolation.
2. Checks user touch/wheel interaction flags to prevent "fighting" user manual scroll inputs.
3. Automatically pauses if the user reaches the end of the document.

## Rationale
Eliminates mechanical interaction requirements during audio-assisted reading sessions.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `tts.followSpokenWord` | `true` | Enable automated viewport scroll tracking |
| `tts.autoScrollMarginPercent` | `30` | Top/bottom viewport margin threshold triggering scroll |

## Platform Behavior
- **Desktop & Mobile**: Hardware-accelerated smooth scrolling.
- **E-ink**: Switches from smooth continuous scroll to discrete step-paging to eliminate E-ink ghosting.