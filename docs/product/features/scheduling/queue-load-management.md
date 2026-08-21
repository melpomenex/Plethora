---
id: scheduler.load_balancing
title: Queue Load Smoothing & Easy Days
domain: scheduling
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Algorithmic workload smoothing shifting card due dates away from peak days and configuring lower-intensity Easy Days on weekends.
how_to: Open Settings → Learning → Workload Smoothing. Select your designated Easy Days (e.g. Saturdays & Sundays) and maximum daily load ceiling.
why: Strict spaced repetition algorithms can produce spiky workloads (e.g. 300 cards on Monday, 20 on Tuesday); load smoothing levels out the daily effort.
aliases:
  - easy days
  - load balancing
  - workload smoothing
  - daily card cap
settings:
  - scheduler.loadBalancing.enabled
  - scheduler.loadBalancing.easyDays
  - scheduler.loadBalancing.maxDailyCards
actions:
  - id: settings.learning.algorithm
    label: Open Scheduling Settings
    shortcut: Alt+,
related:
  - scheduler.fsrs
  - scheduler.sm20.postpone
  - queue.scroll_session
---

# Queue Load Smoothing & Easy Days

## Purpose
Prevents review burnout by leveling daily review counts across weeks and allowing reduced study volume on designated rest days.

## User-Facing Behavior
- Visual 14-day upcoming review load histogram in Dashboard and Queue views.
- Easy Days selector checkboxes (e.g. reduce weekend reviews by 50% or 100%).
- Automatically smooths out artificial review spikes caused by batch card creation.

## Exact Behavioral Rules
1. When scheduling a card, the scheduler evaluates a window of $\pm \Delta$ days around the target date.
2. Selects the date with the lowest existing card count that maintains $R \ge 0.88$.
3. On designated Easy Days, review targets are capped and non-urgent reviews are shifted forward or backward into surrounding days.

## Rationale
Consistency is the single most important factor in spaced repetition. A predictable daily routine beats unsustainable boom-and-bust cycles.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scheduler.loadBalancing.enabled` | `true` | Enable intelligent interval fuzzing and workload leveling |
| `scheduler.loadBalancing.easyDays` | `[]` | Days of the week with reduced review quotas |

## Platform Behavior
- **All Platforms**: Real-time load calculation in review store and SQLite backend.
