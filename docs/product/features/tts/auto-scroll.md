---
id: tts.auto_scroll
title: TTS Viewport Auto-Scroll
domain: tts
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Automatically scrolls the reader viewport to keep the active spoken sentence centered without visual jitter or sudden jumps.
how_to: Start TTS playback. As speech advances past the bottom of the screen, the viewport scrolls smoothly to maintain center focus.
why: Manually scrolling a document while listening to high-speed audio narration breaks focus and causes accidental position loss.
aliases:
  - tts scroll
  - auto scroll speech
  - follow audio
  - keep speech in view
settings:
  - tts.followSpokenWord
  - tts.autoScrollMarginPercent
actions:
  - id: settings.tts.highlighting
    label: Configure Auto-Scroll Settings
    shortcut: Alt+,
related:
  - tts.playback
  - tts.word_highlighting
  - reader.pdf.scroll_mode
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
