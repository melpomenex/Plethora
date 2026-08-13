import { useCallback, useEffect, useRef } from "react";
import { recordActiveTime } from "../api/item-stats";
import { useActiveTimeTracker } from "./useActiveTimeTracker";

/**
 * Active-time measurement for the Queue.
 *
 * The Queue already measured dwell time, but as raw wall-clock: an item left
 * on screen while the user made coffee counted every second. This replaces
 * that measurement with idle-aware active seconds while keeping the existing
 * rating call signatures — the seconds still travel to the backend as the
 * rating's `timeTaken`.
 *
 * Two paths out, and never both for the same second:
 *
 * * **Rated** — {@link QueueTimeTracker.consumeActiveSeconds} hands the
 *   seconds to the rating call, which accumulates them and writes one history
 *   row carrying the review's true duration.
 * * **Skipped** — anything still unspent when the item changes is sent
 *   directly, so time spent on an item the user moved past is recorded rather
 *   than discarded.
 */

/** The backing record for item types that keep a cumulative time total. */
export interface QueueTimedTarget {
  itemType: "document" | "extract";
  itemId: string;
}

export interface QueueTimeTracker {
  /**
   * Active seconds observed on the current item, clearing them so they cannot
   * also be sent as unrated time.
   */
  consumeActiveSeconds: () => number;
  /** Report engagement with no DOM event behind it (media progress, a rating). */
  notifyEngagement: () => void;
}

export function useQueueTimeTracker(
  itemKey: string | null | undefined,
  target: QueueTimedTarget | null,
  options: { enabled?: boolean } = {},
): QueueTimeTracker {
  const { enabled = true } = options;

  const observedSecondsRef = useRef(0);
  const trackedTargetRef = useRef<QueueTimedTarget | null>(null);

  const handleFlush = useCallback((activeSeconds: number) => {
    observedSecondsRef.current += activeSeconds;
  }, []);

  const tracker = useActiveTimeTracker({
    isActive: true,
    onFlush: handleFlush,
    itemKey: itemKey ?? undefined,
    enabled,
  });

  const { flush, notifyEngagement } = tracker;

  const consumeActiveSeconds = useCallback(() => {
    flush();
    const seconds = observedSecondsRef.current;
    observedSecondsRef.current = 0;
    return seconds;
  }, [flush]);

  // Runs after the tracker's own item-change flush (its effects are declared
  // first, inside the hook above), so by this point `observedSecondsRef` holds
  // everything the previous item accrued. Anything still there was never spent
  // on a rating — the user skipped past — so it is recorded on its own.
  useEffect(() => {
    const previous = trackedTargetRef.current;
    const seconds = observedSecondsRef.current;
    observedSecondsRef.current = 0;

    if (previous && seconds > 0) {
      void recordActiveTime(previous.itemType, previous.itemId, "queue", seconds).catch(() => {});
    }

    trackedTargetRef.current = target;
    // Keyed on `itemKey` alone: `target` is rebuilt every render, so listing it
    // would re-run this on renders where the item did not actually change and
    // flush the current item's seconds out from under it.
  }, [itemKey]);

  // Keep the ref pointing at the current item even when only the backing
  // record resolves later (a queue item whose document loads after mount).
  useEffect(() => {
    trackedTargetRef.current = target;
  }, [target?.itemType, target?.itemId]);

  return { consumeActiveSeconds, notifyEngagement };
}
