# Technical Investigation: Document Rotation & New Item Scheduling

## 1. Problem Evidence

In Issue #6 (Comment 2, Screenshot 13):
- A user created a new flashcard on Nov 4, 2026 at 9:01 AM.
- When viewing the card's details modal at 9:08 AM on the exact same morning, the dialog displayed:
  `Next review: Nov 4, 2026, 9:01 AM (Overdue)`
- Furthermore, documents in the queue displayed flashcard recall metrics and FSRS memory states, causing confusion over how document reading interacts with card review.

## 2. Root Cause Analysis

1. **Millisecond Lateness Comparison**:
   In `src/utils/reviewUx.ts:263-264`:
   ```ts
   const due = item.dueDate ? new Date(item.dueDate) : null;
   const now = new Date();
   const isDue = due ? due <= now : false;
   const isOverdue = due ? due < now : false;
   ```
   At 9:08 AM, `now.getTime()` is 420,000 milliseconds greater than `due.getTime()`. Because `due < now` is strictly true, `isOverdue` was flagged as `true`, and line 290 emitted `statusLabel = "Overdue"`.

2. **Inconsistent Due-Date Logic across Components**:
   - `src/lib/scheduleItemPresentation.ts:100` uses `Math.round((due.getTime() - today.getTime()) / 86400000)`.
   - `src/components/review/DeckManagerCardRow.tsx:43` uses `diffMs / (1000 * 60 * 60 * 24)` and marks `diffDays < 0` as `Overdue`.
   - `src-tauri/src/algorithms/daqe/terms.rs:131` compares `due_at <= now`.
   None of the frontend presentation helpers were stripping hour/minute timestamps before checking calendar lateness.

3. **Incremental Reading Semantic Distortion**:
   SuperMemo's core tenet is that reading material (topics) and tested knowledge (items) are fundamentally distinct. Plethora's UI was routing documents through flashcard review modals, blurring reading comprehension and factual memory recall.

## 3. Remediation Strategy

- Centralize calendar-day normalization into a pure helper `isItemOverdue(dueDate, now)` that zeroes out time components.
- Separate document interval rescheduling from flashcard FSRS memory updates.
