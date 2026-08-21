---
id: scheduler.fsrs
title: FSRS-6 Spaced Repetition
domain: scheduling
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Modern 19-parameter Free Spaced Repetition Scheduler computing memory Stability and Difficulty with customizable target retention (default 90%).
how_to: Open Settings → Learning → Spaced Repetition Algorithm and select FSRS-6. Set your desired retention rate (e.g., 90%).
why: FSRS models human forgetting with modern neural optimization, cutting study time by ~20-30% compared to legacy SM-2 while maintaining target retention.
aliases:
  - fsrs
  - fsrs-6
  - modern srs
  - target retention
  - memory stability
settings:
  - scheduler.algorithm
  - scheduler.fsrs.requestRetention
  - scheduler.fsrs.maximumIntervalDays
actions:
  - id: settings.learning.algorithm
    label: Configure FSRS Settings
    shortcut: Alt+,
related:
  - scheduler.sm18
  - scheduler.sm20.arena
  - scheduler.scoped_params
---

# FSRS-6 Spaced Repetition

## Purpose
Implements the state-of-the-art Free Spaced Repetition Scheduler (FSRS-6), calculating exact memory Stability ($S$) and Difficulty ($D$) to minimize total repetition load.

## User-Facing Behavior
- Displays four rating buttons during review: `[Again (1)]`, `[Hard (2)]`, `[Good (3)]`, `[Easy (4)]` with projected next interval previews (e.g. `1d`, `3d`, `8d`, `21d`).
- Memory state inspector shows current Stability (days) and Retrievability percentage (e.g., $R = 91.4\%$).
- Retention slider allows adjusting desired retention between 70% and 97%.

## Exact Behavioral Rules
1. Retrievability $R(t, S)$ follows the power forgetting curve:
   $$R(t, S) = \left(1 + \text{FACTOR} \times \frac{t}{S}\right)^{\text{DECAY}}$$
2. Next interval $I$ is calculated directly from desired retention $r$:
   $$I(r, S) = \frac{S}{\text{FACTOR}} \times \left(r^{1/\text{DECAY}} - 1\right)$$
3. Stability increases exponentially after successful recall and decreases upon lapse.

## Rationale
Legacy algorithms like SM-2 use arbitrary heuristics. FSRS uses empirical maximum likelihood estimation over millions of real human study reviews.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scheduler.fsrs.requestRetention` | `0.90` | Target retention probability (90%) |
| `scheduler.fsrs.maximumIntervalDays` | `36500` | Maximum interval ceiling (100 years) |

## Platform Behavior
- **All Platforms**: Implemented natively in Rust (`src-tauri/src/commands/fsrs.rs`) and TypeScript client fallback.
