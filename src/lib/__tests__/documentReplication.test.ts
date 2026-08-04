import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/**
 * Tests for document replication conflict resolution.
 *
 * The shared yjs 'documents' map is attached once (module singleton); each
 * test writes a distinct doc id so the observer handles them independently
 * without needing module re-import. This validates the core fix — remote
 * document rows upsert into local SQLite — plus the dateModified conflict rule.
 */

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  getYjsSync: vi.fn(),
  loadDocuments: vi.fn().mockResolvedValue(undefined),
  localDocuments: [] as import("../../types").Document[],
  getDocument: vi.fn(),
  getDocuments: vi.fn(),
}));

vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});
vi.mock("../yjsSync", () => ({ getYjsSync: mocks.getYjsSync, getSyncRoomId: () => "test-room" }));
vi.mock("../../stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      // Defensive: handlers may run async after test cleanup; always return an array.
      documents: mocks.localDocuments ?? [],
      loadDocuments: mocks.loadDocuments,
    }),
    setState: vi.fn(),
  },
}));
vi.mock("../../api/documents", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../api/documents")>();
  return {
    ...original,
    getDocument: mocks.getDocument,
    getDocuments: mocks.getDocuments,
  };
});

import type { Document } from "../../types";

let map: ReturnType<typeof makeFakeMap>;

function makeFakeMap() {
  const store = new Map<string, Document>();
  const observers: Array<(e: { keysChanged: Set<string> }) => void> = [];
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: Document) => { store.set(k, v); observers.forEach((fn) => fn({ keysChanged: new Set([k]) })); },
    forEach: (fn: (v: Document, k: string) => void) => store.forEach(fn),
    observe: (fn: (e: { keysChanged: Set<string> }) => void) => observers.push(fn),
  };
}

function makeDoc(id: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    title: `${id}.epub`,
    filePath: `/data/${id}.epub`,
    fileType: "epub",
    tags: [],
    dateAdded: "2026-01-01T00:00:00.000Z",
    dateModified: "2026-01-01T00:00:00.000Z",
    extractCount: 0, learningItemCount: 0, priorityRating: 0, prioritySlider: 0, priorityScore: 0,
    isArchived: false, isFavorite: false,
    ...overrides,
  };
}

beforeAll(async () => {
  map = makeFakeMap();
  mocks.getYjsSync.mockResolvedValue({ doc: { getMap: () => map } });
  mocks.invokeCommand.mockResolvedValue({});
  const { ensureDocumentReplicationReady } = await import("../documentReplication");
  await ensureDocumentReplicationReady();
});

// Reset per-test shared state without re-importing the module (the observer
// singleton must persist). localDocuments defaults to empty each test.
beforeEach(() => {
  vi.clearAllMocks();
  mocks.invokeCommand.mockResolvedValue({});
  mocks.getDocument.mockResolvedValue(null);
  mocks.getDocuments.mockResolvedValue([]);
  mocks.localDocuments = [];
});

describe("documentReplication conflict resolution", () => {
  it("upserts a brand-new remote doc into local SQLite", async () => {
    map.set("doc-new", makeDoc("doc-new"));

    await vi.waitFor(() => {
      const calls = mocks.invokeCommand.mock.calls.filter(
        (c) => (c[1] as { document: Document }).document?.id === "doc-new",
      );
      expect(calls.length).toBe(1);
    });
  });

  it("normalizes an older partial sync row to the complete Rust Document contract", async () => {
    map.set("doc-legacy", {
      id: "doc-legacy",
      title: "Legacy document",
      fileType: "epub",
      dateAdded: "2025-04-03T02:01:00Z",
      metadata: { fileId: "legacy-file-id" },
      currentViewState: { page: 7, zoom: 1.25 },
    } as unknown as Document);

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) =>
          c[0] === "upsert_synced_document" &&
          (c[1] as { document: Document }).document?.id === "doc-legacy",
      );
      expect(call).toBeTruthy();
      const doc = (call![1] as { document: Document }).document;
      expect(doc).toMatchObject({
        collectionId: "00000000-0000-0000-0000-000000000001",
        filePath: "",
        tags: [],
        extractCount: 0,
        learningItemCount: 0,
        priorityRating: 0,
        prioritySlider: 0,
        priorityScore: 0,
        priorityExplicitlySet: false,
        isArchived: false,
        isFavorite: false,
        isDismissed: false,
        readingCount: 0,
        fileId: "legacy-file-id",
        metadata: { fileId: "legacy-file-id" },
      });
      expect(doc.dateAdded).toBe("2025-04-03T02:01:00.000Z");
      expect(doc.dateModified).toBe("2025-04-03T02:01:00.000Z");
      expect(doc.currentViewState).toBe('{"page":7,"zoom":1.25}');
    });
  });

  it("preserves a local SQLite filePath when the store has not loaded yet", async () => {
    mocks.getDocument.mockResolvedValueOnce(makeDoc("doc-sqlite", {
      filePath: "/local/doc-sqlite.epub",
      dateModified: "2026-01-01T00:00:00.000Z",
    }));

    map.set("doc-sqlite", makeDoc("doc-sqlite", {
      filePath: "/remote/doc-sqlite.epub",
      dateModified: "2026-06-01T00:00:00.000Z",
    }));

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) => (c[1] as { document: Document }).document?.id === "doc-sqlite",
      );
      expect((call?.[1] as { document: Document }).document.filePath).toBe("/local/doc-sqlite.epub");
    });
  });

  it("does NOT upsert a remote doc older than the local copy", async () => {
    mocks.localDocuments = [makeDoc("doc-skip", { dateModified: "2026-06-01T00:00:00.000Z" })];
    map.set("doc-skip", makeDoc("doc-skip", { dateModified: "2026-01-01T00:00:00.000Z" }));

    // Give the async handler time to (not) run.
    await new Promise((r) => setTimeout(r, 100));
    const calls = mocks.invokeCommand.mock.calls.filter(
      (c) => (c[1] as { document: Document }).document?.id === "doc-skip",
    );
    expect(calls.length).toBe(0);
  });

  it("backfills a missing local fileId even when the local row clock is newer", async () => {
    mocks.localDocuments = [
      makeDoc("doc-file-link", {
        title: "Keep local title",
        filePath: "/local/doc-file-link.epub",
        dateModified: "2026-06-01T00:00:00.000Z",
      }),
    ];

    map.set(
      "doc-file-link",
      makeDoc("doc-file-link", {
        title: "Older remote title",
        fileId: "manifest-file-123",
        dateModified: "2026-01-01T00:00:00.000Z",
      }),
    );

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) =>
          c[0] === "upsert_synced_document" &&
          (c[1] as { document: Document }).document?.id === "doc-file-link",
      );
      expect(call).toBeTruthy();
      const doc = (call![1] as { document: Document }).document;
      expect(doc.title).toBe("Keep local title");
      expect(doc.filePath).toBe("/local/doc-file-link.epub");
      expect(doc.dateModified).toBe("2026-06-01T00:00:00.000Z");
      expect(doc.fileId).toBe("manifest-file-123");
      expect(doc.metadata?.fileId).toBe("manifest-file-123");
    });
  });

  it("upserts remote reading-position fields (currentCfi, positionJson, progressPercent) into local SQLite", async () => {
    // Regression for the receiver half of cross-device position sync: the
    // upsert payload must carry the unified position fields, not just the
    // legacy CFI. Previously these were dropped, so even when a position was
    // published the receiver could not restore PDF/page/video positions.
    map.set(
      "doc-pos",
      makeDoc("doc-pos", {
        currentCfi: "epubcfi(/6/4!/4/2/1:0)",
        currentScrollPercent: 73,
        positionJson: '{"type":"cfi","cfi":"epubcfi(/6/4!/4/2/1:0)"}',
        progressPercent: 73,
        dateModified: "2026-06-01T00:00:00.000Z",
      }),
    );

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) =>
          c[0] === "upsert_synced_document" &&
          (c[1] as { document: Document }).document?.id === "doc-pos",
      );
      expect(call).toBeTruthy();
      const doc = (call![1] as { document: Document }).document;
      expect(doc.currentCfi).toBe("epubcfi(/6/4!/4/2/1:0)");
      expect(doc.positionJson).toBe('{"type":"cfi","cfi":"epubcfi(/6/4!/4/2/1:0)"}');
      expect(doc.progressPercent).toBe(73);
      expect(doc.currentScrollPercent).toBe(73);
    });
  });

  it("preserves a YouTube doc's URL filePath on the receiver (URL IS the content)", async () => {
    // YouTube imports store the watch URL in filePath; the viewer extracts the
    // video id from it. Blanking it on the receiver would make the doc
    // unopenable. fileType "youtube" marks filePath as portable.
    map.set(
      "doc-yt",
      makeDoc("doc-yt", {
        title: "Some YouTube Video",
        filePath: "https://www.youtube.com/watch?v=n04A6phTTVc",
        fileType: "youtube",
        dateModified: "2026-06-01T00:00:00.000Z",
      }),
    );

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) =>
          c[0] === "upsert_synced_document" &&
          (c[1] as { document: Document }).document?.id === "doc-yt",
      );
      expect(call).toBeTruthy();
      const doc = (call![1] as { document: Document }).document;
      expect(doc.filePath).toBe("https://www.youtube.com/watch?v=n04A6phTTVc");
    });
  });

  it("preserves a browser-fetched web-article filePath on the receiver", async () => {
    // Web/URL imports use the browser-fetched:// scheme, which is also content,
    // not a device-local path.
    map.set(
      "doc-web",
      makeDoc("doc-web", {
        title: "Some Article",
        filePath: "browser-fetched://article-1234-abcd",
        fileType: "html",
        dateModified: "2026-06-01T00:00:00.000Z",
      }),
    );

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) =>
          c[0] === "upsert_synced_document" &&
          (c[1] as { document: Document }).document?.id === "doc-web",
      );
      expect(call).toBeTruthy();
      expect((call![1] as { document: Document }).document.filePath).toBe(
        "browser-fetched://article-1234-abcd",
      );
    });
  });

  it("blanks a device-local filePath on the receiver (file arrives via file-sync)", async () => {
    // Regression guard: an EPUB imported from a local path must still have its
    // meaningless-on-the-receiver filePath cleared, so the UI shows the
    // "available to download" state rather than a broken local path.
    map.set(
      "doc-local",
      makeDoc("doc-local", {
        filePath: "/home/sender/books/epub.epub",
        fileType: "epub",
        dateModified: "2026-06-01T00:00:00.000Z",
      }),
    );

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) =>
          c[0] === "upsert_synced_document" &&
          (c[1] as { document: Document }).document?.id === "doc-local",
      );
      expect(call).toBeTruthy();
      expect((call![1] as { document: Document }).document.filePath).toBe("");
    });
  });

  it("does NOT let a partial (no-filePath) republish clobber an existing YouTube URL", async () => {
    // The real-world bug: a later publish arrived MISSING the filePath field
    // (a partial republish), and the receiver overwrote its good YouTube URL
    // with "" — making the doc unopenable ("player broken"). The receiver must
    // preserve its existing portable filePath when the remote value is absent.
    mocks.localDocuments = [
      makeDoc("doc-yt-partial", {
        filePath: "https://www.youtube.com/watch?v=n04A6phTTVc",
        fileType: "youtube",
        dateModified: "2026-06-01T00:00:00.000Z",
      }),
    ];
    // Remote update is NEWER but carries an empty filePath.
    map.set(
      "doc-yt-partial",
      makeDoc("doc-yt-partial", {
        filePath: "",
        fileType: "youtube",
        dateModified: "2026-06-02T00:00:00.000Z",
      }),
    );

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) =>
          c[0] === "upsert_synced_document" &&
          (c[1] as { document: Document }).document?.id === "doc-yt-partial",
      );
      expect(call).toBeTruthy();
      // The receiver must keep its YouTube URL, not accept the empty clobber.
      expect((call![1] as { document: Document }).document.filePath).toBe(
        "https://www.youtube.com/watch?v=n04A6phTTVc",
      );
    });
  });

  it("deletes a local SQLite document and cleans up sync file loader when a tombstone is received", async () => {
    const localDoc = makeDoc("doc-tombstoned", { fileId: "file-123", dateModified: "2026-01-01T00:00:00.000Z" });
    mocks.localDocuments = [localDoc];
    mocks.getDocument.mockResolvedValue(localDoc);

    const mockUnregister = vi.fn();
    const mockDeleteCached = vi.fn();

    vi.doMock("../useFileSync", () => ({
      ensureFileSyncReady: vi.fn().mockResolvedValue(undefined),
      getFileTransferManager: () => ({
        unregisterLocalFile: mockUnregister,
      }),
    }));
    vi.doMock("../file-transfer", () => ({
      deleteCachedFile: mockDeleteCached,
    }));

    map.set("doc-tombstoned", { _deleted: true, deletedAt: "1719878400000.0", deletedBy: "peer-1" } as any);

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) => c[0] === "delete_document" && (c[1] as { id: string }).id === "doc-tombstoned"
      );
      expect(call).toBeTruthy();
      expect(mockUnregister).toHaveBeenCalledWith("file-123");
      expect(mockDeleteCached).toHaveBeenCalledWith("file-123");
    });
  });
});

describe("republishDocumentPosition", () => {
  // Position saves fire rapidly (scroll/timeupdate); republish must coalesce
  // a burst into one Yjs publish to avoid ballooning the shared CRDT doc.
  // Fake timers let us advance the debounce window deterministically.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid saves into a single publish", async () => {
    const setSpy = vi.spyOn(map, "set");
    const doc = makeDoc("doc-debounce", {
      currentCfi: "epubcfi(/6/4!/4/2/1:0)",
      dateModified: "2026-06-01T00:00:00.000Z",
    });
    // Seed local with the same dateModified so the observer echo (fired when
    // publishDocument calls map.set) no-ops via the dateModified conflict
    // rule — keeping the set-spy count attributable to republish alone.
    mocks.localDocuments = [doc];

    const { republishDocumentPosition } = await import("../documentReplication");
    republishDocumentPosition(doc);
    republishDocumentPosition(doc);
    republishDocumentPosition(doc);

    // Still within the debounce window: nothing published yet.
    await vi.advanceTimersByTimeAsync(500);
    expect(setSpy.mock.calls.filter(([k]) => k === "doc-debounce").length).toBe(0);

    // Cross the debounce threshold: exactly one publish fires.
    await vi.advanceTimersByTimeAsync(1500);
    expect(setSpy.mock.calls.filter(([k]) => k === "doc-debounce").length).toBe(1);
    expect(map.get("doc-debounce")?.currentCfi).toBe("epubcfi(/6/4!/4/2/1:0)");
    setSpy.mockRestore();
  });

  it("publishes a passed Document without refetching", async () => {
    const doc = makeDoc("doc-direct", {
      currentCfi: "epubcfi(/6/4)",
      dateModified: "2026-06-01T00:00:00.000Z",
    });
    // Silence the observer echo for this doc so getDocument is attributable
    // only to the republish path.
    mocks.localDocuments = [doc];

    const { republishDocumentPosition } = await import("../documentReplication");
    republishDocumentPosition(doc);
    await vi.advanceTimersByTimeAsync(2000);

    // Doc form must NOT refetch the doc it was handed — the caller already
    // had the fresh row. (The id-form path is covered by the next test.)
    expect(mocks.getDocument).not.toHaveBeenCalledWith("doc-direct");
    expect(map.get("doc-direct")?.currentCfi).toBe("epubcfi(/6/4)");
  });

  it("refetches by id when only a string is passed", async () => {
    const doc = makeDoc("doc-byid", {
      positionJson: '{"type":"cfi","cfi":"x"}',
      progressPercent: 42,
      dateModified: "2026-06-01T00:00:00.000Z",
    });
    mocks.getDocument.mockResolvedValue(doc);
    mocks.localDocuments = [doc];

    const { republishDocumentPosition } = await import("../documentReplication");
    republishDocumentPosition("doc-byid");
    await vi.advanceTimersByTimeAsync(2000);

    expect(mocks.getDocument).toHaveBeenCalledWith("doc-byid");
    expect(map.get("doc-byid")?.positionJson).toBe('{"type":"cfi","cfi":"x"}');
    expect(map.get("doc-byid")?.progressPercent).toBe(42);
  });
});

describe("publishDocument force option", () => {
  it("republishes an unchanged row when a one-time repair requests it", async () => {
    const doc = makeDoc("doc-force-file-link", {
      fileId: "file-force-1",
      metadata: { fileId: "file-force-1" },
      dateModified: "2026-07-01T00:00:00.000Z",
    });
    mocks.localDocuments = [doc];
    const { publishDocument } = await import("../documentReplication");
    const { syncClockCache } = await import("../sync/clockCache");
    await syncClockCache.initialize();
    syncClockCache.clearClock("documents", doc.id);

    await publishDocument(doc);
    const writesAfterFirstPublish = vi.spyOn(map, "set");
    await publishDocument(doc);
    expect(writesAfterFirstPublish).not.toHaveBeenCalled();

    await publishDocument(doc, { force: true });
    expect(writesAfterFirstPublish).toHaveBeenCalledWith(
      "doc-force-file-link",
      expect.objectContaining({ fileId: "file-force-1" }),
    );
    writesAfterFirstPublish.mockRestore();
  });
});

describe("store reload coalescing", () => {
  // Regression for the startup-lag root cause: handleRemoteDocument used to end
  // with `await loadDocuments()` per incoming row, so the init map-replay over
  // N room rows (and any later multi-doc burst) fired N full SQLite reloads +
  // N React re-renders + N registerExistingFilesSync re-hash sweeps. The fix
  // debounces the in-memory refresh so a burst collapses to one reload; the
  // per-row upsert into SQLite is unchanged. Fake timers drive the 200ms window.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never unlinks a local fileId when a newer remote row carries no metadata", async () => {
    // fileId lives only in metadata and is the ONLY link between a document
    // and its file-manifest entry. A publisher whose own copy lost metadata
    // used to blank it for everyone at a newer clock, after which no device
    // could download the file and the viewer showed "preview coming soon".
    mocks.localDocuments = [
      makeDoc("doc-linked", {
        dateModified: "2026-01-01T00:00:00.000Z",
        fileId: "file-abc",
        metadata: { fileId: "file-abc", author: "local" },
      } as Partial<Document>),
    ];

    map.set("doc-linked", makeDoc("doc-linked", { dateModified: "2026-06-01T00:00:00.000Z" }));

    await vi.waitFor(() => {
      const call = mocks.invokeCommand.mock.calls.find(
        (c) =>
          c[0] === "upsert_synced_document" &&
          (c[1] as { document: Document }).document?.id === "doc-linked",
      );
      expect(call).toBeTruthy();
      const doc = (call![1] as { document: Document }).document;
      expect(doc.dateModified).toBe("2026-06-01T00:00:00.000Z"); // remote row won, as it should
      expect(doc.fileId).toBe("file-abc"); // ...but the link survived
      expect(doc.metadata?.fileId).toBe("file-abc");
    });
  });

  it("collapses a burst of document upserts into a single store reload", async () => {
    mocks.loadDocuments.mockClear();
    mocks.localDocuments = []; // every row looks new → every one upserts.

    // Simulate the init map-replay / a multi-doc sync burst: 10 distinct rows
    // arrive back-to-back. The fake map observer fires synchronously on set(),
    // so each set() runs handleRemoteDocument immediately (each upserts to
    // SQLite, then schedules — rather than awaits — the store refresh).
    const burstIds = Array.from({ length: 10 }, (_, i) => `doc-burst-${i}`);
    for (const id of burstIds) {
      map.set(id, makeDoc(id, { fileType: "epub" }));
    }

    // Within the debounce window: each upsert has run, but NO reload yet —
    // that's the regression. Previously each row awaited its own loadDocuments().
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.loadDocuments).not.toHaveBeenCalled();

    // Cross the 200ms threshold: exactly ONE reload fires for the whole burst,
    // no matter how many rows arrived during the window.
    await vi.advanceTimersByTimeAsync(150);
    expect(mocks.loadDocuments).toHaveBeenCalledTimes(1);
  });
});

describe("isPortableFilePath", () => {
  // Regression: publishDocument and readDocumentSeedRows (seedReaders.ts) both
  // decide whether to include `filePath` on the outbox wire payload using this
  // function. A device-local path must never go out (the outbox's privacy
  // filter — syncPrivacy.ts — rejects the WHOLE document if it does, silently
  // dropping it from sync entirely, not just the path), while a portable URL
  // IS the document's content on the receiver and must survive.
  it("treats a device-local path as non-portable", async () => {
    const { isPortableFilePath } = await import("../documentReplication");
    expect(isPortableFilePath("/Users/example/book.pdf", "epub")).toBe(false);
    expect(isPortableFilePath("C:\\Users\\example\\book.pdf", "pdf")).toBe(false);
    expect(isPortableFilePath(undefined, "epub")).toBe(false);
  });

  it("treats known URL schemes and youtube fileType as portable", async () => {
    const { isPortableFilePath } = await import("../documentReplication");
    expect(isPortableFilePath("https://www.youtube.com/watch?v=abc", "youtube")).toBe(true);
    expect(isPortableFilePath("browser-fetched://example.com/article", "web")).toBe(true);
    expect(isPortableFilePath("clipboard://note-1", "text")).toBe(true);
  });
});
