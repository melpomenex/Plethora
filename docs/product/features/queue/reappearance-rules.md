---
id: queue.reappearance
title: Reappearance Interval Rules
domain: queue
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Algorithmic calculation of document and extract reappearance intervals based on reading speed, text length, priority, and queue load.
how_to: When you finish reading a section of a document, click "Next" or rate the portion read. Plethora schedules its next reappearance date automatically.
why: Long books should not be read in a single grueling marathon; spaced incremental reading allows the brain to process difficult ideas over weeks and months.
aliases:
  - article interval
  - reappearance interval
  - incremental reading spacing
  - document scheduling
settings:
  - queue.baseArticleIntervalDays
  - queue.intervalGrowthFactor
actions:
  - id: action.queue.open
    label: View Reappearance Schedule
    shortcut: Alt+Q
related:
  - queue.priority_score
  - queue.scroll_session
  - scheduler.fsrs
---

# Reappearance Interval Rules

## Purpose
Governs the mathematical spacing between successive encounters with a document or extract during incremental reading.

## User-Facing Behavior
- Shows the next scheduled reappearance date (e.g. "Returns in 8 days") after each reading interaction.
- Provides manual override buttons (`[Tomorrow]`, `[+7 Days]`, `[+30 Days]`, `[Custom Date]`).
- Adjusts spacing automatically if you read faster or slower than expected.

## Exact Behavioral Rules
1. Initial interval $I_1$ is calculated based on document priority $P$ and character length:
   $$I_1 = \text{baseInterval} \times \left(\frac{P}{50}\right)^{-0.8}$$
2. Subsequent intervals expand exponentially by a growth factor $\alpha \approx 1.5 - 2.2$ conditioned on user engagement ratings.
3. Queue load balancing automatically shifts reappearance dates away from peak days to prevent backlog spikes.

## Rationale
Distributing long-form reading over spaced intervals leverages the incubation effect in psychology, leading to higher long-term retention and creative synthesis.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `queue.baseArticleIntervalDays` | `3` | Baseline interval for medium-priority articles |
| `queue.intervalGrowthFactor` | `1.6` | Multiplier applied on successive reading passes |

## Platform Behavior
- **All Platforms**: Evaluated deterministically in Rust backend (`incremental_scheduler.rs`).
