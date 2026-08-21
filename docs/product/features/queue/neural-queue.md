---
id: queue.neural_queue
title: Neural Topic Queue
domain: queue
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Semantic similarity clustering sequencing related articles, extracts, and cards into coherent, associative reading chains.
how_to: In Reading Queue, select "Neural Sort" from the sorting menu or toggle Neural Queue in session settings.
why: Pure priority sorting can jump jarringly between unrelated topics (e.g. quantum mechanics → French grammar → tax code); neural sorting groups semantically connected items to maximize contextual focus.
aliases:
  - neural queue
  - semantic queue
  - topic clustering
  - associative reading
  - neural sort
settings:
  - queue.neuralClusterStrength
actions:
  - id: action.queue.open
    label: Open Reading Queue
    shortcut: Alt+Q
related:
  - queue.priority_score
  - graph.knowledge_sphere
  - ai.task_router
---

# Neural Topic Queue

## Purpose
Organizes pending reading items into semantically coherent topic clusters, leveraging semantic embeddings to create smooth conceptual transitions between articles.

## User-Facing Behavior
- Groups related extracts, cards, and papers together (e.g. 4 consecutive items exploring transformer attention architectures before moving to history).
- Displays a visual "Topic Cluster" banner when transitioning between domains.
- Enhances associative insight generation by placing related concepts in immediate mental proximity.

## Exact Behavioral Rules
1. Computes document embeddings using on-device LiteRT/EmbeddingGemma or cached vector representations.
2. Formulates reading order as a constrained Traveling Salesperson Problem (TSP) optimizing for cosine similarity while respecting due dates.
3. Overdue high-priority cards are injected as non-negotiable milestones within the sequence.

## Rationale
Human associative memory thrives on semantic connections. Reading related items together builds deeper mental schema than random interleaving.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `queue.neuralClusterStrength` | `0.7` | Weight assigned to semantic similarity vs raw due date |

## Platform Behavior
- **Desktop**: Fast GPU/CPU vector cosine calculations in Rust backend.
- **Android / Mobile**: Employs LiteRT acceleration for on-device cluster calculation.
