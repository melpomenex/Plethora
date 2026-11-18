import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "../../../test/utils";
import { BrowserCaptureShelf } from "../../analytics/BrowserCaptureShelf";
import { CaptureActivityCard } from "../../analytics/CaptureActivityCard";
import { TodaysHorizonBanner } from "../../dashboard/TodaysHorizonBanner";
import { QuickReviewWidget } from "../../review/QuickReviewWidget";
import { DashboardTab } from "../DashboardTab";
import { useTabsStore } from "../../../stores";
import { useDocumentStore } from "../../../stores/documentStore";
import { useStartupStore } from "../../../stores/startupStore";
import { useUIStore } from "../../../stores/uiStore";
import type { CaptureDocument } from "../../../api/capture-activity";

vi.mock("../../../api/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/analytics")>();
  return {
    ...actual,
    getDashboardStats: vi.fn().mockResolvedValue({
      total_documents: 12,
      cards_due_today: 4,
      due_documents: 3,
      cards_learned: 42,
      reviews_today: 5,
      daily_goal: 20,
    }),
  };
});

vi.mock("../../../hooks/useCaptureActivity", () => ({
  useCaptureActivity: () => ({
    activity: {
      data: {
        windowDays: 30,
        perDay: [{ date: "2026-11-18", count: 2 }],
        bySource: [{ source: "browser-extension", count: 2 }],
        needsAttention: 1,
      },
      isLoading: false,
      error: null,
    },
    captures: {
      data: {
        items: [],
        totalCount: 0,
        limit: 6,
        offset: 0,
      },
      isLoading: false,
      error: null,
      reload: vi.fn(),
    },
    reload: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useTTS", () => ({
  useTTS: () => ({
    isSpeaking: false,
    speak: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("../../common/Tabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/Tabs")>();
  return {
    ...actual,
    useIsActiveTab: () => true,
  };
});

describe("Dashboard right-click context menus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("opens context menu on BrowserCaptureShelf tiles and executes actions", () => {
    const doc: CaptureDocument = {
      documentId: "doc-1",
      title: "GPU Primer",
      fileType: "html",
      sourceUrl: "https://example.org/gpu",
      dateAdded: "2026-11-18T10:00:00Z",
      coverImageUrl: null,
      coverImageSource: null,
    };
    const onOpen = vi.fn();
    const onOpenOriginal = vi.fn();
    const onViewAll = vi.fn();
    const onRetry = vi.fn();

    const { container } = render(
      <BrowserCaptureShelf
        data={{ items: [doc], totalCount: 1, limit: 6, offset: 0 }}
        isLoading={false}
        error={null}
        onRetry={onRetry}
        onOpen={onOpen}
        onOpenOriginal={onOpenOriginal}
        onViewAll={onViewAll}
      />,
    );

    const tile = container.querySelector(".capture-document-tile")!;
    fireEvent.contextMenu(tile, { clientX: 120, clientY: 140 });

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open original" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy title" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy link" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy title" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("GPU Primer");
  });

  it("opens context menu on CaptureActivityCard needs-attention button and card", () => {
    const onRetry = vi.fn();
    const onOpenNeedsReview = vi.fn();

    render(
      <CaptureActivityCard
        data={{
          windowDays: 30,
          perDay: [{ date: "2026-11-18", count: 2 }],
          bySource: [{ source: "browser-extension", count: 2 }],
          needsAttention: 3,
        }}
        isLoading={false}
        error={null}
        onRetry={onRetry}
        onOpenNeedsReview={onOpenNeedsReview}
      />,
    );

    const needsBtn = screen.getByText(/need tag review/i).closest("button")!;
    fireEvent.contextMenu(needsBtn, { clientX: 50, clientY: 60 });

    const reviewItem = screen.getByRole("menuitem", { name: "Review items needing attention" });
    fireEvent.click(reviewItem);
    expect(onOpenNeedsReview).toHaveBeenCalledTimes(1);
  });

  it("opens context menu on TodaysHorizonBanner lanes", () => {
    const onResumeMilestone = vi.fn();
    const onLaunchQueue = vi.fn();
    const onCreateStudyPlan = vi.fn();

    const { container } = render(
      <TodaysHorizonBanner
        activePlansCount={1}
        pendingAssessmentsCount={0}
        dueReviewsCount={5}
        highPriorityExtractsCount={2}
        onResumeMilestone={onResumeMilestone}
        onLaunchQueue={onLaunchQueue}
        onCreateStudyPlan={onCreateStudyPlan}
      />,
    );

    const topDownLane = container.querySelector('[data-horizon-lane="top-down"]')!;
    fireEvent.contextMenu(topDownLane, { clientX: 80, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume milestone" }));
    expect(onResumeMilestone).toHaveBeenCalledTimes(1);

    const bottomUpLane = container.querySelector('[data-horizon-lane="bottom-up"]')!;
    fireEvent.contextMenu(bottomUpLane, { clientX: 180, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Launch queue session" }));
    expect(onLaunchQueue).toHaveBeenCalledTimes(1);
  });

  it("opens context menu on QuickReviewWidget", () => {
    const onExpand = vi.fn();
    const { container } = render(
      <QuickReviewWidget
        cards={[
          {
            id: "c1",
            front: "What is FSRS?",
            back: "Free Spaced Repetition Scheduler",
            documentTitle: "Spaced Repetition",
          },
        ]}
        onRate={vi.fn()}
        onExpand={onExpand}
      />,
    );

    const widget = container.firstElementChild as HTMLElement;
    fireEvent.contextMenu(widget, { clientX: 100, clientY: 100 });

    expect(screen.getByRole("menuitem", { name: "Flip card" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy front" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy back" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open full review" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy front" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("What is FSRS?");
  });

  it("opens context menus on DashboardTab surface, quick actions, continue reading, stats, and tip", async () => {
    const addTabSpy = vi.spyOn(useTabsStore.getState(), "addTab");
    const addTabInBackgroundSpy = vi.spyOn(useTabsStore.getState(), "addTabInBackground");
    const setCommandPaletteSpy = vi.spyOn(useUIStore.getState(), "setCommandPaletteOpen");

    useDocumentStore.setState({
      documents: [
        {
          id: "doc-resume",
          title: "Evolution, Health, and Disease",
          fileType: "pdf",
        } as any,
      ],
    });
    useStartupStore.setState({
      snapshot: {
        continueReading: [
          {
            id: "doc-resume",
            title: "Evolution, Health, and Disease",
            progress: 25,
            date_modified: "2026-11-18T10:00:00Z",
          },
        ],
      } as any,
    });

    const { container } = render(<DashboardTab />);

    // 1. Dashboard background surface
    const surface = container.querySelector('[data-responsive-surface="dashboard"]')!;
    fireEvent.contextMenu(surface, { clientX: 20, clientY: 20 });
    expect(screen.getByRole("menuitem", { name: "Refresh dashboard" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open command palette" }));
    expect(setCommandPaletteSpy).toHaveBeenCalledWith(true);

    // 2. Quick action tile (Library)
    const libraryBtn = screen.getByRole("button", { name: /Library/i });
    fireEvent.contextMenu(libraryBtn, { clientX: 40, clientY: 40 });
    expect(screen.getByRole("menuitem", { name: "Import document…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in background" }));
    expect(addTabInBackgroundSpy).toHaveBeenCalled();

    // 3. Continue Reading card
    const resumeBtn = screen.getByRole("button", { name: /Evolution, Health, and Disease/i });
    fireEvent.contextMenu(resumeBtn, { clientX: 60, clientY: 60 });
    expect(screen.getByRole("menuitem", { name: "Resume" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy title" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Evolution, Health, and Disease");

    // 4. Quick Tip card
    const tipHeading = screen.getByText(/Quick Tip/i);
    fireEvent.contextMenu(tipHeading.parentElement!, { clientX: 70, clientY: 70 });
    expect(screen.getByRole("menuitem", { name: "Copy tip" })).toBeTruthy();

    // 5. Stats card
    const progressHeading = screen.getByText(/Your Progress/i);
    fireEvent.contextMenu(progressHeading.closest(".rounded-xl")!, { clientX: 90, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "View analytics" }));
    expect(addTabSpy).toHaveBeenCalled();
  });
});
