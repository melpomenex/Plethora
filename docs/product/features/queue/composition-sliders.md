---
id: queue.composition
title: Queue Composition Sliders
domain: queue
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Configurable percentage distribution balancing documents, extracts, flashcards, RSS articles, and podcasts in your reading queue.
how_to: Open Settings → Reading Queue → Composition Sliders. Adjust the percentage sliders to match your preferred study balance.
why: Different study sessions demand different balances—heavy textbook deep reading versus rapid flashcard drilling; sliders allow precise workload tailoring.
aliases:
  - queue mix
  - content balance
  - study ratios
  - item distribution
settings:
  - scrollQueue.composition.documents
  - scrollQueue.composition.extracts
  - scrollQueue.composition.cards
  - scrollQueue.composition.rss
actions:
  - id: settings.queue.composition
    label: Open Queue Composition
    shortcut: Alt+,
related:
  - queue.scroll_session
  - queue.priority_score
  - rss.queue_integration
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
