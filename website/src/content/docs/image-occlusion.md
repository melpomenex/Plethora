---
title: "OCR Image Occlusion Editor"
description: "Visual diagram masking editor with automated OCR text detection, bounding-box masks, and hide-one / reveal-all testing modes."
category: "remember-and-review"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["image occlusion","diagram mask","ocr occlusion","anatomy flashcards"]
aliases: ["image occlusion","diagram mask","ocr occlusion","anatomy flashcards"]
relatedDocs: ["review.flashcard_studio","review.source_provenance","review.zen_mode"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/review/image-occlusion.md"
---
# OCR Image Occlusion Editor

## Purpose
Enables one-click generation of visual spaced repetition cards by placing interactive masks over text labels, diagrams, and formulas within images.

## User-Facing Behavior
- Canvas drawing workspace to place, resize, and color-code mask boxes over anatomy/schematics.
- "Auto-Detect Text" button uses local Tesseract OCR to automatically place bounding boxes around all diagram labels.
- Supports two study modes:
  - **Hide One, Reveal All**: One mask is highlighted as the question; all other masks are revealed as context.
  - **Hide All, Reveal One**: All labels remain hidden; clicking reveals only the active target label.

## Exact Behavioral Rules
1. Generates discrete card instances for each active occlusion box, sharing the underlying base image asset.
2. Occlusion coordinate data is saved as percentage vectors (`x, y, width, height`) to remain pixel-accurate across screen sizes.
3. Review ratings update the specific occlusion box's spaced repetition interval independently.

## Rationale
Testing knowledge within its natural spatial context provides rich visual mnemonics while eliminating the labor of cropping dozens of individual images.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `occlusion.defaultMode` | `"hide-one-reveal-all"` | Default occlusion testing paradigm |

## Platform Behavior
- **Desktop**: Precision mouse dragging and multi-box grouping.
- **Android / Mobile**: Pinch-to-zoom canvas and tap-to-select box manipulation.