---
title: "Queue Composition Sliders"
description: "Configurable percentage distribution balancing documents, extracts, flashcards, RSS articles, and podcasts in your reading queue."
category: "understand-and-extract"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["queue mix","content balance","study ratios","item distribution"]
aliases: ["queue mix","content balance","study ratios","item distribution"]
relatedDocs: ["queue.scroll_session","queue.priority_score","rss.queue_integration"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/queue/composition-sliders.md"
---
# Queue Composition Sliders

## Purpose
Gives learners full control over the proportional mixture of content types served during incremental reading sessions.

## User-Facing Behavior
- Interactive multi-thumb percentage bar displaying ratios for:
  - **Full Documents** (Books, arXiv PDFs, web articles)
  - **Extracts** (Extracted quotes and intermediate notes)
  - **Flashcards** (Q&A, Cloze, Image Occlusion items)
  - **RSS Feeds** (Unread subscription articles)
  - **Podcasts** (Audio episodes with transcript sync)
- Live visual pie chart updating as sliders move.

## Exact Behavioral Rules
1. Slider values are constrained to sum to 100%.
2. The queue sampler uses weighted reservoir sampling to select items conforming to the target ratios.
3. If a category is empty (e.g., no pending RSS articles), its proportion is dynamically redistributed among available categories.

## Rationale
Prevents flashcard review debt from crowding out deep reading, and vice versa.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scrollQueue.composition.documents` | `25%` | Proportion of full documents |
| `scrollQueue.composition.extracts` | `35%` | Proportion of incremental extracts |
| `scrollQueue.composition.cards` | `30%` | Proportion of review flashcards |
| `scrollQueue.composition.rss` | `10%` | Proportion of RSS news items |

## Platform Behavior
- **All Platforms**: Real-time slider adjustments take effect immediately on next queued item.