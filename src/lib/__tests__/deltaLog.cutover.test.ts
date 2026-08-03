import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});

import {
  canAdvancePhase,
  getCutoverPhase,
  advanceCutoverPhase,
  isRollbackSafe,
  runDrainPhase,
  runSeedPhase,
  type CutoverPhase,
  type DrainTarget,
  type SeedTarget,
} from "../sync/cutover";

function makeCutoverStateStore() {
  const rooms = new Map<string, CutoverPhase>();
  return {
    handle(command: string, args: Record<string, unknown>) {
      if (command === "get_sync_cutover_state") {
        const room = args.room as string;
        const phase = rooms.get(room);
        return phase ? { room, phase, updated_at: "now" } : null;
      }
      if (command === "set_sync_cutover_state") {
        const room = args.room as string;
        rooms.set(room, args.phase as CutoverPhase);
        return { room, phase: args.phase, updated_at: "now" };
      }
      if (command === "record_sync_cutover_domain_progress") {
        return {
          room: args.room,
          domain: args.domain,
          drained_count: args.drainedDelta,
          seeded_count: args.seededDelta,
          updated_at: "now",
        };
      }
      if (command === "count_sync_dead_letters_since") {
        return 0;
      }
      return null;
    },
  };
}

describe("cutover phase machine (task 6.1)", () => {
  it("canAdvancePhase only allows a single forward step", () => {
    expect(canAdvancePhase("not_started", "drained")).toBe(true);
    expect(canAdvancePhase("drained", "seeded")).toBe(true);
    expect(canAdvancePhase("not_started", "seeded")).toBe(false); // skips a phase
    expect(canAdvancePhase("seeded", "drained")).toBe(false); // backwards
    expect(canAdvancePhase("retired", "not_started")).toBe(false);
  });

  it("isRollbackSafe is true for every phase except retired", () => {
    const all: CutoverPhase[] = [
      "not_started", "drained", "seeded", "dual", "verified", "cutover", "quiesced",
    ];
    for (const phase of all) expect(isRollbackSafe(phase)).toBe(true);
    expect(isRollbackSafe("retired")).toBe(false);
  });

  it("getCutoverPhase defaults to not_started; advanceCutoverPhase persists and reads back", async () => {
    const store = makeCutoverStateStore();
    mocks.invokeCommand.mockImplementation(async (cmd, args) => store.handle(cmd, args));

    expect(await getCutoverPhase("room-1")).toBe("not_started");
    await advanceCutoverPhase("room-1", "drained");
    expect(await getCutoverPhase("room-1")).toBe("drained");
  });

  it("advanceCutoverPhase throws rather than silently skipping a phase", async () => {
    const store = makeCutoverStateStore();
    mocks.invokeCommand.mockImplementation(async (cmd, args) => store.handle(cmd, args));

    await expect(advanceCutoverPhase("room-2", "seeded")).rejects.toThrow(/cannot advance/);
  });
});

describe("P1 drain (task 6.2)", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  it("advances to drained when the scheduler quiesces with zero dead-letters", async () => {
    const store = makeCutoverStateStore();
    mocks.invokeCommand.mockImplementation(async (cmd, args) => store.handle(cmd, args));

    const ensureReadyCalls: string[] = [];
    const targets: DrainTarget[] = [
      { domain: "documents", ensureReady: async () => { ensureReadyCalls.push("documents"); }, count: () => 10 },
      { domain: "learningItems", ensureReady: async () => { ensureReadyCalls.push("learningItems"); }, count: () => 42 },
    ];

    const result = await runDrainPhase(
      "room-drain-1",
      targets,
      () => ({ queued: 0, running: false }),
      { pollIntervalMs: 5, timeoutMs: 200 },
    );

    expect(ensureReadyCalls.sort()).toEqual(["documents", "learningItems"]);
    expect(result.outcome).toBe("drained");
    expect(result.perDomainCounts).toEqual({ documents: 10, learningItems: 42 });
    expect(await getCutoverPhase("room-drain-1")).toBe("drained");
  });

  it("advances past a perpetually-busy scheduler: global-idle gate removed — a shared scheduler that never empties no longer blocks the drain, as long as no dead-letters were recorded", async () => {
    const store = makeCutoverStateStore();
    mocks.invokeCommand.mockImplementation(async (cmd, args) => store.handle(cmd, args));

    const targets: DrainTarget[] = [
      { domain: "documents", ensureReady: async () => {}, count: () => 5 },
    ];

    const result = await runDrainPhase(
      "room-drain-2",
      targets,
      () => ({ queued: 3, running: true }), // perpetually busy (replicators/hydration)
      { pollIntervalMs: 5, timeoutMs: 30 },
    );

    // The drain now advances after the settle period regardless of global
    // scheduler state — the old global-idle gate could never be satisfied on
    // a real library (the scheduler is shared with replicators + hydration).
    // Dead-letters are the only thing that blocks advancement.
    expect(result.outcome).toBe("drained");
    expect(result.quiesced).toBe(true);
    expect(await getCutoverPhase("room-drain-2")).toBe("drained");
  });

  it("does not advance the phase if any dead-letter was recorded during the drain window", async () => {
    const store = makeCutoverStateStore();
    mocks.invokeCommand.mockImplementation(async (cmd, args) => {
      if (cmd === "count_sync_dead_letters_since") return 2;
      return store.handle(cmd, args);
    });

    const targets: DrainTarget[] = [
      { domain: "documents", ensureReady: async () => {}, count: () => 5 },
    ];

    const result = await runDrainPhase(
      "room-drain-3",
      targets,
      () => ({ queued: 0, running: false }),
      { pollIntervalMs: 5, timeoutMs: 100 },
    );

    expect(result.outcome).toBe("retry");
    expect(result.deadLetterCount).toBe(2);
    expect(await getCutoverPhase("room-drain-3")).toBe("not_started");
  });
});

describe("P2 seed (task 6.3)", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  it("enqueues each SQLite row carrying its existing hlc verbatim, then advances to seeded", async () => {
    const store = makeCutoverStateStore();
    store.handle("set_sync_cutover_state", { room: "room-seed-1", phase: "drained" });
    mocks.invokeCommand.mockImplementation(async (cmd, args) => store.handle(cmd, args));

    const targets: SeedTarget[] = [
      {
        domain: "documents",
        readAllRows: async () => [
          { entityKey: "doc-1", hlc: "0000000000001.000001", operation: "upsert", payload: { title: "a" } },
          { entityKey: "doc-2", hlc: "0000000000002.000001", operation: "upsert", payload: { title: "b" } },
        ],
      },
    ];

    const enqueued: Array<{ entityKey: string; clock: string }> = [];
    const enqueue = async (op: { entityKey: string; clock: string }) => {
      enqueued.push({ entityKey: op.entityKey, clock: op.clock });
    };

    const result = await runSeedPhase("room-seed-1", targets, enqueue);

    expect(enqueued).toEqual([
      { entityKey: "doc-1", clock: "0000000000001.000001" },
      { entityKey: "doc-2", clock: "0000000000002.000001" },
    ]);
    expect(result.perDomainCounts).toEqual({ documents: 2 });
    expect(await getCutoverPhase("room-seed-1")).toBe("seeded");
  });

  it("re-running the seed is idempotent at the enqueue level: identical rows produce identical ops", async () => {
    const store = makeCutoverStateStore();
    store.handle("set_sync_cutover_state", { room: "room-seed-2", phase: "drained" });
    mocks.invokeCommand.mockImplementation(async (cmd, args) => store.handle(cmd, args));

    const rows = [{ entityKey: "doc-1", hlc: "0000000000001.000001", operation: "upsert" as const, payload: { title: "a" } }];
    const targets: SeedTarget[] = [{ domain: "documents", readAllRows: async () => rows }];

    const enqueuedRuns: Array<Array<{ entityKey: string; clock: string }>> = [[], []];
    for (let run = 0; run < 2; run++) {
      // Reset phase to "drained" so the second run's advanceCutoverPhase("seeded")
      // doesn't hit the "already seeded" transition guard — a real caller
      // would only ever call this once per boot, but the point under test is
      // that the SAME rows produce the SAME ops regardless of run count.
      store.handle("set_sync_cutover_state", { room: "room-seed-2", phase: "drained" });
      await runSeedPhase("room-seed-2", targets, async (op) => {
        enqueuedRuns[run].push({ entityKey: op.entityKey, clock: op.clock });
      });
    }

    expect(enqueuedRuns[0]).toEqual(enqueuedRuns[1]);
  });
});
