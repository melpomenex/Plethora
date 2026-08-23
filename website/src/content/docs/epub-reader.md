---
title: "EPUB Reader & CFI Tracking"
description: "Reflowable EPUB book reader with Canonical Fragment Identifier (CFI) position persistence and audiobook sync."
category: "read-and-listen"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["epub reader","book reader","cfi tracking","epub position"]
aliases: ["epub reader","book reader","cfi tracking","epub position"]
relatedDocs: ["reader.position.restore","reader.selection.actions","audiobook.sync"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/reading/epub-reader.md"
---
# EPUB Reader & CFI Tracking

## Purpose
Provides a modern e-book reading environment for `.epub` files with exact structural position anchoring across devices.

## User-Facing Behavior
- Displays clean, reflowable chapters with customizable margins, typography, and color schemes.
- Table of Contents sidebar allows fast navigation across parts and sections.
- Embedded images, footnotes, and mathematical formulas render inline.
- Supports text selection for extracts, clozes, and dictionary lookups.

## Exact Behavioral Rules
1. Every page turn and scroll event calculates an EPUB Canonical Fragment Identifier (CFI) string.
2. The CFI is saved locally in SQLite and synced via delta logs.
3. Upon reopening the book, the reader navigates to the exact CFI anchor rather than estimating a percentage.

## Rationale
Unlike fixed-layout PDFs, EPUB pagination changes when font size or window dimensions change. CFI provides mathematical coordinate precision that survives typography adjustments.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `viewer.epub.fontSize` | `18` | Base reading font size in pixels |
| `viewer.epub.lineHeight` | `1.6` | Line spacing |

## Platform Behavior
- **Desktop**: Full multi-column spread and single-column centered layouts.
- **Mobile**: Tap screen edges to turn chapters or navigate sections.
- **E-ink**: Optimized black text on stark white background.