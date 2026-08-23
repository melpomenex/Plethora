---
title: "PDF Page Mode Reading"
description: "Discrete page-by-page PDF viewing with fit-to-width, fit-to-page, two-page spread, and zoom scaling."
category: "read-and-listen"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["pdf reader","page view","two page spread","pdf zoom"]
aliases: ["pdf reader","page view","two page spread","pdf zoom"]
relatedDocs: ["reader.pdf.scroll_mode","reader.pdf.reflow","reader.position.restore"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/reading/pdf-page-mode.md"
---
# PDF Page Mode Reading

## Purpose
Provides a high-performance, pixel-accurate discrete page-turning PDF reading experience supporting academic papers, scanned books, and slide decks.

## User-Facing Behavior
- Renders one or two pages side-by-side using high-DPI canvas rendering.
- Displays zoom controls (25% to 500%, Fit Width, Fit Page).
- Supports keyboard navigation (Left/Right arrows, `j`/`k` in Vim mode, Space / Shift+Space).
- Shows page indicator (e.g., "Page 42 of 280") allowing direct numerical jump.

## Exact Behavioral Rules
1. When opening a PDF, restores the user's last saved page and zoom settings from the position database.
2. Two-page spread mode automatically falls back to single-page on viewports narrower than 900px.
3. Text selection triggers the anchored Selection Action Bar for extracts and flashcard creation.

## Rationale
Paginated reading allows precise citation tracking and mimics the physical book experience, which improves spatial recall of facts and annotations.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `viewer.pdf.zoomMode` | `"fit-width"` | Default zoom mode for new PDF tabs |
| `viewer.pdf.spreadMode` | `"auto"` | Single page or two-page spread based on window width |

## Platform Behavior
- **Desktop (macOS/Win/Linux)**: Hardware-accelerated canvas rendering with smooth pinch-to-zoom trackpad support.
- **Android / Mobile**: Touch swipe gestures for page turning and double-tap to zoom.
- **E-ink**: High-contrast pure black-and-white rendering with zero transition animation.

## Failure Modes & Troubleshooting
- **Symptom**: Blurry text when zooming in.
  - **Resolution**: Adjust zoom scale in toolbar; PDF.js re-renders canvas at device pixel ratio on settle.