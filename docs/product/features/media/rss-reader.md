---
id: rss.feed_reader
title: Full-Text RSS Feed Reader
domain: media
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Native RSS/Atom feed subscriber with NewsBlur cloud sync, full-article readability extraction, offline caching, and unread tracking.
how_to: Open the RSS tab (Cmd+5). Paste any feed URL or import an OPML file. Read full articles stripped of web ads.
why: Modern social media algorithms feed doomscrolling; RSS provides a quiet, user-controlled information stream that can be triaged incrementally.
aliases:
  - rss reader
  - atom feeds
  - newsblur
  - opml import
  - feed aggregator
settings:
  - rss.refreshIntervalMinutes
  - rss.autoFetchFullText
actions:
  - id: action.media.rss
    label: Open RSS Reader
    shortcut: Alt+5
related:
  - rss.queue_integration
  - rss.semantic_learning
  - reader.html.article
---

# Full-Text RSS Feed Reader

## Purpose
Provides a native, distraction-free RSS/Atom news and blog aggregator integrated with Plethora's incremental reading engine.

## User-Facing Behavior
- Multi-feed subscription list with unread badges, folder categorization, and star favorites.
- Automatically fetches and cleans full-text article content even for truncated RSS summaries.
- Fast keyboard shortcuts: `j`/`k` (next/prev article), `m` (mark read), `s` (star), `o` (open original).

## Exact Behavioral Rules
1. Uses Rust `rss.rs` parser to poll feeds concurrently in the background.
2. Supports NewsBlur cloud account synchronization for cross-device unread state.
3. In-line text selections allow 1-click extract creation directly into your reading queue.

## Rationale
Turns passive news consumption into an active learning pipeline where high-value industry insights are captured into permanent knowledge.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `rss.autoFetchFullText` | `true` | Automatically extract full article text using Readability |

## Platform Behavior
- **All Platforms**: Background feed updates with offline article caching.
