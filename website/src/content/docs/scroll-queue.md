---
title: "Composed Scroll Queue"
description: "Continuous vertical scroll session interleaving full documents, extracts, flashcards, RSS articles, and podcasts per composition sliders."
category: "understand-and-extract"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["tiktok queue","infinite reading queue","optimal session","mixed reading feed"]
aliases: ["tiktok queue","infinite reading queue","optimal session","mixed reading feed"]
relatedDocs: ["queue.composition","queue.priority_score","queue.extract_chain"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/queue/scroll-queue.md"
---
# Composed Scroll Queue

## Purpose
Unifies incremental reading and spaced repetition flashcard review into a seamless, high-velocity vertical scroll feed.

## User-Facing Behavior
- Displays a continuous stream of learning items (PDF reflow passages, web extracts, flashcards, podcast snippets).
- Smooth vertical scrolling with keyboard shortcuts (Space / Shift+Space, `j`/`k`).
- Interactive widgets embedded directly in the stream: rate flashcard difficulty, create extracts, or adjust priority.

## Exact Behavioral Rules
1. Samples upcoming items dynamically from the queue using priority weights and composition ratios.
2. When an item is read or graded, updates its scheduling parameters in real time and schedules the next reappearance date.
3. Automatically saves reading position within lengthy extracts so partial reads are never lost.

## Rationale
Reduces decision fatigue ("What should I study next?") by algorithmically serving the highest-utility learning item at every moment.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scrollQueue.autoAdvance` | `true` | Advance automatically after card rating |

## Platform Behavior
- **Desktop**: Fast keyboard navigation with full widescreen layout.
- **Mobile**: Touch-optimized swipe gestures.
- **E-ink**: Paginated step scrolling mode to prevent screen tearing.