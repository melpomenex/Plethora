import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ReviewHome } from "../ReviewHome";
import type { StudyDeck } from "../../../types/study-decks";

const deck: StudyDeck = {
  id: "deck-1",
  name: "Biology",
  tagFilters: ["Biology"],
  filterType: "tags",
};

const mockDeckStore = vi.hoisted(() => ({
  decks: [] as StudyDeck[],
  activeDeckIds: [] as string[],
  toggleDeckSelection: vi.fn(),
  clearDeckSelection: vi.fn(),
  addDeck: vi.fn(),
  updateDeck: vi.fn(),
  removeDeck: vi.fn(),
  seedFromDocuments: vi.fn(),
  ensureDecksExist: vi.fn(() => []),
}));

vi.mock("../../../stores/studyDeckStore", () => ({
  useStudyDeckStore: Object.assign(
    (selector?: (s: typeof mockDeckStore) => unknown) =>
      selector ? selector(mockDeckStore) : mockDeckStore,
    { getState: () => mockDeckStore }
  ),
}));

const mockDocumentStore = vi.hoisted(() => ({
  documents: [] as unknown[],
  loadDocuments: vi.fn(),
}));
vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: Object.assign(
    (selector?: (s: typeof mockDocumentStore) => unknown) =>
      selector ? selector(mockDocumentStore) : mockDocumentStore,
    { getState: () => mockDocumentStore }
  ),
}));

const mockReviewStore = vi.hoisted(() => ({
  loadStreak: vi.fn(),
  streak: null as number | null,
  streakLoading: false,
}));
vi.mock("../../../stores/reviewStore", () => ({
  useReviewStore: Object.assign(
    (selector?: (s: typeof mockReviewStore) => unknown) =>
      selector ? selector(mockReviewStore) : mockReviewStore,
    { getState: () => mockReviewStore }
  ),
}));

vi.mock("../../../stores/collectionStore", () => ({
  useCollectionStore: Object.assign(() => ({ activeCollectionId: undefined }), {
    getState: () => ({ activeCollectionId: undefined }),
    subscribe: vi.fn(() => vi.fn()),
  }),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const getDueItems = vi.fn(async (_collectionId?: string) => [] as unknown[]);
vi.mock("../../../api/review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/review")>();
  return { ...actual, getDueItems: (collectionId?: string) => getDueItems(collectionId) };
});

const getAllLearningItems = vi.fn();
vi.mock("../../../api/learning-items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/learning-items")>();
  return { ...actual, getAllLearningItems: () => getAllLearningItems() };
});

describe("ReviewHome deck stats", () => {
  beforeEach(() => {
    mockDeckStore.decks = [deck];
    mockDeckStore.activeDeckIds = [];
    getDueItems.mockResolvedValue([]);
    getAllLearningItems.mockReset();
  });

  it("shows a non-zero card total and 0 due for a deck whose cards aren't due yet, instead of an empty state", async () => {
    const farFuture = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    getAllLearningItems.mockResolvedValue([
      { id: "1", tags: ["Biology"], state: "New", due_date: farFuture, item_type: "Basic", question: "Q", difficulty: 0, interval: 0, ease_factor: 2.5, date_created: "", date_modified: "", review_count: 0, lapses: 0, is_suspended: false },
    ]);

    render(<ReviewHome onStartReview={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("0 due · 1 cards")).toBeInTheDocument();
    });
    expect(screen.queryByText("No cards yet")).not.toBeInTheDocument();
  });

  it("shows an explicit empty state for a deck with no matching cards", async () => {
    getAllLearningItems.mockResolvedValue([]);

    render(<ReviewHome onStartReview={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No cards yet")).toBeInTheDocument();
    });
  });

  it("shows an error indicator, not zero counts, when the deck stats fetch fails", async () => {
    getAllLearningItems.mockRejectedValue(new Error("network down"));

    render(<ReviewHome onStartReview={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load deck stats")).toBeInTheDocument();
    });
  });
});
