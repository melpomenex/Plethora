---
id: queue.extract_lifecycle
title: Extract Lifecycle Actions
domain: queue
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Three-state extract progression (Keep in Queue, Dismiss without deleting, Done mastered) managing graduation of reading material.
how_to: In the Queue or reader, use the action buttons: Next (Keep), Dismiss (Retire), or Done (Mastered).
why: Incremental reading requires decisive pruning; retired extracts must be preserved for search/provenance without cluttering active review queues.
aliases:
  - dismiss extract
  - done extract
  - extract graduation
  - retire reading item
settings:
  - queue.autoAdvanceOnDismiss
actions:
  - id: action.queue.open
    label: Open Reading Queue
    shortcut: Alt+Q
related:
  - queue.extract_chain
  - queue.reappearance
  - queue.scroll_session
---

# Extract Lifecycle Actions

## Purpose
Governs the state transitions of incremental reading items from raw capture to active review and eventual mastery or archival.

## User-Facing Behavior
- Action buttons in queue header:
  - **Keep in Queue (Next)**: Reschedules the extract for a future interval based on reading progress.
  - **Dismiss (Retire)**: Removes the extract from the active scheduling queue while preserving it in your library for search and references.
  - **Done (Mastered)**: Marks the concept fully understood and converted to cards; archives the extract.

## Exact Behavioral Rules
1. Dismissed extracts are marked `status: "dismissed"` and excluded from future queue sessions.
2. Done extracts increment the user's mastered knowledge metrics.
3. Undo (`Ctrl+Z`) restores the extract to its previous active queue state.

## Rationale
Prevents queue bloat. The primary failure mode in incremental reading is accumulating thousands of stale extracts; clear lifecycle actions make pruning effortless.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `queue.autoAdvanceOnDismiss` | `true` | Automatically advance to next queue item upon Dismiss or Done |

## Platform Behavior
- **All Platforms**: State updates are instant and synchronized via delta logs.
