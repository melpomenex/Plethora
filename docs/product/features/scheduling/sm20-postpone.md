---
id: scheduler.sm20.postpone
title: SM-20 Postpone Engine
domain: scheduling
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Algorithmic workload management postponing low-priority review backlogs while strictly preserving memory stability on core cards.
how_to: When facing a review backlog, click "Postpone Overdue Items" in Queue/Review header or configure Auto-Postpone.
why: Life disruptions cause massive review backlogs; blindly reviewing 1,000 overdue cards in alphabetical order leads to study burnout, whereas intelligent postponement preserves core knowledge.
aliases:
  - postpone engine
  - backlog manager
  - sm20 postpone
  - review delay
settings:
  - scheduler.postpone.maxItemsPerDay
  - scheduler.postpone.protectHighPriority
actions:
  - id: action.queue.open
    label: View Postpone Status
    shortcut: Alt+Q
related:
  - queue.priority_score
  - scheduler.sm20.arena
  - scheduler.load_balancing
---

# SM-20 Postpone Engine

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
Adopts SuperMemo's fundamental postulate: "It is better to review the top 20% of your knowledge base thoroughly than to fail 100% of it due to despair."

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `scheduler.postpone.protectHighPriority` | `true` | Never postpone items with priority <= 20 |

## Platform Behavior
- **All Platforms**: Evaluated in Rust backend (`src-tauri/src/commands/postpone.rs`).
