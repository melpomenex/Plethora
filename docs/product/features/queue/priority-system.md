---
id: queue.priority_score
title: 0-100 Priority Scoring
domain: queue
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Granular 0-100 priority ranking system (0 = urgent top priority, 100 = lowest background priority) driving item scheduling and postponement.
how_to: Press Alt+P or use the priority badge on any document or extract to enter a score from 0 to 100.
why: Human time is strictly limited; explicit mathematical priority ensures crucial exam or project materials are reviewed before low-value background reading.
aliases:
  - priority ranking
  - importance score
  - queue priority
  - item weight
settings:
  - queue.defaultDocumentPriority
  - queue.defaultExtractPriority
actions:
  - id: action.queue.open
    label: Open Reading Queue
    shortcut: Alt+Q
related:
  - queue.extract_chain
  - scheduler.postpone
  - queue.reappearance
---

# 0-100 Priority Scoring

## Purpose
Provides a standardized, continuous priority metric that determines item sampling frequency, interval spacing, and automatic workload postponement.

## User-Facing Behavior
- Visual color-coded priority badge on every document, extract, and card (Red = 0-20 High, Amber = 21-60 Medium, Blue/Gray = 61-100 Low).
- Quick shortcut adjustments (`Alt+Up` increase priority / lower number, `Alt+Down` decrease priority).
- Reading Queue can be sorted and filtered by priority thresholds.

## Exact Behavioral Rules
1. Priority `P` is a floating-point number in the range `[0.0, 100.0]`. Lower numbers represent higher priority.
2. In priority queue generation, items with higher priority receive shorter initial intervals and higher selection probability.
3. During queue overload, the Postpone Engine automatically postpones items with `P > 60` while protecting `P < 20` items.

## Rationale
Adopts continuous priority queue formulation, solving the fundamental incremental reading dilemma: having far more reading material than time permits.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `queue.defaultDocumentPriority` | `30.0` | Default priority for newly imported documents |
| `queue.defaultExtractPriority` | `20.0` | Default priority for newly created extracts |

## Platform Behavior
- **All Platforms**: Consistent priority algorithms evaluated in Rust backend.
