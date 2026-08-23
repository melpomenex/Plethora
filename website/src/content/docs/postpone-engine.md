---
title: "Postpone Engine"
description: "Algorithmic workload management postponing low-priority review backlogs while strictly preserving memory stability on core cards."
category: "scheduling-and-algorithms"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["postpone engine","backlog manager","auto postpone","review delay"]
aliases: ["postpone engine","backlog manager","auto postpone","review delay"]
relatedDocs: ["queue.priority_score","scheduler.precision.arena","scheduler.load_balancing"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/scheduling/postpone-engine.md"
---
# Postpone Engine

## Purpose
Provides mathematical backlog management that distributes overdue reviews over future days based on priority rankings and current memory retrievability.

## User-Facing Behavior
- Visual "Overdue Backlog" card offering one-click intelligent redistribution.
- Sliders to choose how many items to postpone and across how many days to spread the load.
- Protection indicators guaranteeing that items with Priority < 20 will never be delayed.

## Exact Behavioral Rules
1. Sorts candidate backlog items by Priority ($P$) and current estimated Retrievability ($R$).
2. Items near their forgetting threshold ($R \approx 0.85$) receive scheduling preference over items that have already lapsed ($R < 0.5$) or items with high stability.
3. Postponed dates are dithered to avoid creating artificial secondary backlog peaks.

## Rationale
Adopts the fundamental workload balancing postulate: "It is better to review the top 20% of your knowledge base thoroughly than to fail 100% of it due to despair."

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scheduler.postpone.protectHighPriority` | `true` | Never postpone items with priority <= 20 |

## Platform Behavior
- **All Platforms**: Evaluated in Rust backend (`src-tauri/src/algorithms/postpone.rs`).