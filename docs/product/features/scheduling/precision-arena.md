---
id: scheduler.precision.arena
title: Algorithm Arena
domain: scheduling
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Head-to-head algorithm arena comparing FSRS-6, Plethora Adaptive, and Plethora Precision recommendations with live coach advice.
how_to: Toggle "Algorithm Arena" in Review Settings. During card review, an arena rail displays side-by-side interval comparisons.
why: Learners want empirical transparency into how different spaced repetition algorithms compute future due dates for the exact same card.
aliases:
  - algorithm arena
  - arena
  - srs comparison
  - algorithm coach
settings:
  - review.arena.enabled
  - review.arena.coachMode
actions:
  - id: settings.learning.algorithm
    label: Open Algorithm Settings
    shortcut: Alt+,
related:
  - scheduler.fsrs
  - scheduler.adaptive
  - scheduler.postpone
---

# Algorithm Arena

## Purpose
Enables simultaneous parallel evaluation of multiple spaced repetition algorithms on your actual personal review cards.

## User-Facing Behavior
- Displays the Arena Choice Rail at the bottom of the card review screen.
- Shows live side-by-side calculated intervals:
  - **FSRS-6**: e.g., "14 days ($R = 90\%$)"
  - **Plethora Adaptive**: e.g., "12 days (SInc 2.41)"
  - **Plethora Precision**: e.g., "16 days (Optimal load smoothed)"
- An intelligent Coach Badge highlights which algorithm is making the most statistically sound prediction for that card type.

## Exact Behavioral Rules
1. Every review grades all enabled engines simultaneously in shadow mode.
2. The user can either let their primary engine decide or click a specific engine badge to override that repetition.
3. Historical accuracy (Brier score and log loss) is tracked and plotted in Analytics.

## Rationale
Removes the dogma around algorithm superiority by presenting transparent empirical data for your own learning material.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `review.arena.enabled` | `false` | Enable live side-by-side algorithm comparison rail |

## Platform Behavior
- **All Platforms**: Zero additional latency; all shadow evaluations compute in parallel Rust threads.
