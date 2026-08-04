import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});

import { createProjector, mergeFieldLww } from "../sync/projector";

interface Row {
  id: string;
  title: string;
  updatedAt: string;
}

interface FieldLwwRow {
  id: string;
  read: boolean;
  readAt: string;
  queued: boolean;
  queuedAt: string;
  updatedAt: string;
}

describe("projector (transport-neutral, task 5.1/5.2)", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  it("row-lww: applies a remote row identically whether it arrived via Yjs or would arrive via delta-log", async () => {
    const applied: Array<[string, Row]> = [];
    const projector = createProjector<Row>({
      name: "documents",
      label: "documents",
      apply: async (key, row) => {
        applied.push([key, row]);
      },
    });

    // handleRemote takes an already-decrypted value directly — this is
    // exactly what a delta-log decode would hand it (envelope.ts::decodeOp),
    // and exactly what the Yjs adapter now hands it via state.map.get(key).
    // There is nothing transport-specific left for the projector to depend on.
    const remote: Row = { id: "doc-1", title: "hello", updatedAt: "0000000000001.000001" };
    await projector.handleRemote("doc-1", remote);

    expect(applied).toEqual([["doc-1", remote]]);
  });

  it("row-lww: a remote row not newer than local is skipped (echo guard)", async () => {
    const applied: Array<[string, Row]> = [];
    const projector = createProjector<Row>({
      name: "documents",
      label: "documents",
      apply: async (key, row) => {
        applied.push([key, row]);
      },
      getLocal: async () => ({ id: "doc-1", title: "local", updatedAt: "0000000000005.000001" }),
    });

    const staleRemote: Row = { id: "doc-1", title: "stale", updatedAt: "0000000000001.000001" };
    await projector.handleRemote("doc-1", staleRemote);

    expect(applied).toEqual([]);
  });

  it("row-lww: idempotent re-delivery of the same clock applies exactly once", async () => {
    const applied: Array<[string, Row]> = [];
    const projector = createProjector<Row>({
      name: "documents",
      label: "documents",
      apply: async (key, row) => {
        applied.push([key, row]);
      },
    });

    const remote: Row = { id: "doc-1", title: "hello", updatedAt: "0000000000001.000001" };
    await projector.handleRemote("doc-1", remote);
    await projector.handleRemote("doc-1", remote); // re-delivery, e.g. a duplicate page or replay

    expect(applied.length).toBe(1);
  });

  it("propagates an apply failure so the transport can defer the row instead of advancing past it", async () => {
    const projector = createProjector<Row>({
      name: "extracts",
      label: "extracts",
      apply: async () => {
        throw new Error("FOREIGN KEY constraint failed");
      },
    });

    const remote: Row = {
      id: "extract-1",
      title: "child",
      updatedAt: "0000000000001.000001",
    };
    await expect(projector.handleRemote("extract-1", remote)).rejects.toThrow(
      "FOREIGN KEY constraint failed",
    );
  });

  it("row-lww: a tombstone deletes once and blocks a stale resurrecting update", async () => {
    const appliedDeletes: string[] = [];
    const applied: Array<[string, Row]> = [];
    const projector = createProjector<Row>({
      name: "documents",
      label: "documents",
      apply: async (key, row) => {
        applied.push([key, row]);
      },
      applyDelete: async (key) => {
        appliedDeletes.push(key);
      },
    });

    // Simulate a Tombstoned<T> value the way tombstone.ts shapes it (the
    // same object writeTombstone() would produce, whichever transport wrote it).
    const stored = { _deleted: true, deletedAt: "0000000000005.000001" } as unknown as Row & { deletedAt: string };

    await projector.handleRemote("doc-1", stored as never);
    expect(appliedDeletes).toEqual(["doc-1"]);

    // Re-delivering the same tombstone must not delete twice.
    await projector.handleRemote("doc-1", stored as never);
    expect(appliedDeletes.length).toBe(1);

    // A stale (older-clock) upsert arriving after the tombstone must not resurrect it.
    const staleUpsert: Row = { id: "doc-1", title: "resurrected?", updatedAt: "0000000000001.000001" };
    await projector.handleRemote("doc-1", staleUpsert);
    expect(applied).toEqual([]);
  });

  it("field-lww: merges per-field, matching mergeFieldLww directly", async () => {
    const applied: Array<[string, FieldLwwRow]> = [];
    const local: FieldLwwRow = {
      id: "art-1",
      read: false,
      readAt: "0000000000001.000001",
      queued: true,
      queuedAt: "0000000000003.000001",
      updatedAt: "0000000000003.000001",
    };
    const remote: FieldLwwRow = {
      id: "art-1",
      read: true,
      readAt: "0000000000005.000001", // newer than local's readAt
      queued: false,
      queuedAt: "0000000000002.000001", // older than local's queuedAt
      updatedAt: "0000000000002.000001",
    };
    const projector = createProjector<FieldLwwRow>({
      name: "rssArticlesState",
      label: "rssArticlesState",
      mode: "field-lww",
      fieldClocks: [
        ["read", "readAt"],
        ["queued", "queuedAt"],
      ],
      apply: async (key, row) => {
        applied.push([key, row]);
      },
      getLocal: async () => local,
    });

    await projector.handleRemote("art-1", remote);

    const expectedMerge = mergeFieldLww(local, remote, [
      ["read", "readAt"],
      ["queued", "queuedAt"],
    ]);
    expect(applied).toEqual([["art-1", expectedMerge]]);
    // read comes from remote (newer readAt), queued stays local (newer queuedAt).
    expect(applied[0][1].read).toBe(true);
    expect(applied[0][1].queued).toBe(true);
  });

  it("append-only: always upserts by key regardless of local state, dedupes only by clock", async () => {
    interface ReviewRow { id: string; rating: number; updatedAt: string }
    const applied: Array<[string, ReviewRow]> = [];
    const projector = createProjector<ReviewRow>({
      name: "reviews",
      label: "reviews",
      mode: "append-only",
      apply: async (key, row) => {
        applied.push([key, row]);
      },
    });

    const review1: ReviewRow = { id: "rev-1", rating: 3, updatedAt: "0000000000001.000001" };
    const review2: ReviewRow = { id: "rev-2", rating: 4, updatedAt: "0000000000002.000001" };
    await projector.handleRemote("rev-1", review1);
    await projector.handleRemote("rev-2", review2);
    // Re-delivery of the same review (same key, same clock) must not duplicate.
    await projector.handleRemote("rev-1", review1);

    expect(applied).toEqual([
      ["rev-1", review1],
      ["rev-2", review2],
    ]);
  });

  it("append-only with applyBatch: batches concurrent deliveries into one apply", async () => {
    interface ReviewRow { id: string; rating: number; updatedAt: string }
    const batchCalls: Array<Array<[string, ReviewRow]>> = [];
    const projector = createProjector<ReviewRow>({
      name: "reviews",
      label: "reviews",
      mode: "append-only",
      apply: async () => {
        throw new Error("apply should not be called when applyBatch succeeds");
      },
      applyBatch: async (rows) => {
        batchCalls.push(rows);
      },
    });

    const review1: ReviewRow = { id: "rev-1", rating: 3, updatedAt: "0000000000001.000001" };
    const review2: ReviewRow = { id: "rev-2", rating: 4, updatedAt: "0000000000002.000001" };
    await projector.handleRemote("rev-1", review1);
    await projector.handleRemote("rev-2", review2);
    await projector.flushBatch();

    expect(batchCalls.length).toBe(1);
    expect(batchCalls[0]).toEqual([
      ["rev-1", review1],
      ["rev-2", review2],
    ]);
  });

  it("handleRemote(key, undefined) is a no-op — matches the original 'absent' guard", async () => {
    const applied: unknown[] = [];
    const projector = createProjector<Row>({
      name: "documents",
      label: "documents",
      apply: async (...args) => {
        applied.push(args);
      },
    });
    await projector.handleRemote("doc-1", undefined);
    expect(applied).toEqual([]);
  });

  it("reset() clears applied-state so a room switch doesn't leak echo-guard clocks across rooms", async () => {
    const applied: Array<[string, Row]> = [];
    const projector = createProjector<Row>({
      name: "documents",
      label: "documents",
      apply: async (key, row) => {
        applied.push([key, row]);
      },
    });

    const remote: Row = { id: "doc-1", title: "room-a", updatedAt: "0000000000005.000001" };
    await projector.handleRemote("doc-1", remote);
    expect(applied.length).toBe(1);

    projector.reset();

    // Same key, same (or even lower) clock in a *different* room's context —
    // without reset() this would be silently skipped as a stale re-delivery.
    const sameKeyDifferentRoom: Row = { id: "doc-1", title: "room-b", updatedAt: "0000000000001.000001" };
    await projector.handleRemote("doc-1", sameKeyDifferentRoom);
    expect(applied.length).toBe(2);
    expect(projector.appliedClocks.size).toBe(1);
  });
});
