import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { FileManifest } from "../file-manifest";
import { decodeFileTransferFrame, FileTransferManager } from "../file-transfer";
import type { WebsocketProvider } from "y-websocket";

vi.mock("../yjs-file-service", () => ({
  downloadRoomFile: vi.fn().mockRejectedValue(new Error("not on file service")),
  getSyncRoomId: vi.fn().mockReturnValue("test-room"),
}));

const DEVICE_ID_KEY = "incrementum_device_id";

function makeProvider() {
  const ws = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    onmessage: null as ((event: MessageEvent) => void) | null,
  };
  return {
    ws,
    awareness: { on: vi.fn() },
    on: vi.fn(),
  } as unknown as WebsocketProvider & { ws: typeof ws };
}

function setPeerWithFile(doc: Y.Doc, fileId: string): void {
  const devices = doc.getMap("devicePresence") as Y.Map<Record<string, unknown>>;
  devices.set("device-peer", {
    deviceId: "device-peer",
    lastSeen: new Date().toISOString(),
    hasFiles: [fileId],
  });
}

describe("FileTransferManager downloads", () => {
  let manager: FileTransferManager | null = null;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(DEVICE_ID_KEY, "device-local");
  });

  afterEach(() => {
    manager?.dispose();
    manager = null;
  });

  it("uses the source response chunk count when assembling a received file", async () => {
    const doc = new Y.Doc();
    const manifest = new FileManifest(doc);
    setPeerWithFile(doc, "file-1");
    manager = new FileTransferManager(makeProvider(), manifest);

    const download = manager.requestFile("file-1");
    await vi.waitFor(() => {
      expect(manager?.getActiveTransfers().inbound[0]).toBeTruthy();
    });
    const transfer = manager.getActiveTransfers().inbound[0];
    expect(transfer).toBeTruthy();

    const internals = manager as unknown as {
      handleFileResponse: (msg: { type: "file-response"; requestId: string; accepted: boolean; totalChunks: number }) => void;
      handleFileChunk: (msg: {
        type: "file-chunk";
        requestId: string;
        chunkIndex: number;
        totalChunks: number;
        data: Uint8Array;
      }) => void;
    };

    internals.handleFileResponse({
      type: "file-response",
      requestId: transfer.requestId,
      accepted: true,
      totalChunks: 1,
    });
    internals.handleFileChunk({
      type: "file-chunk",
      requestId: transfer.requestId,
      chunkIndex: 0,
      totalChunks: 1,
      data: new Uint8Array([1, 2, 3]),
    });

    const blob = await download;
    expect(blob.size).toBe(3);
  });

  it("keeps registry presence stable across byte eviction and reloads an evicted file", async () => {
    const provider = makeProvider();
    const doc = new Y.Doc();
    const manifest = new FileManifest(doc);
    manager = new FileTransferManager(provider, manifest);
    const internals = manager as unknown as {
      blobCache: Map<string, Blob>;
      blobCacheByteLimit: number;
      cacheBlob: (fileId: string, blob: Blob) => void;
      resolveLocalBlob: (fileId: string) => Promise<Blob | null>;
      allOwnedFileIds: () => string[];
    };
    Object.defineProperty(internals, "blobCacheByteLimit", { configurable: true, value: 3 });
    const reload = vi.fn(async () => new Blob(["aa"]));
    manager.registerLocalFileLoader("file-a", reload);
    manager.registerLocalFileLoader("file-b", async () => new Blob(["bb"]));
    const advertisedBefore = internals.allOwnedFileIds().sort();

    internals.cacheBlob("file-a", new Blob(["aa"]));
    internals.cacheBlob("file-b", new Blob(["bb"]));
    expect(internals.blobCache.has("file-a")).toBe(false);
    expect(internals.allOwnedFileIds().sort()).toEqual(advertisedBefore);

    const reloaded = await internals.resolveLocalBlob("file-a");
    expect(reloaded?.size).toBe(2);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(internals.allOwnedFileIds().sort()).toEqual(advertisedBefore);
  });

  it("reports empty loaders as a normal file-error and does not hang the requester", async () => {
    const provider = makeProvider();
    const doc = new Y.Doc();
    const manifest = new FileManifest(doc);
    manager = new FileTransferManager(provider, manifest);
    manager.registerLocalFileLoader("empty-file", async () => new Blob());

    const internals = manager as unknown as {
      handleFileRequest: (message: {
        type: "file-request";
        fileId: string;
        requesterDeviceId: string;
        requestId: string;
      }) => void;
    };
    internals.handleFileRequest({
      type: "file-request",
      fileId: "empty-file",
      requesterDeviceId: "device-peer",
      requestId: "request-empty",
    });

    await vi.waitFor(() => {
      expect(provider.ws.send).toHaveBeenCalled();
    });
    const frame = provider.ws.send.mock.calls.at(-1)?.[0];
    expect(frame).toBeInstanceOf(Uint8Array);
    expect(decodeFileTransferFrame(frame as Uint8Array)).toMatchObject({
      type: "file-error",
      requestId: "request-empty",
    });
    expect(manager.hasFileLocal("empty-file")).toBe(false);
  });

  it("serves a file larger than the byte cap without retaining it", async () => {
    const doc = new Y.Doc();
    const manifest = new FileManifest(doc);
    manager = new FileTransferManager(makeProvider(), manifest);
    const internals = manager as unknown as {
      blobCache: Map<string, Blob>;
      blobCacheByteLimit: number;
      resolveLocalBlob: (fileId: string) => Promise<Blob | null>;
    };
    Object.defineProperty(internals, "blobCacheByteLimit", { configurable: true, value: 1 });
    manager.registerLocalFileLoader("large-file", async () => new Blob(["large"]));

    const blob = await internals.resolveLocalBlob("large-file");
    expect(blob?.size).toBe(5);
    expect(internals.blobCache.has("large-file")).toBe(false);
    expect(manager.hasFileLocal("large-file")).toBe(true);
  });
});
