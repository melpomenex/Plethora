---
id: reader.pdf.scroll_mode
title: PDF Scroll Mode Reading
domain: reading
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Continuous vertical scrolling PDF reader with virtualized rendering and smooth scroll physics.
how_to: Open any PDF and select continuous scroll mode from the reader header toolbar or press Alt+S.
why: Continuous vertical scrolling provides an unbroken reading flow similar to web articles, optimizing speed reading and seamless extract selection across page boundaries.
aliases:
  - continuous pdf
  - vertical scroll pdf
  - infinite scroll pdf
settings:
  - viewer.pdf.scrollPhysics
actions:
  - id: action.reader.toggle_reflow
    label: Switch to PDF Reflow
    shortcut: Alt+R
related:
  - reader.pdf.page_mode
  - reader.pdf.reflow
  - reader.position.restore
---

# PDF Scroll Mode Reading

## Purpose
Enables a seamless vertical reading flow for multi-page PDF documents without interruption at page boundaries.

## User-Facing Behavior
- Vertically stacks PDF pages with a subtle separator line.
- Dynamically renders visible pages in the viewport while recycling off-screen canvas buffers.
- Maintains continuous scroll position and smoothly tracks reading progress percentage.

## Exact Behavioral Rules
1. Uses virtualized DOM list rendering to maintain stable 60 FPS even on 1,000+ page documents.
2. Cross-page text selections are supported across consecutive page boundaries.
3. Automatically computes current page number based on the page occupying the viewport center.

## Rationale
Page breaks in digital reading often disrupt cognitive comprehension flow. Continuous scrolling removes the friction of manual page-turning during speed reading.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `viewer.pdf.scrollPhysics` | `"smooth"` | Scroll easing and momentum physics |

## Platform Behavior
- **Desktop**: Mouse wheel and precision trackpad scrolling with momentum.
- **Android**: Inertial touch fling scrolling with velocity clamping.
- **E-ink**: Switched to pagination or fixed tap-scroll steps to eliminate LCD ghosting.
