import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LearningItem } from "../../../api/learning-items";
import type { StudyDeck } from "../../../types/study-decks";
import { DeckManager } from "../DeckManager";

const mocks = vi.hoisted(() => ({
  selectedDeckId: "deck-a",
  decks: [] as unknown[],
  cards: [] as unknown[],
  setSelectedDeckId: vi.fn(),
  clearDeckSelection: vi.fn(),
  toggleDeckSelection: vi.fn(),
  updateDeck: vi.fn(),
  removeDeck: vi.fn(),
  addDeck: vi.fn(),
  saveFile: vi.fn(),
  exportApkg: vi.fn(),
  exportCsv: vi.fn(),
  createLearningItem: vi.fn(),
  bulkSuspendItems: vi.fn(),
  bulkUnsuspendItems: vi.fn(),
  bulkDeleteItems: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  getAllLearningItems: vi.fn(),
  useMobileShell: vi.fn(),
}));

vi.mock("../../../stores/studyDeckStore", () => ({
  useStudyDeckStore: Object.assign(
    () => ({
      decks: mocks.decks,
      updateDeck: mocks.updateDeck,
      removeDeck: mocks.removeDeck,
      addDeck: mocks.addDeck,
    }),
    {
      getState: () => ({
        clearDeckSelection: mocks.clearDeckSelection,
        toggleDeckSelection: mocks.toggleDeckSelection,
        ensureDecksExist: vi.fn(),
      }),
    },
  ),
}));

vi.mock("../../../stores/reviewStore", () => ({
  useReviewStore: (selector: (state: { selectedDeckId: string; setSelectedDeckId: typeof mocks.setSelectedDeckId }) => unknown) =>
    selector({ selectedDeckId: mocks.selectedDeckId, setSelectedDeckId: mocks.setSelectedDeckId }),
}));

vi.mock("../../../api/learning-items", () => ({
  getAllLearningItems: mocks.getAllLearningItems,
  createLearningItem: mocks.createLearningItem,
  exportDeckAsApkg: mocks.exportApkg,
  exportDeckAsCsv: mocks.exportCsv,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.saveFile }));

vi.mock("../../../api/queue", () => ({
  bulkSuspendItems: mocks.bulkSuspendItems,
  bulkUnsuspendItems: mocks.bulkUnsuspendItems,
  bulkDeleteItems: mocks.bulkDeleteItems,
}));

vi.mock("../../common/Toast", () => {
  const toast = { success: mocks.success, error: mocks.error, info: mocks.info };
  return { useToast: () => toast };
});

vi.mock("../../common/ConfirmDialog", () => ({
  useConfirmDialog: () => ({ isOpen: false, confirm: mocks.confirm, close: vi.fn() }),
  ConfirmDialog: () => null,
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => ({
      "review.backToHome": "Back to Review Home",
      "review.deckManager.title": "Deck Manager",
      "review.deckManager.searchPlaceholder": "Search cards…",
      "review.deckManager.noDecks": "No decks yet.",
      "review.deckManager.selectDeck": "Select a deck",
      "review.deckManager.emptyDeck": "This deck has no cards yet.",
    }[key] ?? key),
  }),
}));

vi.mock("../../../hooks/useMobileShell", () => ({ useMobileShell: mocks.useMobileShell }));

vi.mock("../useResizablePanels", () => ({
  useResizablePanels: () => ({
    widths: { left: 220, right: 320 },
    containerRef: { current: null },
    handlePointerDown: vi.fn(),
  }),
}));

vi.mock("../../adaptive/ResponsiveDialogSheet", () => ({
  ResponsiveDialogSheet: ({
    open,
    onClose,
    title,
    description,
    children,
    footer,
  }: {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => open ? (
    <section role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      <button type="button" aria-label="Close" onClick={onClose}>Close</button>
      {children}
      {footer}
    </section>
  ) : null,
}));

vi.mock("../../common/ResponsiveBulkActionBar", () => ({
  ResponsiveBulkActionBar: ({ selectedCount, onClearSelection, actions }: {
    selectedCount: number;
    onClearSelection?: () => void;
    actions?: { id: string; label: React.ReactNode; onClick: () => void }[];
  }) => selectedCount > 0 ? (
    <div role="toolbar" aria-label={`${selectedCount} selected`}>
      <span>{selectedCount} selected</span>
      {onClearSelection && <button type="button" onClick={onClearSelection}>Clear selection</button>}
      {actions?.map((action) => <button type="button" key={action.id} onClick={action.onClick}>{action.label}</button>)}
    </div>
  ) : null,
}));

vi.mock("../../common/VirtualList", () => ({
  DynamicVirtualList: ({ items, renderItem }: {
    items: LearningItem[];
    renderItem: (item: LearningItem) => React.ReactNode;
  }) => <div>{items.map(renderItem)}</div>,
}));

vi.mock("../MobileCardDetailsSurface", () => ({
  MobileCardDetailsSurface: ({ open, card, onClose }: { open: boolean; card: LearningItem | null; onClose: () => void }) =>
    open && card ? (
      <div role="dialog" aria-label="Card Details" data-card-id={card.id}>
        <button type="button" onClick={onClose}>Back to deck</button>
      </div>
    ) : null,
}));

function deck(id: string, name: string, tag: string): StudyDeck {
  return {
    id,
    name,
    tagFilters: [tag],
    filterType: "tags",
    difficultyFilters: [],
    stateFilters: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function card(
  id: string,
  tag: string,
  state: LearningItem["state"],
  difficulty: number,
  question = id,
): LearningItem {
  return {
    id,
    item_type: "Basic",
    question,
    answer: "answer",
    difficulty,
    interval: difficulty * 2,
    ease_factor: 2.5,
    due_date: `2026-01-0${difficulty}T00:00:00.000Z`,
    date_created: "2025-01-01T00:00:00.000Z",
    date_modified: "2025-01-01T00:00:00.000Z",
    review_count: difficulty,
    lapses: state === "Relearning" ? 5 : 0,
    state,
    is_suspended: false,
    tags: [tag],
  };
}

const deckA = deck("deck-a", "This Is Your Brain on Music and the Science of Listening", "fixture-a");
const deckB = deck("deck-b", "Second Deck", "fixture-b");
const fixtureCards = [
  card("a-learning", "fixture-a", "Learning", 3, "Practice learning recall"),
  card("a-relearning", "fixture-a", "Relearning", 7, "Practice relearning recall"),
  card("a-review", "fixture-a", "Review", 9, "Review memory practice"),
  card("b-new", "fixture-b", "New", 5, "Second deck card"),
];

function renderDeckManager() {
  return render(<DeckManager onBack={vi.fn()} onStartReview={vi.fn(async () => undefined)} />);
}

beforeEach(() => {
  mocks.selectedDeckId = "deck-a";
  mocks.decks = [deckA, deckB];
  mocks.cards = fixtureCards;
  mocks.confirm.mockReset();
  mocks.updateDeck.mockReset();
  mocks.addDeck.mockReset();
  mocks.saveFile.mockReset().mockResolvedValue("/tmp/plethora-export.apkg");
  mocks.exportApkg.mockReset().mockResolvedValue("Exported deck");
  mocks.exportCsv.mockReset().mockResolvedValue("Exported deck");
  mocks.createLearningItem.mockReset();
  mocks.bulkSuspendItems.mockReset();
  mocks.bulkUnsuspendItems.mockReset();
  mocks.bulkDeleteItems.mockReset();
  mocks.clearDeckSelection.mockReset();
  mocks.toggleDeckSelection.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
  mocks.info.mockReset();
  mocks.useMobileShell.mockReturnValue(true);
  mocks.getAllLearningItems.mockReset().mockImplementation(async () => mocks.cards);
});

describe("DeckManager mobile browsing", () => {
  it("applies Learning and sort drafts together, including Relearning", async () => {
    const user = userEvent.setup();
    const { container } = renderDeckManager();

    await screen.findByText("Practice learning recall");
    await user.click(screen.getByRole("button", { name: /Filter & sort/ }));
    const dialog = screen.getByRole("dialog", { name: "Filter & sort" });
    await user.click(within(dialog).getByRole("radio", { name: /Learning/ }));
    await user.click(within(dialog).getByRole("radio", { name: /Difficulty/ }));
    await user.click(within(dialog).getByRole("button", { name: "Descending ↓" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-deck-manager-card]"));
    expect(rows.map((row) => row.dataset.deckManagerCard)).toEqual(["a-relearning", "a-learning"]);
    expect(screen.getByRole("button", { name: /2 of 3 cards · Learning · Difficulty descending/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filter & sort, active settings/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("discards canceled drafts and resets sorting without clearing search", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "practice");

    await user.click(screen.getByRole("button", { name: /Filter & sort/ }));
    let dialog = screen.getByRole("dialog", { name: "Filter & sort" });
    await user.click(within(dialog).getByRole("radio", { name: /New/ }));
    await user.click(within(dialog).getByRole("radio", { name: /Difficulty/ }));
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(document.querySelectorAll('[data-deck-manager-card]')).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: /Filter & sort/ }));
    dialog = screen.getByRole("dialog", { name: "Filter & sort" });
    await user.click(within(dialog).getByRole("button", { name: "Reset" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("searchbox", { name: "Search cards" })).toHaveValue("practice");
    expect(document.querySelectorAll('[data-deck-manager-card]')).toHaveLength(3);
  });

  it("clears search, category, and selection on deck switch while retaining sort", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    await user.click(screen.getByRole("button", { name: /Filter & sort/ }));
    let dialog = screen.getByRole("dialog", { name: "Filter & sort" });
    await user.click(within(dialog).getByRole("radio", { name: /Difficulty/ }));
    await user.click(within(dialog).getByRole("button", { name: "Descending ↓" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "practice");
    const list = document.querySelector<HTMLElement>('[data-deck-manager-card="a-review"]')!.closest<HTMLElement>(".overflow-y-auto")!;
    list.scrollTop = 131;

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    dialog = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(dialog).getByRole("button", { name: "Select cards" }));
    await user.click(screen.getByRole("checkbox", { name: /Practice learning recall/ }));
    expect(screen.getByRole("toolbar", { name: "1 selected" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Choose deck/ }));
    dialog = screen.getByRole("dialog", { name: "Choose a deck" });
    await user.click(within(dialog).getByRole("option", { name: /Second Deck/ }));

    expect(screen.getByRole("searchbox", { name: "Search cards" })).toHaveValue("");
    expect(screen.getByRole("button", { name: /Second Deck.*1 of 1 cards.*Difficulty descending/ })).toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.getByText("Second deck card")).toBeInTheDocument();
    expect(list.scrollTop).toBe(0);
  });

  it("keeps picker cancellation on the same query and exposes the full deck name", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    const title = screen.getByRole("button", { name: /^Choose deck\. This Is Your Brain on Music and the Science of Listening/ });
    expect(title).toHaveAttribute("aria-label", expect.stringContaining("This Is Your Brain on Music"));

    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "practice");
    const list = document.querySelector<HTMLElement>('[data-deck-manager-card="a-review"]')!.closest<HTMLElement>(".overflow-y-auto")!;
    list.scrollTop = 97;
    await user.click(title);
    const dialog = screen.getByRole("dialog", { name: "Choose a deck" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("searchbox", { name: "Search cards" })).toHaveValue("practice");
    expect(document.querySelectorAll('[data-deck-manager-card]')).toHaveLength(3);
    expect(list.scrollTop).toBe(97);
  });

  it("searches the deck picker and shows full deck names, counts, and the current selection", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");

    await user.click(screen.getByRole("button", { name: /^Choose deck/ }));
    const dialog = screen.getByRole("dialog", { name: "Choose a deck" });
    const firstDeckOption = within(dialog).getByRole("option", { name: /This Is Your Brain on Music and the Science of Listening/ });
    expect(firstDeckOption).toHaveAttribute("aria-selected", "true");
    expect(firstDeckOption).toHaveTextContent("3 cards");
    expect(firstDeckOption).toHaveTextContent("Selected");

    await user.type(within(dialog).getByRole("searchbox", { name: "Search decks" }), "second");
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
    expect(within(dialog).getByRole("option", { name: /Second Deck/ })).toHaveTextContent("1 card");
    expect(within(dialog).queryByRole("option", { name: /This Is Your Brain/ })).not.toBeInTheDocument();
  });

  it("clears a no-results search and filter while preserving the deck and sort", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    await user.click(screen.getByRole("button", { name: /Filter & sort/ }));
    let dialog = screen.getByRole("dialog", { name: "Filter & sort" });
    await user.click(within(dialog).getByRole("radio", { name: /Learning/ }));
    await user.click(within(dialog).getByRole("radio", { name: "Difficulty" }));
    await user.click(within(dialog).getByRole("button", { name: "Descending ↓" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "not present");

    expect(screen.getByText("No cards match your search or filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(screen.getByRole("searchbox", { name: "Search cards" })).toHaveValue("");
    expect(screen.getByRole("button", { name: /This Is Your Brain on Music.*3 of 3 cards.*Difficulty descending/ })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-deck-manager-card]")).toHaveLength(3);
  });

  it("closes Card Details and resets deck-specific state when its deck is removed", async () => {
    const user = userEvent.setup();
    const view = renderDeckManager();
    await screen.findByText("Practice learning recall");
    await user.click(screen.getByRole("button", { name: /Filter & sort/ }));
    const dialog = screen.getByRole("dialog", { name: "Filter & sort" });
    await user.click(within(dialog).getByRole("radio", { name: /Learning/ }));
    await user.click(within(dialog).getByRole("radio", { name: "Difficulty" }));
    await user.click(within(dialog).getByRole("button", { name: "Descending ↓" }));
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));
    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "relearning");
    await user.click(document.querySelector<HTMLElement>('[data-deck-manager-card="a-relearning"]')!);
    expect(screen.getByRole("dialog", { name: "Card Details" })).toBeInTheDocument();

    mocks.decks = [deckB];
    view.rerender(<DeckManager onBack={vi.fn()} onStartReview={vi.fn(async () => undefined)} />);

    expect(await screen.findByText("Second deck card")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Card Details" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search cards" })).toHaveValue("");
    expect(screen.getByRole("button", { name: /Second Deck.*Difficulty descending/ })).toBeInTheDocument();
  });

  it("shows the no-decks state when the active deck no longer exists", async () => {
    mocks.decks = [];
    const { container } = renderDeckManager();

    expect(await screen.findByText("No decks yet.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search cards" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose a deck" })).toBeDisabled();
    expect(container.querySelector("[data-deck-manager-card]")).toBeNull();
  });

  it("distinguishes an empty deck from the no-decks and no-results states", async () => {
    mocks.cards = [];
    renderDeckManager();

    expect(await screen.findByText("This deck has no cards yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New card" })).toBeInTheDocument();
    expect(screen.queryByText("No decks yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("No cards match your search or filters.")).not.toBeInTheDocument();
  });

  it("shows loading while the deck card request is pending", () => {
    mocks.getAllLearningItems.mockReturnValue(new Promise<LearningItem[]>(() => undefined));
    const { container } = renderDeckManager();

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByText("This deck has no cards yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("No decks yet.")).not.toBeInTheDocument();
  });

  it("clears hidden selections and exits selection mode with Escape", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    const search = screen.getByRole("searchbox", { name: "Search cards" });
    await user.type(search, "practice");

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    const actions = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(actions).getByRole("button", { name: "Select cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Practice learning recall" }));
    expect(screen.getByRole("toolbar", { name: "1 selected" })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "relearning");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Practice relearning recall" })).toHaveAttribute("aria-checked", "false");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox", { name: "Select Practice relearning recall" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Choose deck/ })).toBeInTheDocument();
  });

  it("opens Card Details in normal mode and toggles each selected row once by keyboard", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    const row = document.querySelector<HTMLElement>('[data-deck-manager-card="a-learning"]')!;

    await user.click(row);
    expect(screen.getByRole("dialog", { name: "Card Details" })).toHaveAttribute("data-card-id", "a-learning");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Card Details" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    const actions = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(actions).getByRole("button", { name: "Select cards" }));
    const selectableRow = screen.getByRole("checkbox", { name: "Select Practice learning recall" });
    selectableRow.focus();
    await user.keyboard("{Enter}");
    expect(selectableRow).toHaveAttribute("aria-checked", "true");
    expect(selectableRow.closest(".overflow-y-auto")).toHaveClass("pb-[calc(9rem+env(safe-area-inset-bottom,0px))]");
    expect(screen.queryByRole("dialog", { name: "Card Details" })).not.toBeInTheDocument();
    await user.keyboard(" ");
    const deselectedRow = screen.getByRole("checkbox", { name: "Select Practice learning recall" });
    expect(deselectedRow).toHaveAttribute("aria-checked", "false");
    expect(deselectedRow.closest(".overflow-y-auto")).not.toHaveClass("pb-[calc(9rem+env(safe-area-inset-bottom,0px))]");
  });

  it("selects and deselects all currently filtered results", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "practice");
    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    await user.click(within(screen.getByRole("dialog", { name: /actions/ })).getByRole("button", { name: "Select cards" }));

    await user.click(screen.getByRole("button", { name: "Select all results" }));
    expect(screen.getByRole("toolbar", { name: "3 selected" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Practice learning recall" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Select Practice relearning recall" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Select Review memory practice" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select all results" })).toBeInTheDocument();
  });

  it("preserves list scroll position while opening and returning from Card Details", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    const list = document.querySelector<HTMLElement>(".overflow-y-auto")!;
    list.scrollTop = 147;
    await user.click(document.querySelector<HTMLElement>('[data-deck-manager-card="a-learning"]')!);
    await user.click(screen.getByRole("button", { name: "Back to deck" }));

    expect(list.scrollTop).toBe(147);
    expect(document.querySelector('[data-deck-manager-card="a-learning"]')).toBeInTheDocument();
  });

  it("clears temporary selection when switching from mobile to desktop presentation", async () => {
    const user = userEvent.setup();
    const view = renderDeckManager();
    await screen.findByText("Practice learning recall");
    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    await user.click(within(screen.getByRole("dialog", { name: /actions/ })).getByRole("button", { name: "Select cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Practice learning recall" }));
    expect(screen.getByRole("toolbar", { name: "1 selected" })).toBeInTheDocument();

    mocks.useMobileShell.mockReturnValue(false);
    view.rerender(<DeckManager onBack={vi.fn()} onStartReview={vi.fn(async () => undefined)} />);

    expect(screen.getByRole("heading", { name: "Deck Manager" })).toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select Practice learning recall" })).not.toBeInTheDocument();
  });

  it("applies bulk suspend to the selected subset only", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "practice");
    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    const actions = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(actions).getByRole("button", { name: "Select cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Practice learning recall" }));
    await user.click(screen.getByRole("button", { name: "Suspend" }));

    await waitFor(() => expect(mocks.bulkSuspendItems).toHaveBeenCalledWith(["a-learning"]));
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("confirms bulk delete and deletes only the selected subset", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "practice");
    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    await user.click(within(screen.getByRole("dialog", { name: /actions/ })).getByRole("button", { name: "Select cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Practice learning recall" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete 1 cards?", variant: "danger" }));
    const confirmation = mocks.confirm.mock.calls[0][0] as { onConfirm: () => void };
    confirmation.onConfirm();
    await waitFor(() => expect(mocks.bulkDeleteItems).toHaveBeenCalledWith(["a-learning"]));
    expect(document.querySelector('[data-deck-manager-card="a-learning"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-deck-manager-card="a-relearning"]')).toBeInTheDocument();
  });

  it("keeps statistics, export counts, and Study scoped to the whole deck", async () => {
    const user = userEvent.setup();
    const onStartReview = vi.fn(async () => undefined);
    render(<DeckManager onBack={vi.fn()} onStartReview={onStartReview} />);
    await screen.findByText("Practice learning recall");
    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "practice");

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    let dialog = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(dialog).getByRole("button", { name: "Deck statistics" }));
    dialog = screen.getByRole("dialog", { name: "Deck statistics" });
    expect(dialog).toHaveTextContent("whole-deck totals");
    expect(within(dialog).getByText("Total cards").nextElementSibling).toHaveTextContent("3");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    dialog = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(dialog).getByRole("button", { name: "Export" }));
    dialog = screen.getByRole("dialog", { name: "Export deck" });
    expect(dialog).toHaveTextContent("3 cards · exports the whole deck");
    await user.click(within(dialog).getByRole("button", { name: "Anki Package (.apkg)" }));
    await waitFor(() => expect(mocks.exportApkg).toHaveBeenCalledWith(deckA.name, "/tmp/plethora-export.apkg"));

    await user.click(screen.getByRole("button", { name: "Study" }));
    expect(mocks.clearDeckSelection).toHaveBeenCalledOnce();
    expect(mocks.toggleDeckSelection).toHaveBeenCalledWith("deck-a");
    expect(onStartReview).toHaveBeenCalledOnce();
  });

  it("keeps export cancellation quiet and reports APKG export failures", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    mocks.saveFile.mockResolvedValueOnce(null);

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    await user.click(within(screen.getByRole("dialog", { name: /actions/ })).getByRole("button", { name: "Export" }));
    await user.click(within(screen.getByRole("dialog", { name: "Export deck" })).getByRole("button", { name: "Tab-separated text (.txt)" }));
    await waitFor(() => expect(mocks.saveFile).toHaveBeenCalledOnce());
    expect(mocks.exportCsv).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();

    mocks.saveFile.mockResolvedValueOnce("/tmp/plethora-export.apkg");
    mocks.exportApkg.mockRejectedValueOnce(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    await user.click(within(screen.getByRole("dialog", { name: /actions/ })).getByRole("button", { name: "Export" }));
    await user.click(within(screen.getByRole("dialog", { name: "Export deck" })).getByRole("button", { name: "Anki Package (.apkg)" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Export failed: Error: offline"));
  });

  it("uses a visible rename form, duplicates the active deck, and confirms deletion", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    let dialog = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(dialog).getByRole("button", { name: "Rename deck" }));
    dialog = screen.getByRole("dialog", { name: "Rename deck" });
    const nameField = within(dialog).getByRole("textbox", { name: "Deck name" });
    await user.clear(nameField);
    await user.type(nameField, "Renamed deck");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mocks.updateDeck).toHaveBeenCalledWith("deck-a", { name: "Renamed deck" });

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    dialog = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(dialog).getByRole("button", { name: "Duplicate deck" }));
    expect(mocks.addDeck).toHaveBeenCalledWith(`${deckA.name} (copy)`, deckA.tagFilters);

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    dialog = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(dialog).getByRole("button", { name: "Delete deck" }));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({ variant: "danger" });
  });

  it("creates a new card from the active deck actions", async () => {
    const user = userEvent.setup();
    const newCard = card("a-new", "fixture-a", "New", 1, "New card");
    mocks.cards = [...fixtureCards, newCard];
    mocks.createLearningItem.mockResolvedValue(newCard);
    renderDeckManager();
    await screen.findByText("Practice learning recall");

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    const dialog = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(dialog).getByRole("button", { name: "New card" }));

    await waitFor(() => expect(mocks.createLearningItem).toHaveBeenCalledWith({
      item_type: "basic",
      question: "",
      answer: "",
      tags: ["fixture-a"],
      allow_duplicate: true,
    }));
    expect(mocks.success).toHaveBeenCalledWith("review.deckManager.newCardCreated", "review.deckManager.editCardInPanel");
  });

  it("suspends and unsuspends the active deck through labeled actions", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    let dialog = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(dialog).getByRole("button", { name: "Suspend active cards" }));
    await waitFor(() => expect(mocks.bulkSuspendItems).toHaveBeenCalledWith(["a-learning", "a-relearning", "a-review"]));
    expect(mocks.success).toHaveBeenCalledWith("Suspended 3 cards");

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    dialog = screen.getByRole("dialog", { name: /actions/ });
    await user.click(await within(dialog).findByRole("button", { name: "Unsuspend cards" }));
    await waitFor(() => expect(mocks.bulkUnsuspendItems).toHaveBeenCalledWith(["a-learning", "a-relearning", "a-review"]));
    expect(mocks.success).toHaveBeenCalledWith("Unsuspended 3 cards");
  });

  it("retags selected mobile results from the bulk action sheet", async () => {
    const user = userEvent.setup();
    renderDeckManager();
    await screen.findByText("Practice learning recall");
    await user.type(screen.getByRole("searchbox", { name: "Search cards" }), "practice");

    await user.click(screen.getByRole("button", { name: "Deck actions" }));
    const actions = screen.getByRole("dialog", { name: /actions/ });
    await user.click(within(actions).getByRole("button", { name: "Select cards" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Practice learning recall" }));
    await user.click(screen.getByRole("button", { name: "Retag" }));

    const dialog = screen.getByRole("dialog", { name: "Retag selected cards" });
    await user.type(within(dialog).getByRole("textbox", { name: "Add tags" }), "reviewed");
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(mocks.success).toHaveBeenCalledWith("Retagged 1 cards");
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search cards" })).toHaveValue("practice");
  });
});

describe("DeckManager desktop presentation", () => {
  it("retains the desktop toolbar, statistics, columns, and preview", async () => {
    mocks.useMobileShell.mockReturnValue(false);
    const { container } = renderDeckManager();
    await screen.findByText("Practice learning recall");

    expect(screen.getByRole("heading", { name: "Deck Manager" })).toBeInTheDocument();
    expect(screen.getByText("TOTAL CARDS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export to Anki/ })).toBeInTheDocument();
    expect(screen.getAllByText("Card").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Stats" })).toBeInTheDocument();
    const row = container.querySelector("[data-deck-manager-card]");
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row!, { clientX: 120, clientY: 160 });
    expect(screen.getByText("cardContextMenu.preview")).toBeInTheDocument();
  });
});
