import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document, TwitterThread } from "../../types/document";

// ── mocks ─────────────────────────────────────────────────────────────────
const fetchTwitterThreadMock = vi.fn();
const importTwitterThreadMock = vi.fn();
const enrichTwitterThreadMock = vi.fn();

vi.mock("../../api/documents", () => ({
  fetchTwitterThread: (...args: unknown[]) => fetchTwitterThreadMock(...args),
  importTwitterThread: (...args: unknown[]) => importTwitterThreadMock(...args),
  enrichTwitterThread: (...args: unknown[]) => enrichTwitterThreadMock(...args),
}));
vi.mock("../../api/segmentation", () => ({ segmentDocument: vi.fn() }));
vi.mock("../../api/audiobooks", () => ({
  enrichAudiobookDocument: vi.fn(),
  isAudiobookFile: () => false,
}));
vi.mock("../settingsStore", () => ({
  useSettingsStore: { getState: () => ({ settings: { documents: {} } }) },
}));
vi.mock("../collectionStore", () => ({
  useCollectionStore: { getState: () => ({ activeCollectionId: null }) },
}));
vi.mock("../../utils/documentImport", () => ({
  importFromUrl: vi.fn(),
  importFromArxiv: vi.fn(),
}));
const isTauriMock = vi.hoisted(() => vi.fn(() => false));
vi.mock("../../lib/tauri", () => ({
  listen: vi.fn(),
  isTauri: () => isTauriMock(),
  isNativeMobile: () => false,
}));
vi.mock("../../lib/feedback", () => ({ emitFeedback: vi.fn() }));
vi.mock("../../components/common/Toast", () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
  ToastType: { Success: "success", Error: "error", Info: "info" },
}));

import { useDocumentStore, __clearThreadCacheForTests } from "../documentStore";

// ── fixtures ──────────────────────────────────────────────────────────────

function makeThread(rootId = "1001"): TwitterThread {
  return {
    id: rootId,
    rootId,
    rootUrl: `https://x.com/janeresearch/status/${rootId}`,
    author: {
      name: "Jane Researcher",
      screenName: "janeresearch",
      avatarUrl: null,
      verified: false,
      profileUrl: "https://x.com/janeresearch",
    },
    title: `Jane Researcher (@janeresearch) on X: "Post ${rootId}"`,
    posts: [
      {
        id: rootId,
        postIndex: 1,
        author: {
          name: "Jane Researcher",
          screenName: "janeresearch",
          avatarUrl: null,
          verified: false,
          profileUrl: "https://x.com/janeresearch",
        },
        text: `Post ${rootId} text`,
        fullText: `Post ${rootId} text`,
        media: [],
        quotedPost: null,
        isNoteTweet: false,
        url: `https://x.com/janeresearch/status/${rootId}`,
      },
      {
        id: "1002",
        postIndex: 2,
        author: {
          name: "Jane Researcher",
          screenName: "janeresearch",
          avatarUrl: null,
          verified: false,
          profileUrl: "https://x.com/janeresearch",
        },
        text: "Second post",
        fullText: "Second post",
        media: [],
        quotedPost: null,
        isNoteTweet: false,
        url: "https://x.com/janeresearch/status/1002",
      },
    ],
    totalPosts: 2,
    htmlContent: "<div>html</div>",
    structuredText: "X Thread by Jane Researcher (@janeresearch):\n\n[Post 1 by @janeresearch]\nPost 1001 text",
    createdAt: null,
    sourceKind: "threadreader",
  };
}

const URL_ROOT = "https://x.com/janeresearch/status/1001";
const URL_MID = "https://x.com/janeresearch/status/1002";

describe("documentStore.openTwitterThread (X thread progressive open)", () => {
  beforeEach(() => {
    fetchTwitterThreadMock.mockReset();
    importTwitterThreadMock.mockReset();
    enrichTwitterThreadMock.mockReset();
    isTauriMock.mockReturnValue(false);
    __clearThreadCacheForTests();
    useDocumentStore.setState({ documents: [], currentDocument: null, error: null });
  });

  it("shows a loading placeholder, then swaps in the real thread doc", async () => {
    let resolveFetch!: (t: TwitterThread) => void;
    fetchTwitterThreadMock.mockReturnValue(
      new Promise<TwitterThread>((resolve) => {
        resolveFetch = resolve;
      })
    );

    const openPromise = useDocumentStore.getState().openTwitterThread(URL_ROOT);

    // Placeholder visible while fetching → native skeleton state.
    expect(useDocumentStore.getState().documents[0].metadata?.xThreadLoading).toBe(true);
    expect(useDocumentStore.getState().documents[0].id).toBe("x-thread-1001");

    resolveFetch(makeThread());
    const doc = await openPromise;

    expect(useDocumentStore.getState().documents[0].metadata?.xThreadLoading).toBeUndefined();
    expect(doc.metadata?.xThread?.rootId).toBe("1001");
    expect(doc.metadata?.xThread?.posts).toHaveLength(2);
    // Placeholder removed; only the real doc remains.
    expect(useDocumentStore.getState().documents).toHaveLength(1);
  });

  it("rejects duplicate opens of the same URL without refetching", async () => {
    fetchTwitterThreadMock.mockResolvedValue(makeThread());
    const first = await useDocumentStore.getState().openTwitterThread(URL_ROOT);
    expect(fetchTwitterThreadMock).toHaveBeenCalledTimes(1);

    const second = await useDocumentStore.getState().openTwitterThread(URL_ROOT);
    expect(second.id).toBe(first.id);
    expect(fetchTwitterThreadMock).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().documents).toHaveLength(1);
  });

  it("dedupes a mid-thread URL against the canonical root document", async () => {
    fetchTwitterThreadMock.mockResolvedValueOnce(makeThread()); // root open
    await useDocumentStore.getState().openTwitterThread(URL_ROOT);

    // Mid-thread URL: resolves via ping to the same root → existing doc focused.
    fetchTwitterThreadMock.mockResolvedValueOnce(makeThread());
    const midDoc = await useDocumentStore.getState().openTwitterThread(URL_MID);
    expect(midDoc.metadata?.xThread?.rootId).toBe("1001");
    expect(useDocumentStore.getState().documents).toHaveLength(1);
  });

  it("reuses the in-memory cache instead of refetching within the TTL", async () => {
    fetchTwitterThreadMock.mockResolvedValue(makeThread());
    await useDocumentStore.getState().openTwitterThread(URL_ROOT);
    expect(fetchTwitterThreadMock).toHaveBeenCalledTimes(1);

    // Simulate a fresh session state (docs cleared) — cache still serves.
    useDocumentStore.setState({ documents: [], currentDocument: null });
    const doc = await useDocumentStore.getState().openTwitterThread(URL_ROOT);
    expect(fetchTwitterThreadMock).toHaveBeenCalledTimes(1);
    expect(doc.metadata?.xThread?.rootId).toBe("1001");
  });

  it("keeps the placeholder with a typed error when the fetch fails, and retries", async () => {
    fetchTwitterThreadMock.mockRejectedValueOnce(
      new Error('Tauri command "get_twitter_thread" failed: {"type":"thread_unavailable","message":"gone"}')
    );
    const errored = await useDocumentStore.getState().openTwitterThread(URL_ROOT);
    // parseThreadError normalizes the backend snake_case type to the camelCase
    // UI key, so the error state renders the typed (non-generic) copy.
    expect(errored.metadata?.xThreadError?.type).toBe("threadUnavailable");
    expect(errored.metadata?.xThreadError?.message).toBe("gone");
    expect(errored.metadata?.xThreadLoading).toBe(false);

    // Retry: the stale placeholder is skipped and the fetch runs again.
    fetchTwitterThreadMock.mockResolvedValueOnce(makeThread());
    const doc = await useDocumentStore.getState().openTwitterThread(URL_ROOT);
    expect(fetchTwitterThreadMock).toHaveBeenCalledTimes(2);
    expect(doc.metadata?.xThread?.rootId).toBe("1001");
    expect(useDocumentStore.getState().documents[0].metadata?.xThreadError).toBeUndefined();
  });

  it("merges background enrichment into the stored doc (Tauri)", async () => {
    isTauriMock.mockReturnValue(true);
    const thread = makeThread();
    fetchTwitterThreadMock.mockResolvedValue(thread);
    importTwitterThreadMock.mockResolvedValue({
      id: "db-thread-1",
      title: thread.title,
      filePath: thread.rootUrl,
      fileType: "html",
      content: thread.structuredText,
      tags: ["x", "twitter", "thread"],
      category: "X Threads",
      metadata: { source: thread.rootUrl, structuredContent: thread },
      dateAdded: "2024-01-01T00:00:00.000Z",
      dateModified: "2024-01-01T00:00:00.000Z",
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 0,
      prioritySlider: 0,
    } as unknown as Document);

    const enriched = makeThread();
    enriched.posts = [{ ...enriched.posts[0], favoriteCount: 42, createdAt: "2024-01-02T00:00:00.000Z" }, enriched.posts[1]];
    enrichTwitterThreadMock.mockResolvedValue(enriched);

    await useDocumentStore.getState().openTwitterThread(URL_ROOT);
    expect(importTwitterThreadMock).toHaveBeenCalledWith(URL_ROOT, null, thread);
    expect(enrichTwitterThreadMock).toHaveBeenCalledWith(thread);

    // Flush the background merge.
    await vi.waitFor(() => {
      const doc = useDocumentStore.getState().documents.find((d) => d.id === "db-thread-1");
      expect(doc?.metadata?.xThread?.posts[0].favoriteCount).toBe(42);
    });
  });

  it("enrichment failure is non-fatal — the thread doc stays readable", async () => {
    const thread = makeThread();
    fetchTwitterThreadMock.mockResolvedValue(thread);
    enrichTwitterThreadMock.mockRejectedValue(new Error("GraphQL down"));
    const doc = await useDocumentStore.getState().openTwitterThread(URL_ROOT);
    expect(doc.metadata?.xThread?.posts).toHaveLength(2);
    await vi.waitFor(() => expect(useDocumentStore.getState().error).toBeNull());
  });
});
