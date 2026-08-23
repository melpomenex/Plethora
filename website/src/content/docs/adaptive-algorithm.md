---
title: "Plethora Adaptive Algorithm (3D SInc)"
description: "Complete 212KB Rust implementation of the Plethora Adaptive scheduler with 3D Stability Increase (SInc) matrix, D-Factor, and Retrievability calculations."
category: "scheduling-and-algorithms"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["plethora adaptive","adaptive","sinc matrix","adaptive algorithm"]
aliases: ["plethora adaptive","adaptive","sinc matrix","adaptive algorithm"]
relatedDocs: ["scheduler.fsrs","scheduler.precision.arena","import.anki_apkg"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/scheduling/adaptive-algorithm.md"
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