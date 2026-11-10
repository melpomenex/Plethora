# Verification Plan: Document Rotation & New Item Scheduling

## Automated Test Suites

### T01: Same-Day Creation Boundary Suite (Vitest)
- File: `src/utils/__tests__/reviewUx.sameDayDue.test.ts`
- Scenarios:
  - Card created at 00:01 AM evaluated at 23:59 PM same day $\to$ `Due Today`, NOT overdue.
  - Card created at 9:01 AM evaluated at 9:08 AM same day $\to$ `Due Today`, NOT overdue.
  - Card due yesterday at 23:59 PM evaluated today at 00:01 AM $\to$ `Overdue 1d`.

### T02: Document Reading Interval Isolation Suite (Vitest)
- File: `src/components/review/__tests__/ReviewQueueView.documentRotation.test.tsx`
- Assertions:
  - Document items in `ReviewQueueView` render reading interval badges, not FSRS retention or memory stability pills.
  - Rescheduling a document writes to document reading rotation table, not FSRS card review logs.

### T03: Overdue Monotonicity Sweep (Rust)
- File: `src-tauri/src/algorithms/daqe/__tests__/urgency_monotonicity_tests.rs`
- Invariant: Sweep lateness from $d = 0$ to $d = 10,000$ days. Lateness readiness $A$ must be strictly non-decreasing, finite, and bounded in $[0.5, 1.0]$.

## Performance Benchmark Gate

- Command: `npm run bench:check`
- Assert that calendar-day date parsing across 4,000 items executes in under 2ms.
