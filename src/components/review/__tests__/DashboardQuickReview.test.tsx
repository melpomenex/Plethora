import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../../test/utils";
import {
  QuickReviewWidget,
  formatLearningItemForQuickReview,
} from "../QuickReviewWidget";
import { DashboardTab } from "../../tabs/DashboardTab";
import { useTabsStore } from "../../../stores";
import { useDocumentStore } from "../../../stores/documentStore";
import { useStartupStore } from "../../../stores/startupStore";
import { useStudyDeckStore } from "../../../stores/studyDeckStore";
import type { LearningItem } from "../../../api/review";

const getDueItemsMock = vi.fn();
const submitReviewMock = vi.fn();
const getDashboardStatsMock = vi.fn();

vi.mock("../../../api/review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/review")>();
  return {
    ...actual,
    getDueItems: (...args: unknown[]) => getDueItemsMock(...args),
    submitReview: (...args: unknown[]) => submitReviewMock(...args),
  };
});

vi.mock("../../../api/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/analytics")>();
  return {
    ...actual,
    getDashboardStats: (...args: unknown[]) => getDashboardStatsMock(...args),
  };
});

vi.mock("../../../hooks/useCaptureActivity", () => ({
  useCaptureActivity: () => ({
    activity: {
      data: {
        windowDays: 30,
        perDay: [],
        bySource: [],
        needsAttention: 0,
      },
      isLoading: false,
      error: null,
    },
    captures: {
      data: { items: [], totalCount: 0, limit: 6, offset: 0 },
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

const sampleFlashcard: LearningItem = {
  id: "card-fsrs-1",
  document_id: "doc-1",
  item_type: "flashcard",
  question: "What does FSRS stand for?",
  answer: "Free Spaced Repetition Scheduler",
  difficulty: 5,
  interval: 4,
  ease_factor: 2.5,
  due_date: "2026-11-20T10:00:00Z",
  date_created: "2026-11-01T10:00:00Z",
  date_modified: "2026-11-15T10:00:00Z",
  review_count: 3,
  lapses: 0,
  state: "review",
  is_suspended: false,
  tags: ["srs"],
};

const sampleClozeCard: LearningItem = {
  id: "card-cloze-2",
  document_id: "doc-1",
  item_type: "cloze",
  question: "Cloze Deletion",
  cloze_text: "The {{c1::mitochondria::organelle}} generates ATP for the cell.",
  answer: "mitochondria",
  difficulty: 6,
  interval: 2,
  ease_factor: 2.5,
  due_date: "2026-11-21T01:00:00Z",
  date_created: "2026-11-01T10:00:00Z",
  date_modified: "2026-11-15T10:00:00Z",
  review_count: 1,
  lapses: 0,
  state: "review",
  is_suspended: false,
  tags: ["biology"],
};

describe("Dashboard Quick Review & QuickReviewWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStartupStore.setState({
      ensureStartup: vi.fn().mockResolvedValue(null),
    } as any);
    useStudyDeckStore.setState({ decks: [], activeDeckIds: [] });
    useDocumentStore.setState({
      documents: [
        {
          id: "doc-1",
          title: "Memory Systems Textbook",
          fileType: "pdf",
          filePath: "/books/memory.pdf",
        } as any,
      ],
    });
    getDashboardStatsMock.mockResolvedValue({
      total_documents: 1,
      cards_due_today: 2,
      due_documents: 0,
      cards_learned: 10,
      reviews_today: 3,
      daily_goal: 20,
    });
    submitReviewMock.mockImplementation(async (id: string) => ({
      ...sampleFlashcard,
      id,
    }));
  });

  it("formats cloze deletions with masked front and revealed back", () => {
    const formatted = formatLearningItemForQuickReview(sampleClozeCard, [
      { id: "doc-1", title: "Memory Systems Textbook" },
    ]);

    expect(formatted.id).toBe("card-cloze-2");
    expect(formatted.documentId).toBe("doc-1");
    expect(formatted.documentTitle).toBe("Memory Systems Textbook");
    expect(formatted.front).toBe("The [... (organelle)] generates ATP for the cell.");
    expect(formatted.back).toBe("The mitochondria generates ATP for the cell.");
  });

  it("supports opening the source document via button and right-click context menu in QuickReviewWidget", () => {
    const onOpenDocument = vi.fn();
    const card = formatLearningItemForQuickReview(sampleFlashcard, [
      { id: "doc-1", title: "Memory Systems Textbook" },
    ]);

    const { container } = render(
      <QuickReviewWidget
        cards={[card]}
        onRate={vi.fn().mockResolvedValue(undefined)}
        onOpenDocument={onOpenDocument}
      />
    );

    // Click View source button
    const viewSourceBtn = screen.getByRole("button", {
      name: /Open source document: Memory Systems Textbook/i,
    });
    fireEvent.click(viewSourceBtn);
    expect(onOpenDocument).toHaveBeenCalledWith("doc-1");

    // Also verify context menu item
    onOpenDocument.mockClear();
    fireEvent.contextMenu(container.firstElementChild as HTMLElement, {
      clientX: 100,
      clientY: 100,
    });
    const menuItem = screen.getByRole("menuitem", { name: "Open source document" });
    fireEvent.click(menuItem);
    expect(onOpenDocument).toHaveBeenCalledWith("doc-1");
  });

  it("loads real due LearningItems in DashboardTab, submits FSRS review ratings via submitReview, and navigates to source document", async () => {
    getDueItemsMock.mockResolvedValue([sampleFlashcard, sampleClozeCard]);
    const addTabSpy = vi.spyOn(useTabsStore.getState(), "addTab");

    render(<DashboardTab />);

    // Wait for due items to load and render first card front
    await waitFor(() => {
      expect(screen.getByText("What does FSRS stand for?")).toBeInTheDocument();
    });
    expect(screen.getByText("Memory Systems Textbook")).toBeInTheDocument();

    // Flip the card
    fireEvent.click(screen.getByTestId("quick-review-card-surface"));
    expect(screen.getByText("Free Spaced Repetition Scheduler")).toBeInTheDocument();

    // Rate "Good" (rating = 3)
    const goodBtn = screen.getByRole("button", { name: /^Good$/i });
    fireEvent.click(goodBtn);

    await waitFor(() => {
      expect(submitReviewMock).toHaveBeenCalledWith(
        "card-fsrs-1",
        3,
        expect.any(Number)
      );
    });

    // Advances to second card (masked cloze card)
    await waitFor(() => {
      expect(
        screen.getByText("The [... (organelle)] generates ATP for the cell.")
      ).toBeInTheDocument();
    });

    // Click View source on the second card
    const viewSourceBtn = screen.getByRole("button", {
      name: /Open source document: Memory Systems Textbook/i,
    });
    fireEvent.click(viewSourceBtn);
    expect(addTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "document-viewer",
        data: { documentId: "doc-1" },
      })
    );
  });
});
