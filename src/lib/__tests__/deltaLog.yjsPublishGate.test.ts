import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});
vi.mock("../yjsSync", () => ({
  getYjsSync: vi.fn(),
  registerRoomChangeListener: () => () => {},
}));

import { isYjsPublishSuppressed, setYjsPublishSuppressed } from "../sync/deltaLog/yjsPublishGate";
import { createReplicatedMap } from "../sync/replicatedMap";

function makeFakeMap() {
  const store = new Map<string, unknown>();
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => store.set(k, v),
    delete: (k: string) => store.delete(k),
    has: (k: string) => store.has(k),
    get size() {
      return store.size;
    },
    forEach: (fn: (v: unknown, k: string) => void) => store.forEach(fn),
    observe: () => {},
    doc: {},
  };
}

describe("yjsPublishGate (task 6.6, P5 cutover)", () => {
  afterEach(() => {
    setYjsPublishSuppressed(false);
  });

  it("defaults to not suppressed", () => {
    expect(isYjsPublishSuppressed()).toBe(false);
  });

  it("createReplicatedMap.publish skips the Yjs map.set when suppressed", async () => {
    const { getYjsSync } = await import("../yjsSync");
    const map = makeFakeMap();
    (getYjsSync as ReturnType<typeof vi.fn>).mockResolvedValue({ doc: { getMap: () => map } });
    mocks.invokeCommand.mockResolvedValue({});

    interface Row { id: string; updatedAt: string }
    const replicated = createReplicatedMap<Row>({
      name: "testDomainGate",
      label: "testDomainGate",
      apply: async () => {},
    });

    setYjsPublishSuppressed(true);
    await replicated.publish("row-1", { id: "row-1", updatedAt: "0000000000001.000001" });
    expect(map.get("row-1")).toBeUndefined();

    setYjsPublishSuppressed(false);
    await replicated.publish("row-2", { id: "row-2", updatedAt: "0000000000002.000001" });
    expect(map.get("row-2")).toEqual({ id: "row-2", updatedAt: "0000000000002.000001" });

    replicated.teardown();
  });

  it("rollback (task 6.8): un-suppressing after P5 cutover immediately restores Yjs writes — nothing about suppression is one-way before P7", async () => {
    const { getYjsSync } = await import("../yjsSync");
    const map = makeFakeMap();
    (getYjsSync as ReturnType<typeof vi.fn>).mockResolvedValue({ doc: { getMap: () => map } });
    mocks.invokeCommand.mockResolvedValue({});

    interface Row { id: string; updatedAt: string }
    const replicated = createReplicatedMap<Row>({
      name: "testDomainRollback",
      label: "testDomainRollback",
      apply: async () => {},
    });

    // Simulate P5 cutover: Yjs publishing suppressed.
    setYjsPublishSuppressed(true);
    await replicated.publish("row-a", { id: "row-a", updatedAt: "0000000000001.000001" });
    expect(map.has("row-a")).toBe(false);

    // Rollback: flip the flag back before P7 retire. Nothing in this module
    // deleted Yjs data — it was only skipped, so a plain flag flip is a
    // complete rollback with no reconstruction step needed.
    setYjsPublishSuppressed(false);
    await replicated.publish("row-a", { id: "row-a", updatedAt: "0000000000002.000001" });
    expect(map.get("row-a")).toEqual({ id: "row-a", updatedAt: "0000000000002.000001" });

    replicated.teardown();
  });
});
