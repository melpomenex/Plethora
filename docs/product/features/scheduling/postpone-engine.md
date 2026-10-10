---
id: scheduler.postpone
title: Postpone Engine
domain: scheduling
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Schedule recovery for overdue queue content while preserving review and memory state.
how_to: Enable Auto-postpone in Learning Settings to reschedule eligible overdue content when a new app session starts. Use Postpone All for a manual queue operation.
why: Life disruptions cause massive review backlogs; blindly reviewing 1,000 overdue cards in alphabetical order leads to study burnout, whereas intelligent postponement preserves core knowledge.
aliases:
  - postpone engine
  - backlog manager
  - auto postpone
  - review delay
settings:
  - learning.postpone.autoPostponeEnabled
actions:
  - id: action.queue.open
    label: View Postpone Status
    shortcut: Alt+Q
related:
  - queue.priority_score
  - scheduler.precision.arena
  - scheduler.load_balancing
---

# Postpone Engine

## Purpose
At the beginning of a new app session, the enabled recovery flow finds eligible overdue learning items, documents, and text extracts in the active collection. It assigns them to the least-loaded local dates from tomorrow through the next 30 days. It changes schedule dates and sync metadata only; review history and memory state stay intact.

## User-Facing Behavior
- Automatic recovery runs once after backend and settings hydration. Reopening Queue or Schedule does not repeat it.
- A nonblocking summary reports discovered, postponed, skipped, failed, and remaining overdue counts plus the date distribution.
- Manual Postpone All and review controls remain available.
- Video extracts are reported as skipped because they do not yet have a first-class sync entity.

## Exact Behavioral Rules
1. A due date is overdue only when its local calendar day is strictly before today; missing dates are not overdue.
2. Existing eligible workload is counted for each local calendar day in the planning window.
3. Candidates are assigned deterministically to the least-loaded day. The existing postpone eligibility rules determine which items are skipped.
4. Only the due-date field and sync metadata are updated; FSRS state, interval, review count, and last-review date are preserved.

## Rationale
Adopts the fundamental workload balancing postulate: "It is better to review the top 20% of your knowledge base thoroughly than to fail 100% of it due to despair."

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `learning.postpone.autoPostponeEnabled` | `false` | Automatically recover overdue content once at the start of a new app session |

## Platform Behavior
- **Desktop and mobile**: Native storage applies the plan in a journaled SQLite transaction; browser storage uses one IndexedDB transaction.
- **Session scope**: The startup collection is processed once per app process. Queue and Schedule share the same operation.
