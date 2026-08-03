import { describe, it, expect, vi, beforeEach } from "vitest";

/**

 Unit tests for the boot-time cutover orchestrator
 (src/lib/sync/deltaLog/cutoverOrchestrator.ts). These test the PHASE
 SEQUENCING — the orchestrator's actual responsibility — not the transport
 (which is exhaustively covered by deltaLog.validation.test.ts against the
 real server). The delta-log client / pull loop / router / file-manifest are
 mocked so we can drive the orchestrator across multiple simulated boots and
 assert it advances one phase at a time, never past `verified`, and leaves
 the phase unchanged on failure.

*/

// --- hoisted mocks ---------------------------------------------------------
const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  registerRoom: vi.fn(async () => undefined),
  head: vi.fn(async () => ({ head: 0, devices: [] })),
  subscribe: vi.fn(() => ({ close: () => undefined })),
  reportCursor: vi.fn(async () => undefined),
  pullLoop: vi.fn(async () => ({ pagesApplied: 0, finalCursor: 0 })),
  applyDeltaLogPage: vi.fn(async () => undefined),
  push: vi.fn(async () => ({ head: 0 })),
  pull: vi.fn(async () => ({ ops: [], head: 0 })),
  getRoomCursor: vi.fn(async () => 0),
  registerDeltaLogOutboxPublishers: vi.fn(() => () => undefined),
  getCachedSubKeys: vi.fn(),
  getDeviceId: vi.fn(() => "test-device-id"),
  settingsState: { settings: { sync: { yjs: { url: "" } } } } as { settings: { sync: { yjs: { url: string } } } },
  roomId: "test-room-orchestrator",
}));

vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: { getState: () => mocks.settingsState },
}));
vi.mock("../sync/deltaLog/client", () => ({
  registerRoom: mocks.registerRoom,
  head: mocks.head,
  subscribe: mocks.subscribe,
  reportCursor: mocks.reportCursor,
  push: mocks.push,
  pull: mocks.pull,
  DeltaLogHttpError: class extends Error {},
}));
vi.mock("../sync/deltaLog/pullLoop", () => ({ runDeltaLogPullLoop: mocks.pullLoop }));
vi.mock("../sync/deltaLog/router", () => ({ applyDeltaLogPage: mocks.applyDeltaLogPage }));
vi.mock("../sync/deltaLog/checkpoints", () => ({
  getRoomCursor: mocks.getRoomCursor,
  setRoomCursor: vi.fn(async () => undefined),
  resetDeltaLogCursors: vi.fn(async () => undefined),
  ROOM_CURSOR_DOMAIN: "deltaLog:room",
}));
vi.mock("../sync/deltaLog/outboxPublisher", () => ({
  registerDeltaLogOutboxPublishers: mocks.registerDeltaLogOutboxPublishers,
}));
vi.mock("../sync/roomCrypto", () => ({ getCachedSubKeys: mocks.getCachedSubKeys }));
vi.mock("../file-manifest", () => ({ getDeviceId: mocks.getDeviceId }));
vi.mock("../yjsSync", () => ({ getSyncRoomId: () => mocks.roomId }));

import { runCutoverOrchestrator, __resetCutoverOrchestratorForTest } from "../sync/deltaLog/cutoverOrchestrator";
import { __clearCutoverTargetsForTest, registerCutoverDrainTarget } from "../sync/cutoverTargets";
import { __resetSyncFeatureFlagsForTest, getSyncFeatureFlags } from "../sync/featureFlags";
import { resetProgressiveSyncSchedulerForTest } from "../sync/progressiveScheduler";

const ROOM = "test-room-orchestrator";
const SUB_KEYS = { manifestAuthKey: {} as CryptoKey } as never;

/** Set feature flags by writing the localStorage key the flag reader uses. */
function setFlags(flags: { deltaLogSync?: boolean; journaledProjection?: boolean }): void {
  const current = getSyncFeatureFlags();
  const merged = {
    ...current,
    deltaLogSync: flags.deltaLogSync ?? false,
    journaledProjection: flags.journaledProjection ?? false,
  };
  localStorage.setItem("incrementum.sync.feature-flags", JSON.stringify(merged));
}

/** Drive a per-room cutover state store backed by an in-memory map. */
function makeCutoverStateStore() {
  const rooms = new Map<string, string>();
  return {
    handle(command: string, args: Record<string, unknown>) {
      if (command === "get_sync_cutover_state") {
        const phase = rooms.get(args.room as string);
        return phase ? { room: args.room, phase, updated_at: "now" } : null;
      }
      if (command === "set_sync_cutover_state") {
        rooms.set(args.room as string, args.phase as string);
        return { room: args.room, phase: args.phase, updated_at: "now" };
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
      if (command === "count_sync_dead_letters_since") return 0;
      if (command === "enqueue_sync_outbox") return { operation_id: "op-" + Math.random() };
      if (command === "get_sync_checkpoint") return null;
      if (command === "set_sync_checkpoint") return null;
      if (command === "get_all_learning_item_clocks") return {};
      if (command === "get_all_document_clocks") return {};
      return null;
    },
    setPhase(room: string, phase: string) {
      rooms.set(room, phase);
    },
    getPhase(room: string) {
      return rooms.get(room) ?? "not_started";
    },
  };
}

describe("cutover orchestrator", () => {
  let store: ReturnType<typeof makeCutoverStateStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetCutoverOrchestratorForTest();
    __clearCutoverTargetsForTest();
    __resetSyncFeatureFlagsForTest();
    resetProgressiveSyncSchedulerForTest();
    localStorage.clear();
    store = makeCutoverStateStore();
    mocks.invokeCommand.mockImplementation(async (cmd: string, args: Record<string, unknown>) =>
      store.handle(cmd, args),
    );
    mocks.getCachedSubKeys.mockResolvedValue(SUB_KEYS);
    // The settings store reads sync.yjs.url; provide one via the real store.
    mocks.getDeviceId.mockReturnValue("test-device-id");
    mocks.settingsState.settings.sync.yjs.url = "";
    // Register one drain target so the drain phase has something to enumerate.
    registerCutoverDrainTarget({
      domain: "documents",
      ensureReady: async () => undefined,
      count: () => 0,
    });
  });

  function setSyncUrl(url: string): void {
    // The orchestrator reads settings.sync.yjs.url via the settings store's
    // getState(); the store is mocked to return this object, so setting the
    // url is a direct assignment to the mock state.
    mocks.settingsState.settings.sync.yjs.url = url;
  }

  it("is a complete no-op when deltaLogSync is off", async () => {
    setFlags({ deltaLogSync: false });
    setSyncUrl("wss://sync.readsync.org");
    const phase = await runCutoverOrchestrator();
    expect(phase).toBeNull();
    expect(mocks.registerRoom).not.toHaveBeenCalled();
    expect(mocks.pullLoop).not.toHaveBeenCalled();
  });

  it("falls back to the default sync URL when none is configured (no longer returns null)", async () => {
    setFlags({ deltaLogSync: true });
    // no setSyncUrl -> settings.sync.yjs.url is "". The orchestrator now
    // falls back to "wss://sync.readsync.org" (the same default SyncSettings
    // applies), so it proceeds to register rather than no-op'ing.
    const phase = await runCutoverOrchestrator();
    expect(phase).not.toBeNull();
    expect(mocks.registerRoom).toHaveBeenCalled();
  }, 15000);

  it("returns null when room registration (TOFU) fails", async () => {
    setFlags({ deltaLogSync: true });
    setSyncUrl("wss://sync.readsync.org");
    mocks.registerRoom.mockRejectedValueOnce(new Error("401"));
    const phase = await runCutoverOrchestrator();
    expect(phase).toBeNull();
    // Transport should NOT have started if registration failed.
    expect(mocks.pullLoop).not.toHaveBeenCalled();
  });

  it("advances not_started → drained → seeded → dual → verified across boots", async () => {
    setFlags({ deltaLogSync: true });
    setSyncUrl("wss://sync.readsync.org");
    // Provide a converging verify: head returns a roster containing only this
    // device, and the pull returns this device's own digest for each domain.
    mocks.head.mockResolvedValue({
      head: 1,
      devices: [{ deviceTag: btoa("test-device-id"), cursor: 0, seenAt: 0, presenceBlob: null }],
    });

    // Boot 1: not_started -> drained
    expect(store.getPhase(ROOM)).toBe("not_started");
    let phase = await runCutoverOrchestrator();
    expect(phase).toBe("drained");
    expect(store.getPhase(ROOM)).toBe("drained");

    // Boot 2: drained -> seeded
    __resetCutoverOrchestratorForTest();
    phase = await runCutoverOrchestrator();
    expect(phase).toBe("seeded");
    expect(store.getPhase(ROOM)).toBe("seeded");

    // Boot 3: seeded -> dual
    __resetCutoverOrchestratorForTest();
    phase = await runCutoverOrchestrator();
    expect(phase).toBe("dual");
    expect(store.getPhase(ROOM)).toBe("dual");

    // Boot 4: dual -> verified
    __resetCutoverOrchestratorForTest();
    phase = await runCutoverOrchestrator();
    expect(phase).toBe("verified");
    expect(store.getPhase(ROOM)).toBe("verified");
  }, 40000);

  it("leaves the phase unchanged when a phase step throws (retry-next-boot safety)", async () => {
    setFlags({ deltaLogSync: true });
    setSyncUrl("wss://sync.readsync.org");
    // The drain phase (not_started → drained) awaits every target's
    // ensureReady() via Promise.all. Make the registered drain target reject:
    // that propagates out of runDrainPhase → advanceOnePhase, whose catch
    // must return the entry phase rather than advancing.
    store.setPhase(ROOM, "not_started");
    __clearCutoverTargetsForTest();
    registerCutoverDrainTarget({
      domain: "documents",
      ensureReady: async () => {
        throw new Error("replicated map init failed");
      },
      count: () => 0,
    });

    const phase = await runCutoverOrchestrator();
    // Drain failed -> phase unchanged, retry next boot.
    expect(phase).toBe("not_started");
    expect(store.getPhase(ROOM)).toBe("not_started");
  });

  it("never auto-advances the destructive/user-driven phases (verified, quiesced, retired stay put)", async () => {
    setFlags({ deltaLogSync: true });
    setSyncUrl("wss://sync.readsync.org");
    // verified: P5 "Finish migration" is a user action — never auto-advanced.
    // quiesced: P6 done; only P7 (user-confirmed retire) follows.
    // retired: terminal.
    // (cutover → quiesced IS auto-advanced by the time-based P6 check, so it
    // is exercised separately below, not asserted as "stays put".)
    for (const entry of ["verified", "quiesced", "retired"] as const) {
      store.setPhase(ROOM, entry);
      __resetCutoverOrchestratorForTest();
      const phase = await runCutoverOrchestrator();
      expect(phase).toBe(entry);
      expect(store.getPhase(ROOM)).toBe(entry);
    }
  });

  it("auto-advances cutover → quiesced once Yjs has been idle (P6 time-based check)", async () => {
    setFlags({ deltaLogSync: true });
    setSyncUrl("wss://sync.readsync.org");
    store.setPhase(ROOM, "cutover");
    // No __yjs-activity recorded → daysSinceLastYjsActivity = Infinity >= 14.
    const phase = await runCutoverOrchestrator();
    expect(phase).toBe("quiesced");
    expect(store.getPhase(ROOM)).toBe("quiesced");
  });

  it("starts the transport exactly once per session (idempotent)", async () => {
    setFlags({ deltaLogSync: true });
    setSyncUrl("wss://sync.readsync.org");
    store.setPhase(ROOM, "verified"); // no phase advance, but transport should start
    await runCutoverOrchestrator();
    await runCutoverOrchestrator(); // second call same session
    expect(mocks.registerRoom).toHaveBeenCalledTimes(2); // called each boot
    // But the transport (pull loop / subscribe) only starts once.
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(mocks.registerDeltaLogOutboxPublishers).toHaveBeenCalledTimes(1);
  });
});
