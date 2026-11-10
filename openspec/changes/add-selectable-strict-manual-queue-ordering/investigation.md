# Technical Investigation: Strict Manual Queue Ordering

## 1. Problem Statement & Baseline Behavior

In Issue #6, users reported that setting an item to high priority (e.g. 100% or position 1) in Plethora does not guarantee that it appears first in study sessions or the queue list. Instead, lower-priority items often surface ahead of high-priority material.

## 2. Root Cause Analysis

Investigation of the codebase reveals multiple compounding causes:

1. **Urgency Formulation (`src-tauri/src/algorithms/daqe/terms.rs:223`)**:
   `calculate_canonical_urgency` calculates memory urgency as:
   ```rust
   let m_raw = 0.8 * t + 0.2 * p;
   ```
   Manual priority $p$ is weighted at only 0.2, while temporal urgency $t$ receives 0.8. If an item is overdue or due today, $t \approx 0.5 - 1.0$, whereas a high-priority future item has $t = 0.0$. Thus, a low-priority overdue card ($p = 0.1$, $t = 1.0 \implies m = 0.82$) easily outranks a critical future document ($p = 1.0$, $t = 0.0 \implies m = 0.20$).

2. **Scroll Mode Variety Guard (`src/utils/queueScrollOrder.ts:51-87`)**:
   In `orderScrollItemsByPriority`:
   ```ts
   if (item.type === lastType) {
     if (streak >= maxSameTypeConsecutive) {
       deferred.push(item);
       continue;
     }
     streak++;
   }
   ```
   If a user prioritizes 5 important documents at 100%, items 4 and 5 are pushed into `deferred` and spliced later into the queue behind lower-priority flashcards or extracts to enforce "variety".

3. **Inconsistent Position vs Percentile Mapping**:
   In `src-tauri/src/algorithms/priority_queue.rs:24`:
   ```rust
   pub fn priority_from_position(position: usize, size: usize) -> f64 {
       if size <= 1 { return 0.0; }
       let pos = position.max(1) as f64;
       ((pos - 1.0) / (size - 1) as f64) * 100.0
   }
   ```
   This mapped position 1 (top of queue) to priority 0.0. However, `src-tauri/src/database/priority_rank.rs:20` states:
   "Direction convention: the order key ascends with importance (higher score = more important)... position 1 represents the highest priority element."
   This discrepancy created confusion in UI representations and keyboard shortcut bindings.

## 3. Remediation Strategy

Provide a clean user-selectable preference:
- Mode `adaptive`: Keep existing multi-term balance for users who prefer autonomous pacing.
- Mode `strict-manual`: Bypass DAQE arithmetic and variety deferrals. Order items by canonical $P$ descending, with due dates as tie-breakers.
- Mode `srs-priority`: Classic SRS bucketing (Due -> New -> Future) ordered by priority within each bucket.
