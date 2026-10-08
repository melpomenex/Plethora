import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

describe("ReviewHome deck context menu (app-wide-context-menus)", () => {
  const card = {
    id: "1",
    tags: ["Biology"],
    state: "New",
    due_date: new Date().toISOString(),
    item_type: "Basic",
    question: "Q",
    difficulty: 0,
    interval: 0,
    ease_factor: 2.5,
    date_created: "",
    date_modified: "",
    review_count: 0,
    lapses: 0,
    is_suspended: false,
  };

  beforeEach(() => {
    mockDeckStore.decks = [deck];
    mockDeckStore.activeDeckIds = [];
    mockDeckStore.toggleDeckSelection.mockClear();
    mockDeckStore.clearDeckSelection.mockClear();
    getDueItems.mockResolvedValue([]);
  });

  function deckRow(container: HTMLElement, marker: string): HTMLElement {
    const row = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Biology") && b.textContent?.includes(marker)
    );
    if (!row) throw new Error(`deck row (${marker}) not found`);
    return row as HTMLElement;
  }

  function menuItemLabels(): (string | null)[] {
    return screen.getAllByRole("menuitem").map((el) => el.textContent);
  }

  it("opens the spec-ordered deck menu on right-click without changing selection", async () => {
    getAllLearningItems.mockResolvedValue([card]);
    const onStartReview = vi.fn();

    const { container } = render(<ReviewHome onStartReview={onStartReview} />);
    await waitFor(() => {
      expect(screen.getByText(/due · 1 cards/)).toBeInTheDocument();
    });
    const row = deckRow(container as HTMLElement, "due");

    fireEvent.contextMenu(row);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(menuItemLabels()).toEqual([
      "Start review",
      "Preview cards",
      "Set as active focus",
      "Rename",
      "Edit tags",
      "Export as .apkg",
      "Delete deck",
    ]);
    // Opening the menu is side-effect free: no selection change, no session.
    expect(mockDeckStore.toggleDeckSelection).not.toHaveBeenCalled();
    expect(mockDeckStore.clearDeckSelection).not.toHaveBeenCalled();
    expect(onStartReview).not.toHaveBeenCalled();
  });

  it("starts an exclusive review session from the menu's Start review", async () => {
    getAllLearningItems.mockResolvedValue([card]);
    const onStartReview = vi.fn();

    const { container } = render(<ReviewHome onStartReview={onStartReview} />);
    await waitFor(() => {
      expect(screen.getByText(/due · 1 cards/)).toBeInTheDocument();
    });
    fireEvent.contextMenu(deckRow(container as HTMLElement, "due"));

    fireEvent.click(await screen.findByRole("menuitem", { name: "Start review" }));

    expect(mockDeckStore.clearDeckSelection).toHaveBeenCalled();
    expect(mockDeckStore.toggleDeckSelection).toHaveBeenCalledWith("deck-1");
    expect(onStartReview).toHaveBeenCalled();
  });

  it("disables Start review and Preview cards for an empty deck", async () => {
    getAllLearningItems.mockResolvedValue([]);

    const { container } = render(<ReviewHome onStartReview={vi.fn()} />);
    fireEvent.contextMenu(deckRow(container as HTMLElement, "No cards yet"));

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect((screen.getByRole("menuitem", { name: "Start review" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("menuitem", { name: "Preview cards" }) as HTMLButtonElement).disabled).toBe(true);
    // Management actions stay available on empty decks.
    expect((screen.getByRole("menuitem", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("menuitem", { name: "Delete deck" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
