# Architectural Design: Clarify Document Rotation & New Item Scheduling

## Problem Diagnosis

### 1. The Same-Day "Overdue" Bug
In `src/utils/reviewUx.ts:261-265`:
```ts
const due = item.dueDate ? new Date(item.dueDate) : null;
const now = new Date();
const isDue = due ? due <= now : false;
const isOverdue = due ? due < now : false;
```
When a card is created at 9:01 AM, `item.dueDate` is set to `2026-11-04T09:01:00.000Z`.
At 9:08 AM (when the user opens the card statistics or details modal, as documented in Screenshot 13), `due < now` evaluates to `true`.
Consequently, `isOverdue` becomes `true`, `statusLabel` is set to `"Overdue"`, and the UI renders a red alarm badge `(Overdue)`. This violates basic user expectations: an item created today to be studied today is "Due Today", not overdue!

### 2. Conflation of Reading Topics & Recall Cards
In SuperMemo incremental reading, elements are divided into:
- **Topics (Documents & Extracts)**: Slices of reading material. When processed, they are either read further, postponed, or scheduled for a next reading interval based on reading priority.
- **Items (Flashcards)**: Active recall prompts with questions and answers. Evaluated via memory recall algorithms (FSRS-7).
In Plethora, document rows in `ReviewQueueView.tsx:1767` were calling `getFsrsSchedulingInfo(item)`, displaying FSRS stability and difficulty statistics for documents and asking for memory ratings.

## Architectural Solutions

### 1. Calendar-Day Normalized Due State Calculation
All client-side due state derivations must normalize both `dueDate` and `currentDate` to start-of-day in the user's local timezone:
```ts
export function isItemOverdue(dueDateString: string, now: Date = new Date()): boolean {
  const due = new Date(dueDateString);
  const startOfDueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Overdue ONLY if the due calendar day is strictly before today's calendar day
  return startOfDueDay.getTime() < startOfToday.getTime();
}

export function isItemDueToday(dueDateString: string, now: Date = new Date()): boolean {
  const due = new Date(dueDateString);
  const startOfDueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return startOfDueDay.getTime() === startOfToday.getTime();
}
```
With this normalization:
- Nov 4, 9:01 AM inspected on Nov 4, 9:08 AM: `startOfDueDay === startOfToday` $\implies$ **Due Today** (Severity: warning/neutral).
- Nov 3, 23:59 PM inspected on Nov 4, 00:01 AM: `startOfDueDay < startOfToday` $\implies$ **Overdue 1d** (Severity: danger).

### 2. Dual-Track Scheduling Model
We formally separate scheduling semantics by `item_type`:
- **Document / Extract**:
  - Scheduler: `ReadingRotationScheduler`
  - Lifecycle: `Unread` $\to$ `Reading` $\to$ `Reviewed/Rescheduled` $\to$ `Dismissed`
  - Rating: Not 1-4 recall, but reading actions: "Next in 3 days", "Next in 7 days", "Next in 14 days", or "Mark as Finished".
- **Learning Item (Flashcard / Cloze)**:
  - Scheduler: `FSRS-7 Recall Scheduler`
  - Lifecycle: `New` $\to$ `Learning` $\to$ `Review` $\to$ `Relearning`
  - Rating: Memory recall grades 1 (Again), 2 (Hard), 3 (Good), 4 (Easy).

### 3. Bounded Monotone Overdue Urgency
In `src-tauri/src/algorithms/daqe/terms.rs`:
Overdue lateness fractional days $d = \max(0, (now - due) / 86400000)$.
Readiness $A = 0.5 + 0.5 \cdot (1 - e^{-d / 14})$.
For same-day items ($d = 0$), $A = 0.5$, providing baseline readiness without artificial overdue inflation.
Extreme overdue backlogs saturate smoothly at $1.0$ as $d \to \infty$ without numerical overflows or hard clipping artifacts.
