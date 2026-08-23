---
title: "Review Rating Undo"
description: "Instant rating reversal via Ctrl+Z or Undo button, restoring previous card state, scheduling interval, and history log."
category: "remember-and-review"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["undo rating","revert review","rating correction","undo card grade"]
aliases: ["undo rating","revert review","rating correction","undo card grade"]
relatedDocs: ["review.flashcard_studio","scheduler.fsrs","scheduler.adaptive"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/review/rating-undo.md"
---
# Review Rating Undo

## Purpose
Allows immediate rollback of accidental flashcard ratings, restoring previous card scheduling state and revoking recorded review log entries.

## User-Facing Behavior
- Pressing `Ctrl+Z` / `Cmd+Z` restores the previous card to its flipped state.
- Floating toast notification confirms: `Rating reverted for "[Card Title]"`.
- Review counters and upcoming queue totals update back immediately.

## Exact Behavioral Rules
1. Stores the full pre-review card snapshot in an in-memory ring buffer (default depth 50 items).
2. Rolling back removes the corresponding row from SQLite `review_history` table and reverts Stability/Difficulty to previous values.
3. Multiple successive undos are supported within the active review session.

## Rationale
Users frequently press the wrong grade key when reviewing quickly. Without undo, an accidental "Again" on a mature card resets its interval unnecessarily.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `review.undoHistoryDepth` | `50` | Number of previous review steps kept in undo buffer |

## Platform Behavior
- **All Platforms**: Zero disk corruption risk; transaction rollback is atomic in SQLite.