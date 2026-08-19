import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Document, TwitterThread, TwitterPost } from "../../../types/document";
import { XThreadViewer } from "../XThreadViewer";
import { XTHREAD_SCROLL_EVENT } from "../xthreadNav";

// ── mocks ─────────────────────────────────────────────────────────────────
const openExternalMock = vi.fn();
const createExtractMock = vi.fn();
const openTwitterThreadMock = vi.fn();
const answerQuestionMock = vi.fn();
const summarizeContentMock = vi.fn();
const extractKeyPointsMock = vi.fn();
const importTwitterThreadMock = vi.fn();
const isMobileMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../../../lib/tauri", () => ({
  openExternal: (...args: unknown[]) => openExternalMock(...args),
  isTauri: () => false,
  isNativeMobile: () => false,
}));
vi.mock("../../../api/extracts", () => ({
  createExtract: (...args: unknown[]) => createExtractMock(...args),
}));
vi.mock("../../../api/ai", () => ({
  answerQuestion: (...args: unknown[]) => answerQuestionMock(...args),
  summarizeContent: (...args: unknown[]) => summarizeContentMock(...args),
  extractKeyPoints: (...args: unknown[]) => extractKeyPointsMock(...args),
}));
vi.mock("../../../api/documents", () => ({
  importTwitterThread: (...args: unknown[]) => importTwitterThreadMock(...args),
}));
vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => isMobileMock(),
}));
vi.mock("../../../stores", () => ({
  useDocumentStore: (selector: unknown) =>
    (selector as (s: { openTwitterThread: typeof openTwitterThreadMock }) => unknown)({
      openTwitterThread: openTwitterThreadMock,
    }),
}));
vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    promise: vi.fn(),
  }),
}));

// ── fixtures ──────────────────────────────────────────────────────────────

function makePost(overrides: Partial<TwitterPost> = {}): TwitterPost {
  return {
    id: "1001",
    postIndex: 1,
    author: {
      name: "Jane Researcher",
      screenName: "janeresearch",
      avatarUrl: null,
      verified: true,
      profileUrl: "https://x.com/janeresearch",
    },
    text: "First post text.",
    fullText: "First post text.\n\nSecond paragraph.",
    media: [],
    quotedPost: null,
    isNoteTweet: false,
    url: "https://x.com/janeresearch/status/1001",
    ...overrides,
  };
}

function makeThread(posts: TwitterPost[]): TwitterThread {
  return {
    id: "1001",
    rootId: "1001",
    rootUrl: "https://x.com/janeresearch/status/1001",
    author: {
      name: "Jane Researcher",
      screenName: "janeresearch",
      avatarUrl: null,
      verified: true,
      profileUrl: "https://x.com/janeresearch",
    },
    title: "Jane Researcher (@janeresearch) on X: \"First post text.\"",
    posts,
    totalPosts: posts.length,
    htmlContent: "<div>html</div>",
    structuredText: `X Thread by Jane Researcher (@janeresearch):\n\n${posts
      .map((p) => `[Post ${p.postIndex} by @janeresearch]\n${p.fullText}`)
      .join("\n\n")}`,
    createdAt: null,
    sourceKind: "threadreader",
  };
}

function makeDoc(metadata: Record<string, unknown>): Document {
  return {
    id: "x-thread-1001",
    title: "Thread",
    filePath: "https://x.com/janeresearch/status/1001",
    fileType: "html",
    tags: ["x"],
    category: "X Threads",
    content: "",
    dateAdded: "2024-01-01T00:00:00.000Z",
    dateModified: "2024-01-01T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
    metadata: metadata as Document["metadata"],
  } as Document;
}

function renderThread(posts: TwitterPost[] = [makePost(), makePost({ id: "1002", postIndex: 2, text: "Second post", fullText: "Second post" })]) {
  const thread = makeThread(posts);
  const doc = makeDoc({ xThread: thread });
  return { thread, doc, ...render(<XThreadViewer document={doc} />) };
}

beforeEach(() => {
  openExternalMock.mockReset();
  createExtractMock.mockReset();
  openTwitterThreadMock.mockReset();
  answerQuestionMock.mockReset();
  summarizeContentMock.mockReset();
  extractKeyPointsMock.mockReset();
  importTwitterThreadMock.mockReset();
  isMobileMock.mockReturnValue(false);
});

describe("XThreadViewer", () => {
  it("renders posts in order with the spine and position labels", () => {
    renderThread();
    expect(screen.getByTestId("x-thread-viewer")).toBeInTheDocument();
    const rows = screen.getAllByTestId("x-thread-post-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    // author header (header + post cards both show the name)
    expect(screen.getAllByText("Jane Researcher").length).toBeGreaterThan(0);
    expect(screen.getByText(/X thread · 2 posts/)).toBeInTheDocument();
    // stable anchors
    expect(document.getElementById("x-post-1001")).not.toBeNull();
    expect(document.getElementById("x-post-1002")).not.toBeNull();
    // aria: Post N of M by @handle
    expect(screen.getByLabelText("Post 1 of 2 by @janeresearch")).toBeInTheDocument();
  });

  it("preserves paragraph breaks in the post body", () => {
    renderThread();
    expect(screen.getByText(/First post text\./)).toBeInTheDocument();
    expect(screen.getByText(/Second paragraph\./)).toBeInTheDocument();
  });

  it("omits the engagement row when values are unknown or zero", () => {
    renderThread([
      makePost(), // no counts
      makePost({ id: "1002", postIndex: 2, fullText: "Second", text: "Second", favoriteCount: 0, replyCount: 0, retweetCount: 0 }),
    ]);
    expect(screen.queryAllByTestId("x-post-engagement")).toHaveLength(0);
  });

  it("shows the engagement row only for known positive values", () => {
    renderThread([makePost({ favoriteCount: 2100, replyCount: 42, retweetCount: 183 })]);
    const engagement = screen.getByTestId("x-post-engagement");
    expect(engagement.textContent).toContain("2.1K");
    expect(engagement.textContent).toContain("42");
    expect(engagement.textContent).toContain("183");
  });

  it("renders the media grid for image posts", () => {
    renderThread([
      makePost({
        media: [
          { kind: "photo", mediaUrl: "https://pbs.twimg.com/media/a1.jpg", thumbnailUrl: "https://pbs.twimg.com/media/a1.jpg", altText: "Chart", aspectRatio: 1.5 },
          { kind: "photo", mediaUrl: "https://pbs.twimg.com/media/a2.jpg", thumbnailUrl: "https://pbs.twimg.com/media/a2.jpg", altText: null, aspectRatio: null },
        ],
      }),
    ]);
    expect(screen.getAllByTestId("x-thread-media-grid")).toHaveLength(1);
    expect(screen.getByAltText("Chart")).toBeInTheDocument();
  });

  it("renders a resolved quote distinctly from a fallback quote card", () => {
    renderThread([
      makePost({
        quotedPost: {
          id: "999",
          author: { name: "Quoted Author", screenName: "quotedauthor", avatarUrl: null, verified: false, profileUrl: "https://x.com/quotedauthor" },
          text: "Original quote text",
          media: [],
          createdAt: null,
          url: "https://x.com/quotedauthor/status/999",
        },
      }),
      makePost({ id: "1002", postIndex: 2, fullText: "Second", text: "Second", refIds: ["888"] }),
    ]);
    expect(screen.getByTestId("x-quote-card")).toBeInTheDocument();
    expect(screen.getByText("Original quote text")).toBeInTheDocument();
    expect(screen.getByTestId("x-quote-fallback")).toBeInTheDocument();
  });

  it("renders a neutral header for a quote whose author is the Unknown fallback", () => {
    renderThread([
      makePost({
        quotedPost: {
          id: "999",
          author: { name: "Unknown", screenName: "unknown", avatarUrl: null, verified: false, profileUrl: "https://x.com" },
          text: "Quote text from an unavailable account",
          media: [],
          createdAt: null,
          url: "https://x.com/unknown/status/999",
        },
      }),
    ]);
    expect(screen.getByTestId("x-quote-card")).toBeInTheDocument();
    expect(screen.getByLabelText("Quoted post")).toBeInTheDocument();
    expect(screen.getByText("Quote text from an unavailable account")).toBeInTheDocument();
    // The placeholder identity never surfaces.
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
    expect(screen.queryByText("@unknown")).not.toBeInTheDocument();
  });

  it("shows the skeleton for a loading placeholder document", () => {
    const doc = makeDoc({ xThreadLoading: true });
    render(<XThreadViewer document={doc} />);
    expect(screen.getAllByTestId("x-thread-skeleton-post").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Loading X thread")).toBeInTheDocument();
  });

  it("shows the native error state with Retry for a typed error", () => {
    const doc = makeDoc({ xThreadLoading: false, xThreadError: { type: "thread_unavailable", message: "gone" } });
    render(<XThreadViewer document={doc} />);
    expect(screen.getByTestId("x-thread-error")).toBeInTheDocument();
    expect(screen.getByText("Unable to load this X thread")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(openTwitterThreadMock).toHaveBeenCalledWith("https://x.com/janeresearch/status/1001");
  });

  it("shows the dismissible single-post note for sourceKind single", () => {
    const thread = makeThread([makePost()]);
    thread.sourceKind = "single";
    const doc = makeDoc({ xThread: thread });
    const { rerender } = render(<XThreadViewer document={doc} />);
    expect(screen.getByTestId("x-single-post-note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("x-single-post-note")).not.toBeInTheDocument();
    expect(rerender).toBeDefined();
  });

  it("scroll-to-post event scrolls to the post and highlights it", () => {
    renderThread();
    // jsdom has no layout — guard the scrollIntoView call.
    const scrollIntoViewMock = vi.fn();
    const el = document.getElementById("x-post-1002");
    el!.scrollIntoView = scrollIntoViewMock;
    act(() => {
      window.dispatchEvent(
        new CustomEvent(XTHREAD_SCROLL_EVENT, { detail: { postId: "1002" } })
      );
    });
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("ignores scroll-to-post for a different thread root", () => {
    renderThread();
    const scrollIntoViewMock = vi.fn();
    const el = document.getElementById("x-post-1002");
    el!.scrollIntoView = scrollIntoViewMock;
    act(() => {
      window.dispatchEvent(
        new CustomEvent(XTHREAD_SCROLL_EVENT, { detail: { postId: "1002", rootId: "OTHER" } })
      );
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("opens the mobile toolbar and assistant sheet (Ask) with thread-scoped AI", async () => {
    isMobileMock.mockReturnValue(true);
    answerQuestionMock.mockResolvedValue("The thread argues X.");
    renderThread();
    expect(screen.getByTestId("x-thread-mobile-toolbar")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByTestId("x-thread-sheet")).toBeInTheDocument();
    expect(screen.getByText("Scope: This X thread")).toBeInTheDocument();

    const input = screen.getByLabelText("Ask about this thread");
    fireEvent.change(input, { target: { value: "Explain post 1" } });
    fireEvent.submit(input.closest("form")!);

    await vi.waitFor(() => {
      expect(answerQuestionMock).toHaveBeenLastCalledWith(
        "Explain post 1",
        expect.stringContaining("[Post 1 by @janeresearch]")
      );
    });
    await vi.waitFor(() => {
      expect(screen.getByText("The thread argues X.")).toBeInTheDocument();
    });
  });

  it("keeps the reader mounted when the sheet closes (no refetch/unmount)", () => {
    isMobileMock.mockReturnValue(true);
    renderThread();
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByTestId("x-thread-sheet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByTestId("x-thread-sheet")).not.toBeInTheDocument();
    // The thread content is still rendered (no unmount).
    expect(screen.getAllByText("Jane Researcher").length).toBeGreaterThan(0);
  });
});
