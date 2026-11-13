# Issue #6 Traceability for Selectable Strict Manual Queue Ordering

| IDs | Task | Implementation anchors | Acceptance |
| --- | --- | --- | --- |
| Q01–Q03 | 4.1 | `src-tauri/src/algorithms/daqe/terms.rs`, `src/test/issue6/rankingParity.test.ts`, `docs/USER_HANDBOOK.md` | Fixed-clock temporal and priority vectors, Adaptive order snapshot and corrected help |
| Q05 | 4.2 | `src/components/documents/usePriorityPopup.tsx`, `src/utils/queueManualOrder.ts`, `src-tauri/src/database/priority_rank.rs` | Typed persistence, explicit zero, existing inheritance and rejected edit retry |
| Q04 | 4.3 | `src/stores/queueStore.ts`, `src-tauri/src/commands/queue.rs`, `src/lib/browser-backend.ts`, `src/pages/QueueScrollPage.tsx` | Exact mixed order after filtering and reload, saved membership, Optimal composition and bounded queue output |
| Q06 | 4.4 | `src/lib/autoPostponePlanner.ts`, `src-tauri/src/commands/auto_postpone.rs`, `src/lib/database.ts` | Protection and overflow order, stale preview rejection and transactional dates |
| Settings Search | 4.3 | `src/components/settings/search/settingsSearchCatalog.ts` | Existing `setting-queue-ordering-mode` target opens Smart Queues |

The [verification record](verification.md) lists observed results. The [Issue #6 matrix](../../planning/issue-6-final-traceability.md) links the original reporter evidence. The [shared release gates](../qualify-issue-6-remediation/verification.md) define the qualification runs.

## Spec requirements

| IDs | OpenSpec requirement |
| --- | --- |
| Q01–Q04 | [User-selectable queue ordering mode](specs/strict-manual-queue-ordering/spec.md#requirement-user-selectable-queue-ordering-mode) |
| Q05 | [Canonical manual priority and deterministic presentation](specs/strict-manual-queue-ordering/spec.md#requirement-canonical-manual-priority-and-deterministic-presentation) |
| Q06 | [Strict automatic postponement](specs/strict-manual-queue-ordering/spec.md#requirement-strict-automatic-postponement) |
