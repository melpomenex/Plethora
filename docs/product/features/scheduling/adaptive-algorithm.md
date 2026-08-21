---
id: scheduler.adaptive
title: Plethora Adaptive Algorithm (3D SInc)
domain: scheduling
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Complete 212KB Rust implementation of the Plethora Adaptive scheduler with 3D Stability Increase (SInc) matrix, D-Factor, and Retrievability calculations.
how_to: Open Settings → Learning → Spaced Repetition Algorithm and select Plethora Adaptive.
why: Plethora Adaptive features a continuous 3D SInc interpolation matrix across Difficulty, Stability, and Retrievability based on decades of empirical memory research.
aliases:
  - plethora adaptive
  - adaptive
  - sinc matrix
  - adaptive algorithm
settings:
  - scheduler.algorithm
  - scheduler.adaptive.forgettingIndex
actions:
  - id: settings.learning.algorithm
    label: Configure Adaptive Settings
    shortcut: Alt+,
related:
  - scheduler.fsrs
  - scheduler.precision.arena
  - import.anki_apkg
---

# Plethora Adaptive Algorithm (3D SInc)

## Purpose
Provides a high-performance Rust implementation of the continuous 3D SInc adaptive spaced repetition engine.

## User-Facing Behavior
- 6-grade rating scale (0-5) or simplified 4-button review interface.
- Real-time display of A-Factor, D-Factor, Stability ($S$), and Retrievability ($R$).
- Forgetting Index configuration (default 10%, meaning 90% expected recall).

## Exact Behavioral Rules
1. Uses the 3D Stability Increase matrix $\text{SInc}[D, S, R]$:
   $$S_{n+1} = S_n \times \text{SInc}(D, S_n, R)$$
2. Matrix entries are smoothed and updated continuously based on actual repetition outcomes.
3. Post-lapse stability recovery accounts for previous memory traces rather than resetting intervals to 1 day.

## Rationale
Accounts for the spacing effect and retrievability at the exact moment of repetition: reviewing when $R=0.9$ yields a different stability increase than reviewing when $R=0.6$.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scheduler.adaptive.forgettingIndex` | `10` | Requested forgetting index percentage (10% = 90% retention) |

## Platform Behavior
- **All Platforms**: Full 212KB Rust computation engine (`src-tauri/src/algorithms/adaptive.rs`).
