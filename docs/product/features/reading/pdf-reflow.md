---
id: reader.pdf.reflow
title: PDF Reflow Engine
domain: reading
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Extracts multi-column academic PDF text and figures into responsive, customizable typography.
how_to: Open a PDF document and click the Reflow button in the top toolbar or press Alt+R.
why: Academic two-column PDFs are unreadable on small screens or high-zoom monitors; reflow extracts structured text and figures into clean, responsive typography.
aliases:
  - reflow pdf
  - responsive pdf
  - clean text pdf
  - de-column pdf
settings:
  - viewer.reflow.fontSize
  - viewer.reflow.fontFamily
  - viewer.reflow.lineHeight
actions:
  - id: action.reader.toggle_reflow
    label: Toggle PDF Reflow
    shortcut: Alt+R
related:
  - reader.pdf.page_mode
  - reader.pdf.scroll_mode
  - reader.selection.actions
---

# PDF Reflow Engine

## Purpose
Converts fixed multi-column, header-heavy PDF documents into responsive HTML-like text with custom fonts, colors, and line spacing.

## User-Facing Behavior
- Strips running headers, footers, and page numbers.
- Unrolls multi-column academic paper layouts into a single coherent reading column.
- Retains embedded mathematical formulas, code listings, and high-resolution figures.
- Allows full font size, line height, and margin customization.

## Exact Behavioral Rules
1. Uses the Rust backend `pdf_reflow.rs` with spatial geometric heuristics to reconstruct reading order.
2. High-resolution figure extracts are detected and rendered inline with caption text.
3. Highlighting and extract creation map back to original PDF bounding boxes for provenance.

## Rationale
Eliminates horizontal panning on small displays and allows users with visual impairments or e-ink screens to customize typography freely.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `viewer.reflow.fontSize` | `18` | Base font size in pixels for reflowed text |
| `viewer.reflow.lineHeight` | `1.6` | Line height multiplier |

## Platform Behavior
- **Mobile & Android**: Essential for reading arXiv papers on handheld screens without lateral zoom.
- **E-ink**: Applies high-contrast typography with crisp font rasterization.
