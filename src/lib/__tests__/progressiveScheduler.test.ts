import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProgressiveSyncScheduler,
  getProgressiveSyncScheduler,
  resetProgressiveSyncSchedulerForTest,
  scheduleProgressiveSyncWork,
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

  it("dedup is Set-backed, not an O(n) scan (task 5.3): a large cold-start replay queues each id once", async () => {
    const scheduler = new ProgressiveSyncScheduler({
      inputPending: () => false,
      visible: () => true,
    });
    const runs: string[] = [];
    const N = 5000;

    for (let i = 0; i < N; i++) {
      scheduler.enqueue({ id: `documents:replay:${i}`, lane: "P1", run: () => { runs.push(`documents:replay:${i}`); } });
    }
    // Duplicate enqueue of every id, as a repeated boot trigger would do.
    for (let i = 0; i < N; i++) {
      scheduler.enqueue({ id: `documents:replay:${i}`, lane: "P1", run: () => { runs.push(`duplicate:${i}`); } });
    }

    expect(scheduler.stats().queued).toBe(N);

    const deadline = Date.now() + 15_000;
    while (runs.length < N && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(runs.length).toBe(N);
    expect(runs.every((id) => id.startsWith("documents:replay:"))).toBe(true);
  }, 20_000);

  it("rejects instead of hanging when an enqueue is dropped (quarantine / duplicate id)", async () => {
    // A dropped enqueue means run() is never called. Before this guarantee the
    // returned promise stayed pending forever, so `await
    // scheduleProgressiveSyncWork(...)` on the boot chain hung with no error.
    const scheduler = getProgressiveSyncScheduler();

    let release: (() => void) | null = null;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = scheduleProgressiveSyncWork({
      id: "boot-step",
      lane: "P0",
      run: () => blocked,
    });
    // Same id while the first is still queued/running.
    await expect(
      scheduleProgressiveSyncWork({ id: "boot-step", lane: "P0", run: () => undefined }),
    ).rejects.toMatchObject({ name: "SchedulerDroppedError", reason: "duplicate" });
    release!();
    await first;

    scheduler.enqueue({ id: "walled:x", lane: "P1", run: () => { throw new Error("boom"); }, maxRetries: 0 });
    const deadline = Date.now() + 5000;
    while (!scheduler.health().quarantinedDomains.includes("walled") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(scheduler.health().quarantinedDomains).toContain("walled");
    await expect(
      scheduleProgressiveSyncWork({ id: "walled:y", lane: "P0", run: () => "never" }),
    ).rejects.toMatchObject({ name: "SchedulerDroppedError", reason: "quarantined" });
  }, 15_000);

  it("signals shouldYield to a running low-lane item once higher-priority work is queued", async () => {
    // A sliceable item that loops until its own work is exhausted holds the
    // drain loop, starving every other lane -- this is what kept the P0 boot
    // items from ever running while the encrypted-frame replay was draining.
    const scheduler = new ProgressiveSyncScheduler({
      inputPending: () => false,
      visible: () => true,
    });

    let sawPreemption = false;
    let p0Ran = false;
    const lowLaneDone = new Promise<void>((resolve) => {
      scheduler.enqueue({
        id: "replay:frames",
        lane: "P1",
        kind: "sliceable",
        run: async (context) => {
          for (let i = 0; i < 200; i++) {
            if (i === 5) scheduler.enqueue({ id: "boot-critical", lane: "P0", run: () => { p0Ran = true; } });
            if (i > 5 && context.shouldYield()) { sawPreemption = true; break; }
            await Promise.resolve();
          }
          resolve();
        },
      });
    });

    await lowLaneDone;
    expect(sawPreemption).toBe(true);

    const deadline = Date.now() + 5000;
    while (!p0Ran && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    expect(p0Ran).toBe(true);
  }, 15_000);

  it("still drains when the host never invokes a posted task (Android WebView background-priority black hole)", async () => {
    // Measured on Android WebView 150: scheduler.postTask with priority
    // "background" never runs its callback while the page has work. The
    // `scheduled` latch then wedged the whole scheduler permanently.
    const w = window as unknown as { scheduler?: { postTask: (cb: () => void, o?: unknown) => Promise<unknown> } };
    const original = w.scheduler;
    const posted: Array<() => void> = [];
    w.scheduler = { postTask: (cb) => { posted.push(cb); return new Promise(() => {}); } };
    try {
      const scheduler = new ProgressiveSyncScheduler({ inputPending: () => false, visible: () => true });
      const run = vi.fn();
      scheduler.enqueue({ id: "boot-critical", lane: "P0", run });

      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(posted.length).toBeGreaterThan(0); // the host was asked...
      expect(run).toHaveBeenCalledTimes(1); // ...and the watchdog ran it anyway
      expect(scheduler.stats().queued).toBe(0);
    } finally {
      if (original) w.scheduler = original;
      else delete w.scheduler;
    }
  }, 10_000);
});
