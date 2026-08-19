import { describe, expect, it, vi, beforeEach } from "vitest";
import { mapDocument, isTwitterThreadShape, enrichTwitterThread } from "../documents";
import type { Document, TwitterThread } from "../../types/document";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  isTauri: true,
}));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: (...args: unknown[]) => mocks.invokeCommand(...args),
  isTauri: () => mocks.isTauri,
  isNativeMobile: () => false,
}));

function makeThread(): Record<string, unknown> {
  return {
    id: "1001",
    rootId: "1001",
    rootUrl: "https://x.com/janeresearch/status/1001",
    author: {
      name: "Jane Researcher",
      screenName: "janeresearch",
      avatarUrl: null,
      verified: false,
      profileUrl: "https://x.com/janeresearch",
    },
    title: "Jane Researcher (@janeresearch) on X: \"First post\"",
    posts: [
      {
        id: "1001",
        postIndex: 1,
        author: { name: "Jane Researcher", screenName: "janeresearch", avatarUrl: null, verified: false, profileUrl: "https://x.com/janeresearch" },
        text: "First post",
        fullText: "First post",
        media: [],
        quotedPost: null,
        isNoteTweet: false,
        url: "https://x.com/janeresearch/status/1001",
      },
    ],
    totalPosts: 1,
    htmlContent: "<div>html</div>",
    structuredText: "X Thread by Jane Researcher (@janeresearch):\n\n[Post 1 by @janeresearch]\nFirst post",
    createdAt: null,
  };
}

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    title: "Thread",
    filePath: "https://x.com/janeresearch/status/1001",
    fileType: "html",
    tags: ["x"],
    category: "X Threads",
    content: "X Thread by Jane Researcher",
    dateAdded: "2024-01-01T00:00:00.000Z",
    dateModified: "2024-01-01T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
    ...overrides,
  } as Document;
}

describe("mapDocument X-thread restoration", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
    mocks.isTauri = true;
  });

  it("restores metadata.xThread from persisted structuredContent", () => {
    const doc = makeDoc({
      metadata: { source: "https://x.com/janeresearch/status/1001", structuredContent: makeThread() },
    });
    const mapped = mapDocument(doc);
    expect(mapped?.metadata?.xThread).toBeDefined();
    expect(mapped?.metadata?.xThread?.rootId).toBe("1001");
    expect(mapped?.metadata?.xThread?.posts).toHaveLength(1);
  });

  it("tolerates quote-handle fields: legacy threads lack refHandles, new threads keep them", () => {
    // Legacy shape (persisted before quote-handle capture): no refIds /
    // refHandles anywhere — restores identically.
    const legacy = makeDoc({
      metadata: { structuredContent: makeThread() },
    });
    const mappedLegacy = mapDocument(legacy);
    expect(mappedLegacy?.metadata?.xThread?.posts[0].refHandles).toBeUndefined();

    // New shape: handles ride along and survive restoration.
    const withHandles = makeThread();
    (withHandles.posts as Array<Record<string, unknown>>)[0] = {
      ...(withHandles.posts as Array<Record<string, unknown>>)[0],
      refIds: ["9999999999999999999"],
      refHandles: [{ id: "9999999999999999999", screenName: "quotedauthor" }],
    };
    const mappedNew = mapDocument(makeDoc({ metadata: { structuredContent: withHandles } }));
    expect(mappedNew?.metadata?.xThread?.posts[0].refHandles).toEqual([
      { id: "9999999999999999999", screenName: "quotedauthor" },
    ]);
    // The type guard is shape-based on core fields only, so both pass.
    expect(isTwitterThreadShape(withHandles)).toBe(true);
  });

  it("does not overwrite an existing metadata.xThread", () => {
    const existing = { ...makeThread(), rootId: "9999" } as unknown as TwitterThread;
    const doc = makeDoc({
      metadata: {
        structuredContent: makeThread(),
        xThread: existing,
      },
    });
    const mapped = mapDocument(doc);
    expect(mapped?.metadata?.xThread?.rootId).toBe("9999");
  });

  it("leaves non-thread structuredContent untouched (NotebookLM artifacts)", () => {
    const doc = makeDoc({
      metadata: { structuredContent: { type: "mind-map", nodes: [] } },
    });
    const mapped = mapDocument(doc);
    expect(mapped?.metadata?.xThread).toBeUndefined();
  });

  it("handles null documents", () => {
    expect(mapDocument(null)).toBeNull();
  });

  it("isTwitterThreadShape rejects malformed payloads", () => {
    expect(isTwitterThreadShape(makeThread())).toBe(true);
    expect(isTwitterThreadShape({ rootId: "1" })).toBe(false);
    expect(isTwitterThreadShape({ rootId: "1", rootUrl: "u", posts: [], author: { screenName: "a" } })).toBe(true);
    expect(isTwitterThreadShape(null)).toBe(false);
    expect(isTwitterThreadShape("nope")).toBe(false);
  });
});

describe("enrichTwitterThread", () => {
  it("invokes enrich_twitter_thread with the thread payload", async () => {
    const thread = makeThread() as unknown as TwitterThread;
    mocks.invokeCommand.mockResolvedValue(thread);
    const result = await enrichTwitterThread(thread);
    expect(mocks.invokeCommand).toHaveBeenCalledWith("enrich_twitter_thread", { thread });
    expect(result.rootId).toBe("1001");
  });
});
