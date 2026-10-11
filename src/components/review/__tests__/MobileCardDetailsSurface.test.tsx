import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LearningItem } from "../../../api/learning-items";
import { MobileCardDetailsSurface } from "../MobileCardDetailsSurface";

function makeCard(overrides: Partial<LearningItem> = {}): LearningItem {
  return {
    id: "card-1",
    item_type: "Flashcard",
    question: "A very long question that should remain readable in the mobile details header without clipping",
    answer: "Answer",
    difficulty: 0.3,
    interval: 7,
    ease_factor: 2.5,
    due_date: "2024-06-20T00:00:00.000Z",
    date_created: "2024-06-01T00:00:00.000Z",
    date_modified: "2024-06-15T00:00:00.000Z",
    review_count: 5,
    lapses: 1,
    state: "Review",
    is_suspended: false,
    tags: ["math"],
    ...overrides,
  };
}

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    locale: "en",
    t: (key: string) =>
      ({
        "common.back": "Back",
        "common.save": "Save",
        "queue.moreOptions": "More options",
        "review.deckManager.title": "Deck Manager",
      })[key] ?? key,
  }),
}));

vi.mock("../../../api/learning-items", async () => {
  const actual = await vi.importActual<typeof import("../../../api/learning-items")>(
    "../../../api/learning-items"
  );
  return {
    ...actual,
    updateLearningItemContentWithVersion: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("../CardContextMenu", () => ({
  CardContextMenu: ({
    onClose,
    onPreview,
  }: {
    onClose: () => void;
    onPreview: (id: string) => void;
  }) => (
    <div data-testid="mock-card-context-menu">
      <button type="button" onClick={() => onPreview("card-1")}>
        Preview card
      </button>
      <button type="button" onClick={onClose}>
        Close actions
      </button>
    </div>
  ),
}));

describe("MobileCardDetailsSurface", () => {
  it("provides an opaque, modal details surface with reachable card views", () => {
    const card = makeCard();

    render(
      <MobileCardDetailsSurface
        open
        card={card}
        deckName="Campfire deck"
        onClose={vi.fn()}
        onSuspend={vi.fn()}
        onUnsuspend={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    );

    const surface = screen.getByRole("dialog");
    expect(surface).toHaveAttribute("data-surface", "opaque");
    expect(surface).toHaveClass("mobile-card-details-layer");
    expect(surface).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("heading", { name: card.question })).toHaveClass("truncate");
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Edit" })).toHaveClass("min-h-11");
    expect(screen.getByRole("tab", { name: "History" })).toHaveClass("min-h-11");
  });

  it("keeps Preview/Edit/History state in the surface and reuses overflow actions", () => {
    const card = makeCard();
    const onClose = vi.fn();

    render(
      <MobileCardDetailsSurface
        open
        card={card}
        onClose={onClose}
        onSuspend={vi.fn()}
        onUnsuspend={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Question").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Total Reviews").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByTestId("mock-card-context-menu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview card" }));
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps a saved edit when returning to Preview, then allows History", async () => {
    function Harness() {
      const [card, setCard] = useState(makeCard());
      return (
        <MobileCardDetailsSurface
          open
          card={card}
          onClose={vi.fn()}
          onCardUpdate={setCard}
          onSuspend={vi.fn()}
          onUnsuspend={vi.fn()}
          onDelete={vi.fn()}
          onDuplicate={vi.fn()}
        />
      );
    }

    render(<Harness />);
    const updatedQuestion = "Saved from the mobile editor";
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue(/A very long question/), {
      target: { value: updatedQuestion },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getAllByText(updatedQuestion).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getAllByText("Total Reviews").length).toBeGreaterThan(0);
  });

  it("dismisses with Escape and restores focus to the card row", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <div data-deck-manager-card="card-1" data-testid="card-row" tabIndex={0} />
          <MobileCardDetailsSurface
            open={open}
            card={makeCard()}
            onClose={() => setOpen(false)}
            onSuspend={vi.fn()}
            onUnsuspend={vi.fn()}
            onDelete={vi.fn()}
            onDuplicate={vi.fn()}
          />
        </>
      );
    }

    render(<Harness />);
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByTestId("card-row")).toHaveFocus();
    });
  });
});
