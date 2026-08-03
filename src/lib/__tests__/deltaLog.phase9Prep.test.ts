import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";

/**

 Phase 9 prep correctness tests (migrate-sync-to-delta-log).

 These assert the two properties that make a future Yjs deletion safe:
   1. The entity publish path enqueues to the durable outbox EVEN WHEN the
      Yjs map is not bound (state.map null) — previously the enqueue sat
      after `if (!state.map) return` and silently dropped every write.
   2. FileManifest reads return data after a simulated restart, hydrated
      from the SQLite projection (migration 069) — so the manifest survives
      without the Yjs document.

 Together these mean "delete Yjs" no longer breaks entity writes or file-
 manifest reads; only file-BYTE transport remains Yjs-coupled (called out
 in HANDOFF.md).

*/

// --- shared mocks ----------------------------------------------------------
const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  getYjsSync: vi.fn(),
}));

vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});
vi.mock("../yjsSync", () => ({
  getYjsSync: mocks.getYjsSync,
  getSyncRoomId: () => "prep-test-room",
  registerRoomChangeListener: () => () => undefined,
}));

import { createReplicatedMap } from "../sync/replicatedMap";
import { FileManifest, type FileManifestEntry } from "../file-manifest";
import { getDomainHandler } from "../sync/deltaLog/domainRegistry";
import { __resetSyncFeatureFlagsForTest } from "../sync/featureFlags";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invokeCommand.mockResolvedValue(null);
  mocks.getYjsSync.mockResolvedValue({
    doc: new Y.Doc(),
    provider: {},
    persistence: null,
    url: "wss://test",
    room: "prep-test-room",
    encrypted: false,
    visibilityCleanup: null,
  });
  __resetSyncFeatureFlagsForTest();
  localStorage.clear();
  localStorage.setItem("incrementum_device_id", "device-prep");
  // Enable journaledProjection so the outbox enqueue path is active.
  localStorage.setItem("incrementum.sync.feature-flags", JSON.stringify({ journaledProjection: true }));
});

// --- 1. publish() enqueues without a bound Yjs map -------------------------

describe("Phase 9 prep: entity publish survives without a Yjs map", () => {
  it("createReplicatedMap.publish enqueues to the outbox even when getYjsSync returns a doc with no map bound", async () => {
    // Force getYjsSync to reject so ensureReady() never binds state.map.
    // (ensureReady catches and leaves state.map null.) The publish path must
    // still reach enqueueSyncOperation BEFORE the map null-check.
    mocks.getYjsSync.mockRejectedValue(new Error("yjs unavailable"));
    mocks.invokeCommand.mockResolvedValue({ operation_id: "op-1" });

    const map = createReplicatedMap<{ id: string; updatedAt: string }>({
      name: "learningItems",
      label: "prep-test",
      mode: "row-lww",
      clockField: "updatedAt",
      apply: async () => undefined,
    });

    await map.publish("card-1", { id: "card-1", updatedAt: "0000000000001.000001" });

    const enqueueCall = mocks.invokeCommand.mock.calls.find(
      (c) => c[0] === "enqueue_sync_outbox" && (c[1] as { entityKey: string }).entityKey === "card-1",
    );
    // The core Phase-9-prep property: the write reached the durable outbox
    // despite the Yjs map never binding. Without the restructure this was
    // silently dropped after `if (!state.map) return`.
    expect(enqueueCall).toBeDefined();
    expect((enqueueCall![1] as { domain: string }).domain).toBe("learningItems");
    expect((enqueueCall![1] as { operation: string }).operation).toBe("upsert");
  });

  it("createReplicatedMap.delete enqueues a tombstone even when getYjsSync rejects", async () => {
    mocks.getYjsSync.mockRejectedValue(new Error("yjs unavailable"));
    mocks.invokeCommand.mockResolvedValue({ operation_id: "op-2" });

    const map = createReplicatedMap<{ id: string; updatedAt: string }>({
      name: "learningItems",
      label: "prep-test-del",
      mode: "row-lww",
      clockField: "updatedAt",
      apply: async () => undefined,
    });

    await map.delete("card-9");

    const enqueueCall = mocks.invokeCommand.mock.calls.find(
      (c) => c[0] === "enqueue_sync_outbox" && (c[1] as { entityKey: string }).entityKey === "card-9",
    );
    expect(enqueueCall).toBeDefined();
    expect((enqueueCall![1] as { operation: string }).operation).toBe("delete");
  });
});

// --- 2. FileManifest survives a restart via SQLite hydration ----------------

describe("Phase 9 prep: FileManifest survives restart via SQLite projection", () => {
  function makeEntry(id: string): FileManifestEntry {
    return {
      id,
      room: "prep-test-room",
      filename: "book.epub",
      contentType: "application/epub+zip",
      sizeBytes: 1024,
      contentHash: "hash-" + id,
      uploadedAt: new Date().toISOString(),
      uploadedBy: "device-prep",
    };
  }

  it("an entry added then SQLite-hydrated is readable from a fresh manifest with no Yjs data", async () => {
    // Simulate "session 1": a manifest receives an entry via the delta-log
    // domain handler (the apply path), which projects it into SQLite.
    // (The manifest instance's only purpose here is to register the handler
    // that performs the projection; we don't read from it.)
    new FileManifest(new Y.Doc());
    const handler = getDomainHandler("fileManifest")!;
    await handler("file-restart", makeEntry("file-restart"));

    // The upsert into the SQLite projection was issued.
    const upsertCall = mocks.invokeCommand.mock.calls.find(
      (c) => c[0] === "upsert_synced_file_manifest" && (c[1] as { entry: { id: string } }).entry.id === "file-restart",
    );
    expect(upsertCall).toBeDefined();

    // Simulate "session 2" (after restart): a brand-new manifest with an EMPTY
    // Yjs doc hydrates its cache from SQLite. The projection returns the row,
    // so getFile returns the entry even though the Yjs map is empty.
    const storedRows = [makeEntry("file-restart")];
    mocks.invokeCommand.mockImplementation(async (cmd: string) => {
      if (cmd === "get_file_manifest_entries") return storedRows;
      return null;
    });

    const session2 = new FileManifest(new Y.Doc());
    await session2.hydrateFromSqlite();

    const recovered = session2.getFile("file-restart");
    // The core Phase-9-prep property: the manifest entry survived a restart
    // via the SQLite projection, with zero help from the Yjs document.
    expect(recovered).not.toBeNull();
    expect(recovered!.id).toBe("file-restart");
    expect(recovered!.contentHash).toBe("hash-file-restart");
  });

  it("getAllFiles merges the cache with Yjs-only entries so neither transport's data is hidden", async () => {
    const manifest = new FileManifest(new Y.Doc());

    // One entry arrives over the Yjs map directly (not via the handler/cache).
    const yjsEntry = makeEntry("file-yjs");
    (manifest as unknown as { filesMap: Y.Map<Record<string, unknown>> }).filesMap.set("file-yjs", yjsEntry as unknown as Record<string, unknown>);
    // One entry arrives via the delta-log handler (cache + SQLite).
    const handler = getDomainHandler("fileManifest")!;
    await handler("file-cache", makeEntry("file-cache"));

    const all = manifest.getAllFiles();
    const ids = all.map((e) => e.id).sort();
    expect(ids).toEqual(["file-cache", "file-yjs"]);
  });
});
