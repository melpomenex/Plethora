---
id: concepts.topic_aware_scheduling
title: Topic-Aware Scheduling (TAS) Principles
domain: concepts
status: implemented
platforms:
  - all
summary: Theoretical principles behind Topic-Aware Scheduling (TAS), preventing context switching penalties while preserving spaced repetition optimality.
how_to: Enable "Neural Queue" or "Topic-Aware Scheduling" in Reading Queue settings.
why: Excessive topic hopping degrades cognitive focus; TAS groups conceptually related items into micro-clusters without delaying overdue reviews.
aliases:
  - topic aware scheduling
  - tas
  - semantic scheduling
  - context clustering
settings:
  - queue.neuralClusterStrength
actions:
  - id: action.queue.open
    label: Open Reading Queue
    shortcut: Alt+Q
related:
  - queue.neural_queue
  - scheduler.load_balancing
  - queue.scroll_session
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
