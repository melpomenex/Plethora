---
title: "PDF Scroll Mode Reading"
description: "Continuous vertical scrolling PDF reader with virtualized rendering and smooth scroll physics."
category: "read-and-listen"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["continuous pdf","vertical scroll pdf","infinite scroll pdf"]
aliases: ["continuous pdf","vertical scroll pdf","infinite scroll pdf"]
relatedDocs: ["reader.pdf.page_mode","reader.pdf.reflow","reader.position.restore"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/reading/pdf-scroll-mode.md"
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