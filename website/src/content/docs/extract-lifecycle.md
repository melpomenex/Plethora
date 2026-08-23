---
title: "Extract Lifecycle Actions"
description: "Three-state extract progression (Keep in Queue, Dismiss without deleting, Done mastered) managing graduation of reading material."
category: "understand-and-extract"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["dismiss extract","done extract","extract graduation","retire reading item"]
aliases: ["dismiss extract","done extract","extract graduation","retire reading item"]
relatedDocs: ["queue.extract_chain","queue.reappearance","queue.scroll_session"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/queue/extract-lifecycle.md"
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