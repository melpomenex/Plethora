/**

 Cold-start / catch-up pull loop (task 4.3), wired through the existing
 progressive scheduler so paging yields to input and checkpoints after every
 page (spec.md: "persist the cursor only after a page has been fully
 projected", "on restart... resume from the last fully-projected page").

*/

import { scheduleProgressiveSyncWork } from "../progressiveScheduler";
import { measureSyncPhase, recordSyncWorkSize } from "../syncTelemetry";
import { pull, type DeltaLogClientConfig, type DeltaLogOpRow } from "./client";
import { getRoomCursor, setRoomCursor } from "./checkpoints";

const PAGE_LIMIT = 500;

export interface DeltaLogPullResult {
  pagesApplied: number;
  finalCursor: number;
}

/**
 * Pull and apply pages starting from the persisted room cursor until caught
 * up to head (or the slice budget is exhausted, in which case the scheduler
 * re-enqueues automatically via its normal retry path — see maxRetries).
 * `applyPage` must be idempotent: a page that was applied but not yet
 * checkpointed (a kill between the two) will be re-delivered on next boot.
 */
export function runDeltaLogPullLoop(
  config: DeltaLogClientConfig,
  applyPage: (ops: DeltaLogOpRow[]) => Promise<void>,
): Promise<DeltaLogPullResult> {
  return scheduleProgressiveSyncWork<DeltaLogPullResult>({
    id: `delta-log-pull:${config.room}`,
    // Durable catch-up must not wait behind thousands of legacy Yjs replay
    // projections during dual-run.
    lane: "P0",
    kind: "sliceable",
    maxRetries: 3,
    checkpoint: async (value) => {
      await setRoomCursor(Number(value), config.room);
    },
    run: async (context) => {
      let since = await getRoomCursor(config.room);
      let pagesApplied = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const page = await measureSyncPhase("delta-log-pull-page", () => pull(config, since, PAGE_LIMIT));
        if (page.ops.length === 0) break;
        recordSyncWorkSize(
          page.ops.reduce((total, op) => total + op.blob.length, 0),
          page.ops.length,
        );

        await applyPage(page.ops);
        since = page.ops[page.ops.length - 1].seq;
        pagesApplied += 1;
        await measureSyncPhase("delta-log-cursor-advance", () => context.checkpoint(since));

        if (since >= page.head) break;
        if (context.shouldYield()) await context.yield();
      }
      return { pagesApplied, finalCursor: since };
    },
  });
}
