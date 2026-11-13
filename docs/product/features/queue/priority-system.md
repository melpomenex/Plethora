---
id: queue.priority_score
title: 0-100 Priority Scoring
domain: queue
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Saved 0–100 priority, with 100 highest. Strict Manual uses this value to order eligible items in the Reading Queue and Scroll Mode.
how_to: Use the Set Priority shortcut or the priority badge to edit an item's value. Choose Strict Manual in Settings → Smart Queues → Queue Ordering Mode.
why: Manual priority lets you put important material first within the current queue's filters.
aliases:
  - priority ranking
  - importance score
  - queue priority
  - item weight
settings:
  - smartQueue.queueOrderingMode
actions:
  - id: action.queue.open
    label: Open Reading Queue
    shortcut: Alt+Q
related:
  - queue.extract_chain
  - scheduler.postpone
  - queue.reappearance
---

# 0-100 Priority Scoring

## Purpose
Priority records how important an item is to you. Queue Ordering Mode controls how that value affects presentation.

## User-Facing Behavior
- The priority editor shows the last saved value. You can assign any whole number from 0 to 100.
- Strict Manual presents higher priorities first in Reading Queue, saved queues, and Scroll Mode, within their current filters and composition limits.
- Adaptive is the default. Its ranking can also use due dates, memory state, and your Smart Queue settings.

## Exact Behavioral Rules
1. Strict Manual orders equal priorities by due instant, then by item type and ID. Missing due dates follow valid dates at the same priority.
2. A saved zero is the lowest priority. Items without their own priority use the existing inherited value or legacy rating where available, then 50.
3. When automatic postponement is enabled, Strict Manual protects items at priority 70 or higher. It keeps higher priorities in the remaining slots of the 50-item daily capacity and can move eligible lower-priority overflow. You can still postpone an item manually.

## Rationale
Strict Manual makes a priority edit directly visible in the order of eligible items. Adaptive combines priority with scheduling and session context.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `smartQueue.queueOrderingMode` | Adaptive | Orders eligible queue items using Adaptive or Strict Manual. |

## Platform Behavior
- The desktop and browser queues use the same Strict Manual tie-break rules.
