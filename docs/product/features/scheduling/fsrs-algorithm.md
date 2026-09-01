---
id: scheduler.fsrs
title: FSRS-7 Spaced Repetition
domain: scheduling
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Production 34-parameter Free Spaced Repetition Scheduler with dual-trace memory state (slow and fast stability) and customizable target retention (default 90%).
how_to: Open Settings → Learning → Spaced Repetition Algorithm. FSRS-7 is the sole production scheduler; adjust your desired retention rate (e.g., 90%).
why: FSRS-7 models human forgetting with a dual-trace memory state and fractional elapsed-time scheduling, improving interval accuracy over earlier single-trace FSRS versions while maintaining target retention.
aliases:
  - fsrs
  - fsrs-7
  - modern srs
  - target retention
  - memory stability
  - dual trace
settings:
  - scheduler.algorithm
  - scheduler.fsrs.requestRetention
  - scheduler.fsrs.maximumIntervalDays
actions:
  - id: settings.learning.algorithm
    label: Configure FSRS Settings
    shortcut: Alt+,
related:
  - scheduler.adaptive
  - scheduler.precision.arena
  - scheduler.scoped_params
---

# FSRS-7 Spaced Repetition

## Purpose
Implements the production Free Spaced Repetition Scheduler (FSRS-7), calculating dual-trace memory state — slow **Stability** ($S$), fast **Stability (fast)** ($S_\text{fast}$), and **Difficulty** ($D$) — to minimize total repetition load.

## User-Facing Behavior
- Displays four rating buttons during review: `[Again (1)]`, `[Hard (2)]`, `[Good (3)]`, `[Easy (4)]` with projected next interval previews (e.g. `1d`, `3d`, `8d`, `21d`).
- Memory state inspector shows slow stability, fast stability, difficulty, and retrievability percentage (e.g., $R = 91.4\%$).
- Retention slider allows adjusting desired retention between 70% and 97%.
- FSRS-7 is the only scheduler offered in Learning settings; legacy schedulers are retained in code but hidden.

## Dual-Trace Model
FSRS-7 maintains two stability traces per item:
- **Slow trace** (`stability`): long-horizon memory strength used for interval growth.
- **Fast trace** (`stability_fast`): short-horizon recall dynamics.
- **Retrievability** is computed from a mixture of both traces, not from a single stability value.

Fractional elapsed days (e.g. a 30-minute gap) are passed through to scheduling without rounding to whole days.

## Exact Behavioral Rules
1. Retrievability follows the FSRS-7 dual-trace forgetting model (mixture of slow- and fast-trace components).
2. Next interval $I$ is solved from desired retention $r$ using the active dual-trace state.
3. Both stability traces update independently after each review; difficulty updates with mean-reversion damping.

## Rationale
Legacy heuristic algorithms rely on fixed step multipliers. FSRS uses empirical maximum likelihood estimation over millions of real human study reviews. FSRS-7 extends the model with dual traces and fractional elapsed time for more accurate same-day and short-gap scheduling.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scheduler.fsrs.requestRetention` | `0.90` | Target retention probability (90%) |
| `scheduler.fsrs.maximumIntervalDays` | `36500` | Maximum interval ceiling (100 years) |

## Platform Behavior
- **All Platforms**: Implemented natively in Rust (`src-tauri/src/algorithms/fsrs7/`) with a TypeScript scalar port for browser parity (`src/algorithms/fsrs7/`).
- **Upstream**: Vendored from [open-spaced-repetition/fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs) (BSD-3-Clause). See `vendor/fsrs-rs-fsrs7/UPSTREAM.md`.
