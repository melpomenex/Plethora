---
title: "Full-Text RSS Feed Reader"
description: "Native RSS/Atom feed subscriber with NewsBlur cloud sync, full-article readability extraction, offline caching, and unread tracking."
category: "rss-and-podcasts"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["rss reader","atom feeds","newsblur","opml import","feed aggregator"]
aliases: ["rss reader","atom feeds","newsblur","opml import","feed aggregator"]
relatedDocs: ["rss.queue_integration","rss.semantic_learning","reader.html.article"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/media/rss-reader.md"
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