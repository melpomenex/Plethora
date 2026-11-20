import { describe, expect, it, vi } from "vitest";
import {
  coalesceRssRefresh,
  refreshFeedsWithConcurrency,
  summarizeRssRefresh,
  type PromiseSlot,
} from "../rssBulkRefresh";

describe("RSS bulk refresh coordination", () => {
  it("reports success when every subscription refreshes", async () => {
    const refreshFeed = vi.fn(async () => {});
    const counts = await refreshFeedsWithConcurrency(["a", "b"], refreshFeed);

    expect(counts).toEqual({ attempted: 2, succeeded: 2, failed: 0 });
    expect(summarizeRssRefresh(counts).status).toBe("success");
  });

  it("keeps successful updates when one subscription fails", async () => {
    const applied: string[] = [];
    const refreshFeed = vi.fn(async (feed: string) => {
      if (feed === "bad") throw new Error("offline");
      applied.push(feed);
    });
    const counts = await refreshFeedsWithConcurrency(["good", "bad", "also-good"], refreshFeed);

    expect(counts).toEqual({ attempted: 3, succeeded: 2, failed: 1 });
    expect(summarizeRssRefresh(counts).status).toBe("partial_failure");
    expect(refreshFeed).toHaveBeenCalledTimes(3);
    expect(new Set(applied)).toEqual(new Set(["good", "also-good"]));
  });

  it("reports total failure and a failed state reload", async () => {
    const counts = await refreshFeedsWithConcurrency(["bad", "also-bad"], async () => {
      throw new Error("offline");
    });
    expect(counts).toEqual({ attempted: 2, succeeded: 0, failed: 2 });
    expect(summarizeRssRefresh(counts).status).toBe("failure");
    expect(summarizeRssRefresh({ attempted: 2, succeeded: 2, failed: 0 }, true)).toMatchObject({
      status: "failure",
      reloadFailed: true,
    });
  });

  it("coalesces overlapping toolbar and scheduled triggers and permits a later retry", async () => {
    const slot: PromiseSlot<string> = { current: null };
    let resolveRefresh!: (value: string) => void;
    const refresh = vi.fn(() => new Promise<string>((resolve) => { resolveRefresh = resolve; }));

    const scheduled = coalesceRssRefresh(slot, refresh);
    const toolbar = coalesceRssRefresh(slot, refresh);
    expect(toolbar).toBe(scheduled);
    expect(refresh).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    resolveRefresh("updated");
    await expect(Promise.all([scheduled, toolbar])).resolves.toEqual(["updated", "updated"]);
    expect(slot.current).toBeNull();

    const retry = coalesceRssRefresh(slot, async () => "retried");
    await expect(retry).resolves.toBe("retried");
  });
});
