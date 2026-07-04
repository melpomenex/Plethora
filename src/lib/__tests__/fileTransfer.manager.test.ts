import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { FileManifest } from "../file-manifest";
import { FileTransferManager } from "../file-transfer";
import type { WebsocketProvider } from "y-websocket";

// requestFile() tries the HTTP file-service before falling back to the P2P
// chunked path this test exercises. Without this mock, the real fetch() runs
// against a non-existent server in the test env: it rejects asynchronously,
// so the P2P transfer record (which the test reads synchronously right after
// calling requestFile) hasn't been created yet → `inbound[0]` is undefined.
// Mocking the file-service download to reject makes requestFile fall through
// to the P2P path synchronously, preserving the test's original intent.
vi.mock("../yjs-file-service", () => ({
  downloadRoomFile: vi.fn().mockRejectedValue(new Error("no file-service in tests")),
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
    // requestFile() first awaits the HTTP file-service download (mocked to
    // reject above), then falls back to the P2P path that registers the
    // inbound transfer. Yield to let that await settle before reading state.
    await Promise.resolve();
    await Promise.resolve();
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
});
