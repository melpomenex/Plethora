---
id: review.zen_mode
title: Zen Fullscreen Review
domain: review
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Minimalist fullscreen distraction-free card review hiding sidebars, toolbars, and system clocks with subtle hover provenance peek.
how_to: In Review Session, press F11 or click the Zen icon in the top right. All UI chrome fades away.
why: Deep memory consolidation requires intense focus; eliminating visual clutter prevents attention drift and reduces review fatigue.
aliases:
  - zen mode
  - fullscreen review
  - distraction free review
  - focus mode
settings:
  - review.zen.hideTimer
  - review.zen.fontSizeMultiplier
actions:
  - id: action.review.zen
    label: Enter Zen Review Mode
    shortcut: F11
related:
  - review.flashcard_studio
  - review.source_provenance
  - platform.eink
---

# Zen Fullscreen Review

## Purpose
Provides a serene, distraction-free environment for rapid flashcard recall with all non-essential UI chrome hidden.

## User-Facing Behavior
- Hides application tabs, status bars, sidebars, and desktop window borders.
- Centers the active card in high-contrast, beautiful typography.
- Displays minimal progress indicator (e.g. subtle thin line or small dot counter).
- Hovering near the bottom reveals source document context.

## Exact Behavioral Rules
1. Keystrokes (`Space` to flip, `1-4` to rate) remain fully active.
2. Pressing `Escape` or `F11` instantly restores standard windowed mode.
3. Automatically suppresses desktop notifications while in Zen mode.

## Rationale
Cognitive psychology demonstrates that visual clutter drains executive control. Zen mode maximizes mental immersion in the study material.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `review.zen.hideTimer` | `true` | Hide elapsed time counter to eliminate time anxiety |

## Platform Behavior
- **Desktop**: True native OS fullscreen window takeover.
- **Mobile**: Immersive fullscreen hiding Android status and navigation bars.
