import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn() }));
vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});

import { FileManifest, type FileManifestEntry } from "../file-manifest";
import { getDomainHandler } from "../sync/deltaLog/domainRegistry";
import { getSyncFeatureFlags, __resetSyncFeatureFlagsForTest } from "../sync/featureFlags";

const DEVICE_ID_KEY = "incrementum_device_id";

function makeEntry(id: string): FileManifestEntry {
  return {
    id,
    room: "room-1",
    filename: "book.epub",
    contentType: "application/epub+zip",
    sizeBytes: 1024,
    contentHash: "abc123",
    uploadedAt: new Date().toISOString(),
    uploadedBy: "device-local",
  };
}

describe("FileManifest delta-log integration (task 5.6)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(DEVICE_ID_KEY, "device-local");
    mocks.invokeCommand.mockReset();
    __resetSyncFeatureFlagsForTest();
  });

  it("registers a 'fileManifest' domain handler that applies a remote entry into filesMap", async () => {
    const manifest = new FileManifest(new Y.Doc());
    const handler = getDomainHandler("fileManifest");
    expect(handler).toBeDefined();

    const entry = makeEntry("file-99");
    await handler!("file-99", entry);

    expect(manifest.getFile("file-99")).toEqual(entry);
  });

  it("the fileManifest handler deletes on a tombstone-shaped remote value", async () => {
    const manifest = new FileManifest(new Y.Doc());
    manifest.addFile(makeEntry("file-1"));
    expect(manifest.getFile("file-1")).not.toBeNull();

    const handler = getDomainHandler("fileManifest")!;
    await handler("file-1", { _deleted: true, deletedAt: "0000000000001.000001" });

    expect(manifest.getFile("file-1")).toBeNull();
  });

  it("addFile enqueues a journaled outbox op for the fileManifest domain when journaledProjection is on", () => {
    localStorage.setItem(
      "incrementum.sync.feature-flags",
      JSON.stringify({ journaledProjection: true }),
    );
    expect(getSyncFeatureFlags().journaledProjection).toBe(true);

    const manifest = new FileManifest(new Y.Doc());
    manifest.addFile(makeEntry("file-2"));

    const call = mocks.invokeCommand.mock.calls.find(
      (c) => c[0] === "enqueue_sync_outbox" && (c[1] as { entityKey: string }).entityKey === "file-2",
    );
    expect(call).toBeDefined();
    expect((call![1] as { domain: string }).domain).toBe("fileManifest");
  });

  it("removeFile enqueues a delete outbox op when journaledProjection is on", () => {
    localStorage.setItem(
      "incrementum.sync.feature-flags",
      JSON.stringify({ journaledProjection: true }),
    );
    const manifest = new FileManifest(new Y.Doc());
    manifest.addFile(makeEntry("file-3"));
    mocks.invokeCommand.mockClear();

    manifest.removeFile("file-3");

    const call = mocks.invokeCommand.mock.calls.find(
      (c) => c[0] === "enqueue_sync_outbox" && (c[1] as { entityKey: string }).entityKey === "file-3",
    );
    expect(call).toBeDefined();
    expect((call![1] as { operation: string }).operation).toBe("delete");
  });
});
