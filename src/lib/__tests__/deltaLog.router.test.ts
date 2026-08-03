import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});

import { deriveRoomKey, deriveSubKeys } from "../sync/encryption";
import { registerDomainHandler, __clearDomainHandlersForTest } from "../sync/deltaLog/domainRegistry";
import { applyDeltaLogPage } from "../sync/deltaLog/router";
import { buildOp } from "../sync/deltaLog/envelope";
import type { DeltaLogOpRow } from "../sync/deltaLog/client";
import { createProjector } from "../sync/projector";

describe("deltaLog domain registry + router (task 5.4)", () => {
  beforeEach(() => {
    __clearDomainHandlersForTest();
    mocks.invokeCommand.mockReset();
  });

  it("registerDomainHandler/getDomainHandler round-trip and unregister removes it", async () => {
    const { getDomainHandler } = await import("../sync/deltaLog/domainRegistry");
    const calls: Array<[string, unknown]> = [];
    const unregister = registerDomainHandler("documents", async (key, remote) => {
      calls.push([key, remote]);
    });
    expect(getDomainHandler("documents")).toBeDefined();
    await getDomainHandler("documents")!("doc-1", { title: "x" });
    expect(calls).toEqual([["doc-1", { title: "x" }]]);

    unregister();
    expect(getDomainHandler("documents")).toBeUndefined();
  });

  it("dispatches a decoded upsert op to the registered handler for its domain", async () => {
    const roomKey = await deriveRoomKey("secret", "room-router-1");
    const subKeys = await deriveSubKeys(roomKey, "room-router-1");

    const applied: Array<[string, unknown]> = [];
    registerDomainHandler("documents", async (key, remote) => {
      applied.push([key, remote]);
    });

    const op = await buildOp(
      { domain: "documents", entityKey: "doc-1", operation: "upsert", row: { title: "hi" } },
      "0000000000001.000001",
      subKeys,
    );
    const opRow: DeltaLogOpRow = { seq: 1, ...op };

    await applyDeltaLogPage([opRow], subKeys);

    expect(applied).toEqual([["doc-1", { title: "hi" }]]);
  });

  it("reconstructs a tombstone value for a delete op", async () => {
    const roomKey = await deriveRoomKey("secret", "room-router-2");
    const subKeys = await deriveSubKeys(roomKey, "room-router-2");

    const applied: Array<[string, unknown]> = [];
    registerDomainHandler("documents", async (key, remote) => {
      applied.push([key, remote]);
    });

    const op = await buildOp(
      { domain: "documents", entityKey: "doc-1", operation: "delete", row: null },
      "0000000000002.000001",
      subKeys,
    );
    const opRow: DeltaLogOpRow = { seq: 1, ...op };

    await applyDeltaLogPage([opRow], subKeys);

    expect(applied.length).toBe(1);
    expect(applied[0][0]).toBe("doc-1");
    expect(applied[0][1]).toEqual({ _deleted: true, deletedAt: "0000000000002.000001" });
  });

  it("drops an op for an unregistered domain instead of throwing", async () => {
    const roomKey = await deriveRoomKey("secret", "room-router-3");
    const subKeys = await deriveSubKeys(roomKey, "room-router-3");

    const op = await buildOp(
      { domain: "someFutureDomain", entityKey: "x", operation: "upsert", row: { a: 1 } },
      "0000000000001.000001",
      subKeys,
    );
    const opRow: DeltaLogOpRow = { seq: 1, ...op };

    await expect(applyDeltaLogPage([opRow], subKeys)).resolves.toBeUndefined();
  });

  it("a projector registered via createReplicatedMap-style wiring receives delta-log ops through the SAME instance as the Yjs path — proving dual-run double-delivery is a no-op", async () => {
    const roomKey = await deriveRoomKey("secret", "room-router-dualrun");
    const subKeys = await deriveSubKeys(roomKey, "room-router-dualrun");

    interface Row { id: string; title: string; updatedAt: string }
    const applied: Array<[string, Row]> = [];
    const projector = createProjector<Row>({
      name: "documents",
      label: "documents",
      apply: async (key, row) => {
        applied.push([key, row]);
      },
    });
    registerDomainHandler("documents", (key, remote) => projector.handleRemote(key, remote as never));

    const row: Row = { id: "doc-1", title: "hi", updatedAt: "0000000000001.000001" };

    // Simulate the Yjs path delivering this row directly to the projector...
    await projector.handleRemote("doc-1", row);
    // ...and the delta-log path delivering the SAME logical write (identical
    // clock) via a pulled op, as would happen during P3 dual-run.
    const op = await buildOp({ domain: "documents", entityKey: "doc-1", operation: "upsert", row }, row.updatedAt, subKeys);
    await applyDeltaLogPage([{ seq: 1, ...op }], subKeys);

    // Applied exactly once — the second delivery is a no-op via appliedClocks.
    expect(applied.length).toBe(1);
  });
});
