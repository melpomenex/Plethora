---
title: "RSS in Reading Queue"
description: "Automatically feeds unread RSS articles into the composed reading queue based on composition sliders and age filters."
category: "rss-and-podcasts"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["rss queue","feed interleaving","news in queue","incremental rss"]
aliases: ["rss queue","feed interleaving","news in queue","incremental rss"]
relatedDocs: ["rss.feed_reader","queue.composition","queue.scroll_session"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/media/rss-queue.md"
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
Adopts the core incremental reading principle of processing all information streams through a single unified priority queue.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `rssQueue.maxArticleAgeDays` | `14` | Maximum age of unread RSS articles queued for reading |

## Platform Behavior
- **All Platforms**: Real-time synchronization between RSS unread state and queue sampler.