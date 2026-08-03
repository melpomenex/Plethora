import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});

import { registerSyncOutboxPublisher, drainSyncOutboxBatch } from "../sync/syncJournal";

describe("outbox publisher fan-out (task 6.4: dual-run needs both Yjs and delta-log publishers active)", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  it("calls every registered publisher for a domain, not just the most recently registered one", async () => {
    const pendingRow = {
      operation_id: "op-1",
      domain: "documents",
      entity_key: "doc-1",
      operation: "upsert" as const,
      payload: JSON.stringify({ title: "hi" }),
      clock: "0000000000001.000001",
    };
    mocks.invokeCommand.mockImplementation(async (cmd: string) => {
      if (cmd === "get_sync_outbox") return [pendingRow];
      if (cmd === "mark_sync_outbox_sent") return 1;
      return null;
    });

    const yjsCalls: string[] = [];
    const deltaLogCalls: string[] = [];
    const unregisterYjs = registerSyncOutboxPublisher("documents", async (row) => {
      yjsCalls.push(row.entity_key);
    });
    const unregisterDeltaLog = registerSyncOutboxPublisher("documents", async (row) => {
      deltaLogCalls.push(row.entity_key);
    });

    const result = await drainSyncOutboxBatch(10);

    expect(yjsCalls).toEqual(["doc-1"]);
    expect(deltaLogCalls).toEqual(["doc-1"]);
    expect(result.sent).toBe(1);

    unregisterYjs();
    unregisterDeltaLog();
  });

  it("a row is not marked sent if only one of two publishers succeeds (stays pending for retry)", async () => {
    const pendingRow = {
      operation_id: "op-2",
      domain: "documents",
      entity_key: "doc-2",
      operation: "upsert" as const,
      payload: JSON.stringify({ title: "hi" }),
      clock: "0000000000002.000001",
    };
    mocks.invokeCommand.mockImplementation(async (cmd: string) => {
      if (cmd === "get_sync_outbox") return [pendingRow];
      if (cmd === "mark_sync_outbox_sent") return 1;
      return null;
    });

    const unregisterOk = registerSyncOutboxPublisher("documents", async () => {});
    const unregisterFail = registerSyncOutboxPublisher("documents", async () => {
      throw new Error("delta-log unreachable");
    });

    const result = await drainSyncOutboxBatch(10);

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    const deadLetterCall = mocks.invokeCommand.mock.calls.find((c) => c[0] === "dead_letter_sync_operation");
    expect(deadLetterCall).toBeDefined();

    unregisterOk();
    unregisterFail();
  });

  it("unregistering one publisher leaves the other(s) active", async () => {
    const pendingRow = {
      operation_id: "op-3",
      domain: "documents",
      entity_key: "doc-3",
      operation: "upsert" as const,
      payload: null,
      clock: "0000000000003.000001",
    };
    mocks.invokeCommand.mockImplementation(async (cmd: string) => {
      if (cmd === "get_sync_outbox") return [pendingRow];
      if (cmd === "mark_sync_outbox_sent") return 1;
      return null;
    });

    const calls: string[] = [];
    const unregisterA = registerSyncOutboxPublisher("documents", async () => {
      calls.push("a");
    });
    registerSyncOutboxPublisher("documents", async () => {
      calls.push("b");
    });
    unregisterA();

    await drainSyncOutboxBatch(10);
    expect(calls).toEqual(["b"]);
  });
});
