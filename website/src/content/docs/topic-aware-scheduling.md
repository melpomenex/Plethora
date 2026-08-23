---
title: "Topic-Aware Scheduling (TAS) Principles"
description: "Theoretical principles behind Topic-Aware Scheduling (TAS), preventing context switching penalties while preserving spaced repetition optimality."
category: "start-here"
order: 100
published: true
featureStatus: "shipping"
platforms: ["all"]
keywords: ["topic aware scheduling","tas","semantic scheduling","context clustering"]
aliases: ["topic aware scheduling","tas","semantic scheduling","context clustering"]
relatedDocs: ["queue.neural_queue","scheduler.load_balancing","queue.scroll_session"]
owner: "E"
claimIds: []
sourcePath: "docs/product/concepts/topic-aware-scheduling.md"
---
# Topic-Aware Scheduling (TAS) Principles

## Purpose
Explains the cognitive trade-offs between pure randomized spaced repetition interleaving and grouped topic study, and how TAS resolves the tension.

## User-Facing Behavior
- Balances spacing efficiency with mental context retention.
- Sequences articles and flashcards from the same book or research subject in contiguous mini-blocks.
- Automatically inserts topic transition markers between different knowledge areas.

## Exact Behavioral Rules
1. Uses semantic embeddings to compute inter-item affinity distance $D(A, B)$.
2. Formulates a constrained optimization problem balancing maximum retrievability loss against context switching penalties.
3. Overdue cards nearing the lapse threshold ($R < 0.85$) break through topic groupings to protect retention.

## Rationale
Cognitive switching costs waste mental energy. Grouping related items allows deeper working memory activation while still respecting the spacing effect.

## Platform Behavior
- Computed on-device via high-performance vector clustering algorithms.