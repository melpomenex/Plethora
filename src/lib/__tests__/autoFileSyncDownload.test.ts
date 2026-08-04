import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const documentState = {
    documents: [] as Array<Record<string, unknown>>,
    currentDocument: null as Record<string, unknown> | null,
  };
  let documentListener: ((state: typeof documentState) => void) | null = null;
  const entries: Array<Record<string, unknown>> = [];
  const requestFile = vi.fn(async () => new Blob(["bytes"]));
  const transferManager = {
    hasFileLocal: vi.fn(() => false),
    requestFile,
  };
  const manifest = {
    subscribe: vi.fn(() => () => undefined),
    getAllFiles: vi.fn(() => entries),
    getDeviceId: vi.fn(() => "device-local"),
    getFile: vi.fn((fileId: string) => entries.find((entry) => entry.id === fileId) ?? null),
    isFileAvailable: vi.fn(() => false),
  };
  return {
    documentState,
    getDocumentListener: () => documentListener,
    setDocumentListener: (listener: typeof documentListener) => {
      documentListener = listener;
    },
    entries,
    durableDocuments: [] as Array<Record<string, unknown>>,
    requestFile,
    transferManager,
    manifest,
    saveReceivedFileSync: vi.fn(async () => "/received/book.epub"),
  };
});

vi.mock("../useFileSync", () => ({
  ensureFileSyncReady: vi.fn(async () => undefined),
  getFileManifest: () => mocks.manifest,
  getFileTransferManager: () => mocks.transferManager,
}));

vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ settings: { sync: { autoDownloadMode: "always" } } }),
  },
}));

vi.mock("../../stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => mocks.documentState,
    subscribe: (listener: (state: typeof mocks.documentState) => void) => {
      mocks.setDocumentListener(listener);
      return () => mocks.setDocumentListener(null);
    },
    setState: (
      updater:
        | Partial<typeof mocks.documentState>
        | ((state: typeof mocks.documentState) => Partial<typeof mocks.documentState>),
    ) => {
      Object.assign(
        mocks.documentState,
        typeof updater === "function" ? updater(mocks.documentState) : updater,
      );
    },
  },
}));

vi.mock("../yjsSync", () => ({
  registerRoomChangeListener: vi.fn(() => () => undefined),
}));

vi.mock("../sync/fileAvailabilityIntent", () => ({
  ensureFileAvailabilityIntentReady: vi.fn(async () => undefined),
  listActiveFileAvailabilityIntents: vi.fn(async () => []),
  selectQueuePrefetchDocuments: vi.fn(() => []),
  subscribeFileAvailabilityIntent: vi.fn(() => () => undefined),
  syncQueueFileAvailabilityIntents: vi.fn(async () => undefined),
}));

vi.mock("../sync/progressiveScheduler", () => ({
  scheduleProgressiveSyncWork: vi.fn(async (item: { run: (context: unknown) => unknown }) =>
    item.run({ shouldYield: () => false, yield: async () => undefined }),
  ),
}));

vi.mock("../fileSyncRegistration", () => ({
  saveReceivedFileSync: mocks.saveReceivedFileSync,
}));

vi.mock("../../api/documents", () => ({
  getDocuments: vi.fn(async () => mocks.durableDocuments),
}));

import { startAutoFileSyncDownload } from "../autoFileSyncDownload";

function makeDocument(id: string, fileId: string) {
  return { id, fileId, fileType: "epub", title: `Book ${id}` };
}

function makeManifestEntry(id: string) {
  return {
    id,
    room: "room-1",
    filename: `${id}.epub`,
    contentType: "application/epub+zip",
    sizeBytes: 5,
    contentHash: `hash-${id}`,
    uploadedAt: "2026-08-03T00:00:00.000Z",
    uploadedBy: "device-peer",
  };
}

describe("auto file sync manifest reconciliation", () => {
  beforeEach(() => {
    mocks.requestFile.mockClear();
    mocks.saveReceivedFileSync.mockClear();
    mocks.entries.splice(0, mocks.entries.length);
    mocks.durableDocuments.splice(0, mocks.durableDocuments.length);
    mocks.documentState.documents = [];
    mocks.documentState.currentDocument = null;
    mocks.setDocumentListener(null);
  });

  it("downloads hydrated manifest entries and retains entries whose documents arrive later", async () => {
    mocks.entries.push(
      makeManifestEntry("file-ready"),
      makeManifestEntry("file-durable"),
      makeManifestEntry("file-late"),
    );
    mocks.documentState.documents = [makeDocument("doc-ready", "file-ready")];
    mocks.durableDocuments.push(makeDocument("doc-durable", "file-durable"));

    await startAutoFileSyncDownload();

    await vi.waitFor(() => {
      expect(mocks.requestFile).toHaveBeenCalledWith("file-ready");
      expect(mocks.requestFile).toHaveBeenCalledWith("file-durable");
    });
    expect(mocks.requestFile).not.toHaveBeenCalledWith("file-late");

    mocks.documentState.documents = [
      ...mocks.documentState.documents,
      makeDocument("doc-late", "file-late"),
    ];
    mocks.getDocumentListener()?.(mocks.documentState);

    await vi.waitFor(() => {
      expect(mocks.requestFile).toHaveBeenCalledWith("file-late");
    });
    expect(mocks.saveReceivedFileSync).toHaveBeenCalledTimes(3);
  });
});
