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

  it("defers an op for an unregistered domain instead of dropping it, and applies it once the handler registers", async () => {
    const roomKey = await deriveRoomKey("secret", "room-router-3");
    const subKeys = await deriveSubKeys(roomKey, "room-router-3");

    const pending = new Map<string, Record<string, unknown>>();
    mocks.invokeCommand.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "record_sync_inbox") {
        pending.set(String(args?.operationId), {
          operation_id: String(args?.operationId),
          domain: String(args?.domain),
          entity_key: String(args?.entityKey),
          operation: args?.operation,
          payload: String(args?.payload),
        });
        return true;
      }
      if (command === "get_pending_sync_inbox") return [...pending.values()];
      if (command === "mark_sync_inbox_applied") {
        pending.delete(String(args?.operationId));
        return true;
      }
      return null;
    });

    const op = await buildOp(
      { domain: "documents", entityKey: "doc-late", operation: "upsert", row: { a: 1 } },
      "0000000000001.000001",
      subKeys,
    );
    const opRow: DeltaLogOpRow = { seq: 1, ...op };

    // Simulates the real failure: the pull ran before documentReplication.ts
    // had been imported, so no handler existed for the domain yet.
    await expect(applyDeltaLogPage([opRow], subKeys)).resolves.toBeUndefined();
    expect([...pending.values()]).toHaveLength(1);
    expect([...pending.values()][0].domain).toBe("documents");

    // The cursor has already advanced past this op — the only way it can still
    // land is the durable inbox retry.
    const applied: Array<[string, unknown]> = [];
    registerDomainHandler("documents", async (key, remote) => {
      applied.push([key, remote]);
    });
    const { replayPendingDeltaLogInbox } = await import("../sync/deltaLog/router");
    await replayPendingDeltaLogInbox();

    expect(applied).toEqual([["doc-late", { a: 1 }]]);
    expect(pending.size).toBe(0);
  });

  it("keeps a genuinely unknown future domain pending rather than stalling the page", async () => {
    const roomKey = await deriveRoomKey("secret", "room-router-3b");
    const subKeys = await deriveSubKeys(roomKey, "room-router-3b");

    const pending = new Map<string, Record<string, unknown>>();
    mocks.invokeCommand.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "record_sync_inbox") {
        pending.set(String(args?.operationId), {
          operation_id: String(args?.operationId),
          domain: String(args?.domain),
          entity_key: String(args?.entityKey),
          operation: args?.operation,
          payload: String(args?.payload),
        });
        return true;
      }
      if (command === "get_pending_sync_inbox") return [...pending.values()];
      return null;
    });

    const op = await buildOp(
      { domain: "someFutureDomain", entityKey: "x", operation: "upsert", row: { a: 1 } },
      "0000000000001.000001",
      subKeys,
    );

    await expect(applyDeltaLogPage([{ seq: 1, ...op }], subKeys)).resolves.toBeUndefined();
    expect(pending.size).toBe(1);
  });

  it("never defers reserved control-plane domains (__verify digests have no projection)", async () => {
    const roomKey = await deriveRoomKey("secret", "room-router-3c");
    const subKeys = await deriveSubKeys(roomKey, "room-router-3c");

    const recorded: unknown[] = [];
    mocks.invokeCommand.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "record_sync_inbox") { recorded.push(args); return true; }
      if (command === "get_pending_sync_inbox") return [];
      return null;
    });

    // __verify ops are published once per device per domain on every verify
    // run; deferring them would grow sync_inbox without bound and re-run on
    // every page for the rest of the session.
    const op = await buildOp(
      { domain: "__verify", entityKey: "documents:deviceA", operation: "append", row: { digest: "abc" } },
      "0000000000001.000001",
      subKeys,
    );

    await expect(applyDeltaLogPage([{ seq: 1, ...op }], subKeys)).resolves.toBeUndefined();
    expect(recorded).toHaveLength(0);
  });

  it("durably defers a child projection until its parent applies, then retries it before advancing", async () => {
    const roomKey = await deriveRoomKey("secret", "room-router-dependency");
    const subKeys = await deriveSubKeys(roomKey, "room-router-dependency");
    const pending: Array<{
      operation_id: string;
      domain: string;
      entity_key: string;
      operation: "upsert";
      payload: string;
    }> = [];
    mocks.invokeCommand.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "record_sync_inbox") {
        pending.push({
          operation_id: String(args?.operationId),
          domain: String(args?.domain),
          entity_key: String(args?.entityKey),
          operation: "upsert",
          payload: String(args?.payload),
        });
        return true;
      }
      if (command === "get_pending_sync_inbox") return [...pending];
      if (command === "mark_sync_inbox_applied") {
        const index = pending.findIndex((row) => row.operation_id === args?.operationId);
        if (index >= 0) pending.splice(index, 1);
        return true;
      }
      return null;
    });

    let parentApplied = false;
    const calls: string[] = [];
    registerDomainHandler("extracts", async () => {
      calls.push("extract");
      if (!parentApplied) throw new Error("FOREIGN KEY constraint failed");
    });
    registerDomainHandler("documents", async () => {
      calls.push("document");
      parentApplied = true;
    });

    const extract = await buildOp(
      {
        domain: "extracts",
        entityKey: "extract-1",
        operation: "upsert",
        row: { id: "extract-1", document_id: "doc-1" },
      },
      "0000000000001.000001",
      subKeys,
    );
    const document = await buildOp(
      {
        domain: "documents",
        entityKey: "doc-1",
        operation: "upsert",
        row: { id: "doc-1", title: "Parent" },
      },
      "0000000000002.000001",
      subKeys,
    );

    await applyDeltaLogPage(
      [
        { seq: 1, ...extract },
        { seq: 2, ...document },
      ],
      subKeys,
    );

    expect(calls).toEqual(["extract", "document", "extract"]);
    expect(pending).toEqual([]);
    expect(mocks.invokeCommand).toHaveBeenCalledWith(
      "record_sync_inbox",
      expect.objectContaining({ domain: "extracts", entityKey: "extract-1" }),
    );
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
