import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Feed } from "../../../../api/rss";
import { useSmartFeedsStore } from "../../../../stores/smartFeedsStore";
import { RSSReader } from "../../RSSReader";

vi.mock("../../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/tauri")>();
  const { browserInvoke } = await import("../../../../lib/browser-backend");
  return {
    ...actual,
    isTauri: () => false,
    invokeCommand: <T,>(cmd: string, args?: Record<string, unknown>) =>
      browserInvoke<T>(cmd, args),
  };
});

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 120,
        size: 120,
        end: (index + 1) * 120,
      })),
    getTotalSize: () => count * 120,
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));

function installJsdomPolyfills() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("pointer: fine"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView = vi.fn();
}

function seedFeedsFixture(): Feed[] {
  const feeds: Feed[] = [
    {
      id: "feed-tech",
      title: "Tech Dispatch",
      description: "Engineering and AI updates",
      link: "https://tech.example.com",
      feedUrl: "https://tech.example.com/rss",
      lastUpdated: "2026-11-20T12:00:00Z",
      lastFetched: "2026-11-20T12:00:00Z",
      updateInterval: 60,
      subscribeDate: "2026-11-01T00:00:00Z",
      unreadCount: 3,
      items: [
        {
          id: "art-ai-1",
          feedId: "feed-tech",
          title: "New Open-Source Reasoning Model Released with Improved Tool Calling",
          description:
            "Open-weights reasoning model architecture with local inference benchmarks and developer tooling.",
          content:
            "Open-weights reasoning model architecture with local inference benchmarks and developer tooling.",
          link: "https://tech.example.com/art-ai-1",
          pubDate: "2026-11-20T11:00:00Z",
          author: "A. Engineer",
          categories: ["AI"],
          read: false,
          favorite: false,
        },
        {
          id: "art-ai-2",
          feedId: "feed-tech",
          title: "GPU Memory Optimization for Transformer Inference and Open-Source AI",
          description:
            "Practical quantization kernels cutting memory overhead for open-source AI model inference.",
          content:
            "Practical quantization kernels cutting memory overhead for open-source AI model inference.",
          link: "https://tech.example.com/art-ai-2",
          pubDate: "2026-11-20T10:00:00Z",
          author: "B. Systems",
          categories: ["AI", "Systems"],
          read: false,
          favorite: false,
        },
        {
          id: "art-excluded-1",
          feedId: "feed-tech",
          title: "Ten AI Prompts to Improve Your Morning Routine",
          description:
            "Generic AI productivity advice and superficial lifestyle listicles without technical depth.",
          content:
            "Generic AI productivity advice and superficial lifestyle listicles without technical depth.",
          link: "https://tech.example.com/art-excluded-1",
          pubDate: "2026-11-20T09:00:00Z",
          author: "C. Coach",
          categories: ["Lifestyle"],
          read: false,
          favorite: false,
        },
      ],
    },
  ];
  localStorage.setItem("rss_feeds", JSON.stringify(feeds));
  return feeds;
}

describe("Smart Feeds End-to-End UX Workflow", () => {
  beforeEach(() => {
    installJsdomPolyfills();
    localStorage.clear();
    useSmartFeedsStore.setState({
      smartFeeds: [],
      progressByFeedId: {},
      capabilities: null,
      loading: false,
      error: null,
      pendingFeedbackByFeed: {},
      eventsBound: false,
    });
    seedFeedsFixture();
  });

  afterEach(() => {
    cleanup();
  });

  it("supports creating, curating, reading, correcting with Undo, restoring false negatives, editing, and persistence across reload", async () => {
    const firstMount = render(<RSSReader />);

    // 1. Dashboard shows Smart Feeds section and CTA
    const dashboardSection = await screen.findByTestId("smart-feeds-dashboard-section");
    expect(dashboardSection).toBeTruthy();

    fireEvent.click(
      within(dashboardSection).getAllByRole("button", { name: /Create Smart Feed/i })[0],
    );

    // 2. Create "AI News" Smart Feed from dialog (using starter example + submit)
    const dialogHeading = await screen.findByRole("heading", { name: "Create Smart Feed" });
    const dialog = dialogHeading.closest("dialog");
    expect(dialog).not.toBeNull();
    fireEvent.click(within(dialog!).getByRole("button", { name: "AI News" }));
    fireEvent.click(within(dialog!).getByRole("button", { name: "Create Smart Feed" }));

    // 3. Backfill completes and Smart Feed view displays matched articles
    const header = await screen.findByTestId("smart-feed-header");
    expect(within(header).getByText("AI News")).toBeTruthy();

    await screen.findByRole("button", {
      name: "New Open-Source Reasoning Model Released with Improved Tool Calling",
    });
    expect(
      screen.getByRole("button", {
        name: "GPU Memory Optimization for Transformer Inference and Open-Source AI",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Ten AI Prompts to Improve Your Morning Routine")).toBeNull();

    // 4. Open & read an article -> synchronizes shared read status in RSS store/storage
    fireEvent.click(
      screen.getByRole("button", {
        name: "New Open-Source Reasoning Model Released with Improved Tool Calling",
      }),
    );
    await waitFor(() => {
      const savedFeeds = JSON.parse(localStorage.getItem("rss_feeds") || "[]") as Feed[];
      const art = savedFeeds[0]?.items.find((i) => i.id === "art-ai-1");
      expect(art?.read).toBe(true);
    });

    // 5. Reject a matched article ("Doesn't belong") -> stays in place (viewport stability) + Undo reverts
    const gpuCard = document.querySelector('[data-article-id="art-ai-2"]') as HTMLElement | null;
    expect(gpuCard).not.toBeNull();
    fireEvent.click(within(gpuCard!).getByRole("button", { name: "Doesn't belong" }));

    // Article remains visible right away without jumping out of the list
    expect(
      screen.getByRole("button", {
        name: "GPU Memory Optimization for Transformer Inference and Open-Source AI",
      }),
    ).toBeTruthy();
    const undoBtn = await screen.findByRole("button", { name: "Undo" });
    fireEvent.click(undoBtn);
    await waitFor(() => {
      expect(screen.getByText("Feedback undone.")).toBeTruthy();
    });

    // Re-reject art-ai-2 so it moves to Excluded on tab switch
    fireEvent.click(within(gpuCard!).getByRole("button", { name: "Doesn't belong" }));
    await waitFor(() => {
      expect(screen.getByText("Marked article as not belonging to this Smart Feed.")).toBeTruthy();
    });

    // 6. Switch to Excluded tab and restore an excluded item via "Belongs in this feed"
    const excludedTab = within(header).getByRole("tab", { name: /Excluded/i });
    fireEvent.click(excludedTab);
    await screen.findByRole("button", { name: "Ten AI Prompts to Improve Your Morning Routine" });
    const excludedCard = document.querySelector(
      '[data-article-id="art-excluded-1"]',
    ) as HTMLElement | null;
    expect(excludedCard).not.toBeNull();
    fireEvent.click(within(excludedCard!).getByRole("button", { name: "Belongs in this feed" }));

    // Switch back to Matched tab and verify explicit restore is in Matched!
    fireEvent.click(within(header).getByRole("tab", { name: /Matched/i }));
    await screen.findByRole("button", { name: "Ten AI Prompts to Improve Your Morning Routine" });

    // 7. Edit Smart Feed definition and save -> persists and preserves user overrides
    fireEvent.click(within(header).getByRole("button", { name: "Edit Smart Feed" }));
    const editHeading = await screen.findByRole("heading", { name: "Edit Smart Feed" });
    const editDialog = editHeading.closest("dialog");
    expect(editDialog).not.toBeNull();
    const descField = within(editDialog!).getByLabelText(/Topic description/i) as HTMLTextAreaElement;
    fireEvent.change(descField, {
      target: {
        value: `${descField.value} Including neural compiler research and inference engines.`,
      },
    });
    fireEvent.click(within(editDialog!).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Edit Smart Feed" })).toBeNull();
    });
    // Explicitly restored override stays included across re-evaluation!
    await screen.findByRole("button", { name: "Ten AI Prompts to Improve Your Morning Routine" });

    // 8. Unmount & remount RSSReader -> verify persistence across reload
    firstMount.unmount();
    useSmartFeedsStore.setState({
      smartFeeds: [],
      progressByFeedId: {},
      capabilities: null,
      loading: false,
      error: null,
      pendingFeedbackByFeed: {},
      eventsBound: false,
    });

    render(<RSSReader />);
    const sidebarSection = await screen.findByTestId("smart-feeds-sidebar-section");
    const sidebarSmartFeedBtn = await within(sidebarSection).findByRole("button", {
      name: /^AI News\b/i,
    });
    fireEvent.click(sidebarSmartFeedBtn);
    await screen.findByTestId("smart-feed-header");
    await screen.findByRole("button", { name: "Ten AI Prompts to Improve Your Morning Routine" });
  }, 15_000);
});
