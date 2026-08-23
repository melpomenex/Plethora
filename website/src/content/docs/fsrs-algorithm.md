---
title: "FSRS-6 Spaced Repetition"
description: "Modern 19-parameter Free Spaced Repetition Scheduler computing memory Stability and Difficulty with customizable target retention (default 90%)."
category: "scheduling-and-algorithms"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["fsrs","fsrs-6","modern srs","target retention","memory stability"]
aliases: ["fsrs","fsrs-6","modern srs","target retention","memory stability"]
relatedDocs: ["scheduler.adaptive","scheduler.precision.arena","scheduler.scoped_params"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/scheduling/fsrs-algorithm.md"
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
Legacy heuristic algorithms rely on fixed step multipliers. FSRS uses empirical maximum likelihood estimation over millions of real human study reviews.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scheduler.fsrs.requestRetention` | `0.90` | Target retention probability (90%) |
| `scheduler.fsrs.maximumIntervalDays` | `36500` | Maximum interval ceiling (100 years) |

## Platform Behavior
- **All Platforms**: Implemented natively in Rust (`src-tauri/src/commands/fsrs.rs`) and TypeScript client fallback.