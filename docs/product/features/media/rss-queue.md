---
id: rss.queue_integration
title: RSS in Reading Queue
domain: media
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Automatically feeds unread RSS articles into the composed reading queue based on composition sliders and age filters.
how_to: Open Settings → Reading Queue → Composition Sliders and set the RSS slider > 0%. Unread feed items will appear during queue sessions.
why: Reading RSS feeds in a dedicated inbox leads to overwhelming unread counts; mixing articles into the queue ensures steady incremental processing without inbox anxiety.
aliases:
  - rss queue
  - feed interleaving
  - news in queue
  - incremental rss
settings:
  - rssQueue.maxArticlesPerSession
  - rssQueue.maxArticleAgeDays
actions:
  - id: settings.queue.composition
    label: Configure RSS Queue Mix
    shortcut: Alt+,
related:
  - rss.feed_reader
  - queue.composition
  - queue.scroll_session
---

# RSS in Reading Queue

## Purpose
Seamlessly interleaves unread RSS news and blog articles into the daily incremental reading queue session.

## User-Facing Behavior
- While reading in the Composed Scroll Queue, unread RSS articles appear interspersed between book extracts and cards.
- Reading an article automatically marks it as read in your RSS subscription list.
- Creating an extract from an RSS item schedules it into your knowledge base before moving to the next item.

## Exact Behavioral Rules
1. Samples unread articles adhering to the target percentage defined in `scrollQueue.composition.rss`.
2. Prioritizes articles from starred feeds or high semantic preference scores.
3. Automatically skips articles older than `maxArticleAgeDays` to prevent processing stale news.

## Rationale
Adopts the SuperMemo principle of processing all information streams through a single unified priority queue.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `rssQueue.maxArticleAgeDays` | `14` | Maximum age of unread RSS articles queued for reading |

## Platform Behavior
- **All Platforms**: Real-time synchronization between RSS unread state and queue sampler.
