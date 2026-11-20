export interface RssBulkRefreshResult {
  status: "success" | "partial_failure" | "failure" | "skipped";
  attempted: number;
  succeeded: number;
  failed: number;
  reloadFailed: boolean;
}

export interface PromiseSlot<T> {
  current: Promise<T> | null;
}

/** Run every feed refresh with bounded concurrency and retain the aggregate outcome. */
export async function refreshFeedsWithConcurrency<T>(
  feeds: readonly T[],
  refreshFeed: (feed: T) => Promise<void>,
  concurrency = 6,
): Promise<Pick<RssBulkRefreshResult, "attempted" | "succeeded" | "failed">> {
  const workerCount = Math.min(feeds.length, Math.max(1, Math.floor(concurrency)));
  let cursor = 0;
  let succeeded = 0;
  let failed = 0;

  const runWorker = async () => {
    while (cursor < feeds.length) {
      const feed = feeds[cursor++];
      if (feed === undefined) continue;
      try {
        await refreshFeed(feed);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return { attempted: feeds.length, succeeded, failed };
}

/** Coalesce all-feed refresh triggers onto one promise, clearing the slot on either outcome. */
export function coalesceRssRefresh<T>(slot: PromiseSlot<T>, refresh: () => Promise<T>): Promise<T> {
  if (slot.current) return slot.current;

  let current: Promise<T>;
  current = Promise.resolve()
    .then(refresh)
    .finally(() => {
      if (slot.current === current) slot.current = null;
    });
  slot.current = current;
  return current;
}

export function summarizeRssRefresh(
  counts: Pick<RssBulkRefreshResult, "attempted" | "succeeded" | "failed">,
  reloadFailed = false,
): RssBulkRefreshResult {
  const status = reloadFailed
    ? "failure"
    : counts.failed === 0
      ? "success"
      : counts.succeeded > 0
        ? "partial_failure"
        : "failure";

  return { ...counts, status, reloadFailed };
}
