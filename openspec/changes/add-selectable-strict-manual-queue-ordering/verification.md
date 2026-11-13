# Verification for Selectable Strict Manual Queue Ordering

## Acceptance evidence

| IDs | Task | Fixture and observed result |
| --- | --- | --- |
| Q01–Q03 | 4.1 | `src/test/issue6/rankingParity.test.ts` froze the evaluation clock. The 9 existing Adaptive vectors pass. The mixed fixture on the base revision returned Adaptive order `d75, c25, e50, e50b, v00, d100`, which is unchanged. Strict Manual returns `d100, d75, e50, e50b, c25, v00`, including the equivalent timestamp offset tie and explicit zero. The handbook describes the temporal term and the in-app Priority help documents the saved slider. |
| Q05 | 4.2 | The Chromium priority harness passed 12 interaction cases, including keyboard, pointer and touch. The real IndexedDB fixture wrote and reopened priorities 0, 25, 50, 75 and 100 and rejected a missing typed target. The Documents and Scroll suites passed 37 tests after the final priority refresh changes. The Scroll overlay passed all 33 tests, including rejected edits that retain the confirmed indicator and allow retry. |
| Q04 | 4.3 | The Chromium fixture reopened `strict_manual` from persisted settings. Browse order was `d100, future, d75, e50, c25, video`; the due order was `d100, d75, e50, c25, video` at priorities 100, 75, 50, 25, 0. The future row appeared in Browse at 99 and was excluded from due. Both views excluded the archived and other-collection rows. Next was `d100`; count two returned `d100, future`. Scroll tests verified late-loaded cards rank before quotas and saved membership stays exact. |
| Q06 | 4.4 | Planner tests cover higher-priority retention, protected overflow, inverse urgency, an equal-priority due tie, explicit zero and suspension. IndexedDB rejects the whole stale preview after a different candidate's priority or an active video's date changes. A fresh plan wrote the card date `2026-11-13T00:00:00.000Z`, replay skipped, and the reopened document retained its original date. |

Strict automatic capacity uses the existing defaults of 50 and protection at priority 70 or higher. Scheduled queued video extracts count toward workload. Their dates remain eligible for explicit manual postponement.

## Test runs on 2026-11-12

- 206 tests passed across 18 focused Vitest suites. These include 58 Settings Search tests covering the existing `setting-queue-ordering-mode` target under Smart Queues. A follow-up 46-test run covered queue loading and automatic postponement after the last refactor.
- `npm run test:visual -- reading-priority.visual.spec.ts` passed its 12 interaction cases. `npm run test:visual -- strict-manual-queue.visual.spec.ts` passed with real browser storage and command adapters.
- `npm run build` and the bundle budget passed. The bundle was 27.7 MB.
- A local Node measurement sorted 4,000 mixed rows in 5.09 ms median and 5.79 ms p95, using seed 6, 20 warmups and 51 measured runs. This measures the comparator and array copy, excluding data retrieval and IPC.
- The first `npm run bench:check` flagged three existing suites: command-palette matching (64.86 against 64.65), large article import (770.1 against 759.1) and jellyfish rendering (0.05688 against 0.05566). No queue benchmark exceeded its budget.
- The second full run flagged two different suites: reader speech indexing (5.375 against 5.263) and key-point timeline construction (0.01337 against 0.01288). In a focused run with the noise anchor, the base revision also exceeded both limits (9.215 and 0.02012). The same subset on the change returned 7.904 and 0.01865. No performance baselines were adjusted.
- The shared worktree's native test build hit concurrent Study Plans type errors. Native verification is running separately on the base revision plus the queue changes.
- Whole-project TypeScript checking reports errors in other features and tests. The focused queue verification uses the commands above.

## Fixed-clock baseline

At 2026-10-29 12:00 UTC the due rotational vectors below follow `T = 0.5 + 0.5O`, where `O = 1 - exp(-days/14)`. They use manual priority 0.5.

| Days late | O | T | Native M | Browser fallback risk / overdue display |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0.000 | 0.500 | 0.500 | 50 / 0 |
| 1 | 0.069 | 0.534 | 0.528 | 53 / 7 |
| 14 | 0.632 | 0.816 | 0.753 | 82 / 63 |
| 30 | 0.883 | 0.941 | 0.853 | 94 / 88 |
| 200 | 1.000 | 1.000 | 0.900 | 95 / 90 |

`rankingParity.test.ts` reproduced 4 failures before fixture repair. Three came from fixed due dates combined with an unfrozen evaluation clock. One expected 10 for an unset priority whose documented fallback is 50. With the fixed clock, all 9 pass. This task changes the fixture and handbook. Adaptive math and selection paths are unchanged. The native terms use elapsed time and the browser fallback vector uses local dates, so parity assertions compare whole-day fixtures.
