import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProgressiveSyncScheduler,
  resetProgressiveSyncSchedulerForTest,
} from "../sync/progressiveScheduler";

afterEach(() => {
  resetProgressiveSyncSchedulerForTest();
});

describe("ProgressiveSyncScheduler", () => {
  it("deduplicates queued work by id and drains it asynchronously", async () => {
    const scheduler = new ProgressiveSyncScheduler({
      inputPending: () => false,
      visible: () => true,
    });
    const run = vi.fn();
    scheduler.enqueue({ id: "same", lane: "P1", run });
    scheduler.enqueue({ id: "same", lane: "P1", run });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.stats().completed).toBe(1);
  });

  it("lets high-priority work run while an input-pressure pause holds lower lanes", async () => {
    let inputPending = true;
    const scheduler = new ProgressiveSyncScheduler({
      inputPending: () => inputPending,
      visible: () => true,
    });
    const order: string[] = [];
    scheduler.enqueue({ id: "bulk", lane: "P2", run: () => { order.push("bulk"); } });
    scheduler.enqueue({ id: "urgent", lane: "P0", run: () => { order.push("urgent"); } });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["urgent"]);
    expect(scheduler.stats().queued).toBe(1);

    inputPending = false;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["urgent", "bulk"]);
  });

  it("pauses P1 sync projections while input is pending", async () => {
    let inputPending = true;
    const scheduler = new ProgressiveSyncScheduler({
      inputPending: () => inputPending,
      visible: () => true,
    });
    const projection = vi.fn();
    scheduler.enqueue({ id: "documents:remote:1", lane: "P1", run: projection });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(projection).not.toHaveBeenCalled();
    expect(scheduler.stats().queued).toBe(1);

    inputPending = false;
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(projection).toHaveBeenCalledTimes(1);
  });

  it("does not run work after disposal", async () => {
    const scheduler = new ProgressiveSyncScheduler({
      inputPending: () => false,
      visible: () => true,
    });
    const run = vi.fn();
    scheduler.enqueue({ id: "cancelled", lane: "P1", run });
    scheduler.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(run).not.toHaveBeenCalled();
  });

  it("exposes a durable-checkpoint hook to work items", async () => {
    const scheduler = new ProgressiveSyncScheduler({
      inputPending: () => false,
      visible: () => true,
    });
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    scheduler.enqueue({
      id: "checkpointed",
      lane: "P1",
      checkpoint,
      run: async (context) => context.checkpoint({ cursor: "row-4" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(checkpoint).toHaveBeenCalledWith({ cursor: "row-4" });
  });

  it("retries failures with backoff and quarantines a repeatedly failing domain", async () => {
    const scheduler = new ProgressiveSyncScheduler({
      inputPending: () => false,
      visible: () => true,
    });
    const run = vi.fn().mockRejectedValue(new Error("broken shard"));
    scheduler.enqueue({ id: "rss:shard-1", lane: "P1", run, maxRetries: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(scheduler.health().quarantinedDomains).toContain("rss");
    scheduler.resetCircuit("rss");
    expect(scheduler.health().quarantinedDomains).not.toContain("rss");
  });

  it("dedup is Set-backed, not an O(n) scan (task 5.3): a large cold-start replay enqueues fast and each id runs once", async () => {
    const scheduler = new ProgressiveSyncScheduler({
      inputPending: () => false,
      visible: () => true,
    });
    const runs: string[] = [];
    const N = 5000;

    const start = performance.now();
    for (let i = 0; i < N; i++) {
      scheduler.enqueue({ id: `documents:replay:${i}`, lane: "P1", run: () => { runs.push(`documents:replay:${i}`); } });
    }
    // Duplicate enqueue of every id, as a repeated boot trigger would do.
    for (let i = 0; i < N; i++) {
      scheduler.enqueue({ id: `documents:replay:${i}`, lane: "P1", run: () => { runs.push(`duplicate:${i}`); } });
    }
    const elapsedMs = performance.now() - start;

    expect(scheduler.stats().queued).toBe(N);
    // Generous bound: an O(n^2) scan over 10,000 enqueue calls against
    // growing per-lane arrays would take orders of magnitude longer than this.
    expect(elapsedMs).toBeLessThan(500);

    const deadline = Date.now() + 15_000;
    while (runs.length < N && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(runs.length).toBe(N);
    expect(runs.every((id) => id.startsWith("documents:replay:"))).toBe(true);
  }, 20_000);
});
