import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});

import {
  computeDomainDigest,
  checkDomainConvergence,
  runVerifyPhase,
  runQuiescePhase,
  retireYjs,
  getCutoverPhase,
  type CutoverPhase,
} from "../sync/cutover";
import { setYjsPublishSuppressed } from "../sync/deltaLog/yjsPublishGate";

function makeCutoverStateStore() {
  const rooms = new Map<string, CutoverPhase>();
  const domainProgress = new Map<string, Map<string, { drained_count: number; seeded_count: number; updated_at: string }>>();
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
        const room = args.room as string;
        const domain = args.domain as string;
        let m = domainProgress.get(room);
        if (!m) { m = new Map(); domainProgress.set(room, m); }
        m.set(domain, {
          drained_count: (args.drainedDelta as number) ?? 0,
          seeded_count: (args.seededDelta as number) ?? 0,
          updated_at: new Date().toISOString(),
        });
        return {};
      }
      if (command === "get_sync_cutover_domain_progress") {
        const room = args.room as string;
        const m = domainProgress.get(room);
        if (!m) return [];
        return Array.from(m.entries()).map(([domain, v]) => ({ room, domain, ...v }));
      }
      return null;
    },
    setPhase(room: string, phase: CutoverPhase) {
      rooms.set(room, phase);
    },
  };
}

describe("computeDomainDigest", () => {
  it("is order-independent", async () => {
    const a = await computeDomainDigest([
      { entityKey: "doc-1", hlc: "0000000000001.000001" },
      { entityKey: "doc-2", hlc: "0000000000002.000001" },
    ]);
    const b = await computeDomainDigest([
      { entityKey: "doc-2", hlc: "0000000000002.000001" },
      { entityKey: "doc-1", hlc: "0000000000001.000001" },
    ]);
    expect(a).toBe(b);
  });

  it("differs when a clock differs", async () => {
    const a = await computeDomainDigest([{ entityKey: "doc-1", hlc: "0000000000001.000001" }]);
    const b = await computeDomainDigest([{ entityKey: "doc-1", hlc: "0000000000002.000001" }]);
    expect(a).not.toBe(b);
  });

  it("differs when the live set differs", async () => {
    const a = await computeDomainDigest([{ entityKey: "doc-1", hlc: "0000000000001.000001" }]);
    const b = await computeDomainDigest([
      { entityKey: "doc-1", hlc: "0000000000001.000001" },
      { entityKey: "doc-2", hlc: "0000000000001.000001" },
    ]);
    expect(a).not.toBe(b);
  });
});

describe("checkDomainConvergence (P4)", () => {
  it("converges when every roster device (other than self) has a matching digest", () => {
    const result = checkDomainConvergence(
      "digest-abc",
      new Map([["device-b", "digest-abc"], ["device-c", "digest-abc"]]),
      ["device-a", "device-b", "device-c"],
      "device-a",
    );
    expect(result.converged).toBe(true);
    expect(result.allRosterDevicesCheckedIn).toBe(true);
    expect(result.missingDigests).toEqual([]);
    expect(result.disagreeing).toEqual([]);
  });

  it("is not converged if a roster device hasn't checked in yet", () => {
    const result = checkDomainConvergence(
      "digest-abc",
      new Map([["device-b", "digest-abc"]]),
      ["device-a", "device-b", "device-c"],
      "device-a",
    );
    expect(result.converged).toBe(false);
    expect(result.allRosterDevicesCheckedIn).toBe(false);
    expect(result.missingDigests).toEqual(["device-c"]);
  });

  it("is not converged if a device's digest disagrees", () => {
    const result = checkDomainConvergence(
      "digest-abc",
      new Map([["device-b", "digest-xyz"]]),
      ["device-a", "device-b"],
      "device-a",
    );
    expect(result.converged).toBe(false);
    expect(result.allRosterDevicesCheckedIn).toBe(true);
    expect(result.disagreeing).toEqual(["device-b"]);
  });
});

describe("runVerifyPhase", () => {
  beforeEach(() => mocks.invokeCommand.mockReset());

  it("advances to verified only when every domain converges", async () => {
    const store = makeCutoverStateStore();
    store.setPhase("room-verify-1", "dual");
    mocks.invokeCommand.mockImplementation(async (cmd, args) => store.handle(cmd, args));

    const converged = { converged: true, allRosterDevicesCheckedIn: true, missingDigests: [], disagreeing: [] };
    const notConverged = { converged: false, allRosterDevicesCheckedIn: false, missingDigests: ["d"], disagreeing: [] };

    const partial = await runVerifyPhase("room-verify-1", { documents: converged, extracts: notConverged });
    expect(partial.allConverged).toBe(false);
    expect(await getCutoverPhase("room-verify-1")).toBe("dual"); // unchanged

    const full = await runVerifyPhase("room-verify-1", { documents: converged, extracts: converged });
    expect(full.allConverged).toBe(true);
    expect(await getCutoverPhase("room-verify-1")).toBe("verified");
  });
});

describe("P6 quiesce", () => {
  beforeEach(() => mocks.invokeCommand.mockReset());

  it("does not advance before the quiesce window has elapsed", async () => {
    const store = makeCutoverStateStore();
    store.setPhase("room-quiesce-1", "cutover");
    mocks.invokeCommand.mockImplementation(async (cmd, args) => {
      if (cmd === "get_sync_cutover_domain_progress") {
        return [{ room: "room-quiesce-1", domain: "__yjs-activity", drained_count: 0, seeded_count: 0, updated_at: new Date().toISOString() }];
      }
      return store.handle(cmd, args);
    });

    const result = await runQuiescePhase("room-quiesce-1");
    expect(result.quiesced).toBe(false);
    expect(await getCutoverPhase("room-quiesce-1")).toBe("cutover");
  });

  it("advances once 14+ days have passed with no recorded Yjs activity", async () => {
    const store = makeCutoverStateStore();
    store.setPhase("room-quiesce-2", "cutover");
    const longAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    mocks.invokeCommand.mockImplementation(async (cmd, args) => {
      if (cmd === "get_sync_cutover_domain_progress") {
        return [{ room: "room-quiesce-2", domain: "__yjs-activity", drained_count: 0, seeded_count: 0, updated_at: longAgo }];
      }
      return store.handle(cmd, args);
    });

    const result = await runQuiescePhase("room-quiesce-2");
    expect(result.quiesced).toBe(true);
    expect(await getCutoverPhase("room-quiesce-2")).toBe("quiesced");
  });

  it("treats no recorded activity at all as fully quiesced", async () => {
    const store = makeCutoverStateStore();
    store.setPhase("room-quiesce-3", "cutover");
    mocks.invokeCommand.mockImplementation(async (cmd, args) => {
      if (cmd === "get_sync_cutover_domain_progress") return [];
      return store.handle(cmd, args);
    });

    const result = await runQuiescePhase("room-quiesce-3");
    expect(result.quiesced).toBe(true);
  });
});

describe("P7 retire", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
    setYjsPublishSuppressed(false);
  });

  it("refuses without explicit user confirmation", async () => {
    await expect(
      retireYjs("room-retire-1", {
        userConfirmed: false,
        backedUp: true,
        deleteIndexedDb: async () => {},
        yjsIndexedDbNames: [],
      }),
    ).rejects.toThrow(/no explicit user confirmation/);
  });

  it("refuses without a completed backup", async () => {
    await expect(
      retireYjs("room-retire-2", {
        userConfirmed: true,
        backedUp: false,
        deleteIndexedDb: async () => {},
        yjsIndexedDbNames: [],
      }),
    ).rejects.toThrow(/no backup was taken/);
  });

  it("refuses if the phase is not yet quiesced", async () => {
    const store = makeCutoverStateStore();
    store.setPhase("room-retire-3", "cutover");
    mocks.invokeCommand.mockImplementation(async (cmd, args) => store.handle(cmd, args));

    await expect(
      retireYjs("room-retire-3", {
        userConfirmed: true,
        backedUp: true,
        deleteIndexedDb: async () => {},
        yjsIndexedDbNames: [],
      }),
    ).rejects.toThrow(/expected "quiesced"/);
  });

  it("drops the named IndexedDB databases and advances to retired when fully confirmed", async () => {
    const store = makeCutoverStateStore();
    store.setPhase("room-retire-4", "quiesced");
    mocks.invokeCommand.mockImplementation(async (cmd, args) => store.handle(cmd, args));

    const deleted: string[] = [];
    await retireYjs("room-retire-4", {
      userConfirmed: true,
      backedUp: true,
      deleteIndexedDb: async (name) => { deleted.push(name); },
      yjsIndexedDbNames: ["incrementum-yjs:room-retire-4"],
    });

    expect(deleted).toEqual(["incrementum-yjs:room-retire-4"]);
    expect(await getCutoverPhase("room-retire-4")).toBe("retired");
  });
});
