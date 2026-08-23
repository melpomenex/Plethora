---
title: "Semantic Preference Learning"
description: "On-device Bayesian and vector preference classifiers learning from liked/disliked articles to surface high-value feeds and filter noise."
category: "rss-and-podcasts"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["feed filtering","smart rss","article recommendation","preference classifier"]
aliases: ["feed filtering","smart rss","article recommendation","preference classifier"]
relatedDocs: ["rss.feed_reader","rss.queue_integration","queue.neural_queue"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/media/semantic-preferences.md"
---
# Semantic Preference Learning

## Purpose
Filters and ranks incoming RSS articles using on-device machine learning classifiers trained exclusively on your personal reading interactions.

## User-Facing Behavior
- Adds a subtle "Relevance Score" (e.g. `92% Match`) to incoming feed articles.
- High-relevance articles are promoted to the top of the RSS feed and scheduled into the reading queue first.
- Low-relevance articles can be automatically hidden or collapsed.

## Exact Behavioral Rules
1. Trains on-device Naive Bayes and embedding centroid models on articles you extract, star, or dismiss.
2. Training and classification occur 100% locally in Rust (`rss_preferences.rs`) with zero cloud telemetry.
3. Users can inspect top positive and negative predictive keyword weights in Settings.

## Rationale
Restores the dream of the personalized newspaper: high-signal curation tailored to your exact intellectual curiosities without algorithmic rage-bait.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `rss.preferenceLearningEnabled` | `true` | Train on-device preference classifiers on article ratings |

## Platform Behavior
- **All Platforms**: Fast on-device classification during background feed sync.