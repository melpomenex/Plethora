import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { FlashcardScrollItem } from "../FlashcardScrollItem";
import { FLASHCARD_REVEAL_EVENT } from "../../../pages/queueScrollKeyboard";

vi.mock("../../../api/image-registry", () => ({
  getImageAssetById: vi.fn(),
}));

import { getImageAssetById } from "../../../api/image-registry";

const baseLearningItem = {
  id: "item-1",
  item_type: "Flashcard" as const,
  question: "What is shown?",
  answer: "An image",
  difficulty: 3,
  interval: 0,
  ease_factor: 2.5,
  due_date: new Date().toISOString(),
  date_created: new Date().toISOString(),
  date_modified: new Date().toISOString(),
  review_count: 0,
  lapses: 0,
  state: "New" as const,
  is_suspended: false,
  tags: [],
  image_asset_ids: [],
};

describe("FlashcardScrollItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders registry images when image asset IDs are present", async () => {
    vi.mocked(getImageAssetById).mockResolvedValue({
      id: "asset-1",
      mime_type: "image/png",
      byte_size: 123,
      sha256: "abc",
      created_at: new Date().toISOString(),
      data_url: "data:image/png;base64,AAAA",
    });

    render(
      <FlashcardScrollItem
        learningItem={{ ...baseLearningItem, image_asset_ids: ["asset-1"] }}
        onRate={() => undefined}
      />
    );

    await waitFor(() => {
      expect(screen.getByAltText("Flashcard visual 1")).toBeInTheDocument();
    });
  });

  it("does not render image block when no image asset IDs are provided", () => {
    render(<FlashcardScrollItem learningItem={baseLearningItem} onRate={() => undefined} />);
    expect(screen.queryByAltText("Flashcard visual 1")).not.toBeInTheDocument();
  });

  it("masks simplified cloze markers when stored ranges are empty and reveals them in context", () => {
    render(
      <FlashcardScrollItem
        learningItem={{
          ...baseLearningItem,
          item_type: "Cloze",
          question: "Larger groups had {{military and economic advantages}}.",
          cloze_text: "Larger groups had {{military and economic advantages}}.",
          cloze_ranges: [],
        }}
        onRate={() => undefined}
      />
    );

    expect(document.body.textContent).toContain("Larger groups had [...].");
    expect(document.body.textContent).not.toContain("military and economic advantages");
    expect(document.body.textContent).not.toContain("{{");

    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));

    expect(document.body.textContent).toContain("Larger groups had military and economic advantages.");
    expect(document.body.textContent).not.toContain("{{");
  });

  it("uses question text for lowercase cloze cards without cloze_text", () => {
    render(
      <FlashcardScrollItem
        learningItem={{
          ...baseLearningItem,
          item_type: "cloze" as any,
          question: "Larger groups had {{military and economic advantages}}.",
          cloze_text: undefined,
        }}
        onRate={() => undefined}
      />
    );

    expect(document.body.textContent).toContain("Larger groups had [...].");
    expect(document.body.textContent).not.toContain("military and economic advantages");
    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
    expect(document.body.textContent).toContain("Larger groups had military and economic advantages.");
  });

  it("falls back to marker parsing when stored cloze ranges are out of bounds", () => {
    render(
      <FlashcardScrollItem
        learningItem={{
          ...baseLearningItem,
          item_type: "Cloze",
          question: "The {{c1::sun}} rises in the east.",
          cloze_text: "The {{c1::sun}} rises in the east.",
          cloze_ranges: [[100, 120]],
        }}
        onRate={() => undefined}
      />
    );

    expect(document.body.textContent).toContain("The [...] rises in the east.");
    expect(document.body.textContent).not.toContain("sun");
  });

  it("uses hints for numbered clozes and supports legacy bracket markers", () => {
    const { unmount } = render(
      <FlashcardScrollItem
        learningItem={{
          ...baseLearningItem,
          item_type: "Cloze",
          question: "Cell organelles",
          cloze_text: "{{c1::mitochondria::cell organelle}} produce energy.",
        }}
        onRate={() => undefined}
      />
    );

    expect(document.body.textContent).toContain("cell organelle");
    expect(document.body.textContent).not.toContain("mitochondria");
    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
    expect(document.body.textContent).toContain("mitochondria produce energy.");
    expect(document.body.textContent).not.toContain("{{");

    unmount();
    render(
      <FlashcardScrollItem
        learningItem={{
          ...baseLearningItem,
          item_type: "Cloze",
          question: "The [[c2::spleen]] filters blood.",
          cloze_text: "The [[c2::spleen]] filters blood.",
        }}
        onRate={() => undefined}
      />
    );

    expect(document.body.textContent).toContain("The [...] filters blood.");
    expect(document.body.textContent).not.toContain("spleen");
    expect(document.body.textContent).not.toContain("[[c2::");
    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
    expect(document.body.textContent).toContain("The spleen filters blood.");
    expect(document.body.textContent).not.toContain("[[c2::");
  });

  it("continues to render range-based clozes when marker syntax is absent", () => {
    render(
      <FlashcardScrollItem
        learningItem={{
          ...baseLearningItem,
          item_type: "Cloze",
          question: "The mitochondria produce energy.",
          cloze_text: "The mitochondria produce energy.",
          cloze_ranges: [[4, 16]],
        }}
        onRate={() => undefined}
      />
    );

    expect(document.body.textContent).toContain("The [...] produce energy.");
    expect(document.body.textContent).not.toContain("mitochondria");
  });

  it("renders LaTeX in question and answer content", () => {
    render(
      <FlashcardScrollItem
        learningItem={{
          ...baseLearningItem,
          question: "[$]x^2[/$]",
          answer: "[$]\\\\frac{1}{2}[/$]",
        }}
        onRate={() => undefined}
      />
    );

    expect(document.querySelector(".math-expression")).toBeInTheDocument();
  });

  it("renders KaTeX error markup for unsupported latex commands", () => {
    render(
      <FlashcardScrollItem
        learningItem={{
          ...baseLearningItem,
          question: "[$]\\\\unknowncmd{x}[/$]",
          answer: "A",
        }}
        onRate={() => undefined}
      />
    );

    const renderedMath = document.querySelector(".math-expression");
    expect(renderedMath).toBeInTheDocument();
    expect(renderedMath?.innerHTML.length).toBeGreaterThan(0);
  });

  it("renders Action Bar buttons and triggers callbacks when kindle tag or extract_id is present", () => {
    const onCreateFlashcard = vi.fn();
    const onCreateCloze = vi.fn();
    const onCreateQA = vi.fn();

    render(
      <FlashcardScrollItem
        learningItem={{
          ...baseLearningItem,
          tags: ["kindle"],
          extract_id: "ext-1",
          document_id: "doc-1",
          question: "Highlight text to convert",
        }}
        onRate={() => undefined}
        onCreateFlashcard={onCreateFlashcard}
        onCreateCloze={onCreateCloze}
        onCreateQA={onCreateQA}
      />
    );

    const flashcardBtn = screen.getByRole("button", { name: /create flashcard/i });
    const clozeBtn = screen.getByRole("button", { name: /create cloze/i });
    const qaBtn = screen.getByRole("button", { name: /create q&a/i });

    expect(flashcardBtn).toBeInTheDocument();
    expect(clozeBtn).toBeInTheDocument();
    expect(qaBtn).toBeInTheDocument();

    // Trigger flashcard callback
    flashcardBtn.click();
    expect(onCreateFlashcard).toHaveBeenCalledWith("Highlight text to convert", "ext-1", "doc-1");

    // Trigger QA callback
    qaBtn.click();
    expect(onCreateQA).toHaveBeenCalled();
  });

  it("reveals the answer when Scroll Mode dispatches the reveal-request event", () => {
    const onRevealChange = vi.fn();
    render(
      <FlashcardScrollItem
        learningItem={baseLearningItem}
        onRate={() => undefined}
        onRevealChange={onRevealChange}
      />
    );

    expect(screen.getByRole("button", { name: /show answer/i })).toBeInTheDocument();

    // This is how QueueScrollPage reveals the answer on Space while focus is
    // outside the card (the card's own Space handler only fires when focus is
    // inside its container).
    act(() => {
      window.dispatchEvent(new CustomEvent(FLASHCARD_REVEAL_EVENT));
    });

    expect(screen.queryByRole("button", { name: /show answer/i })).not.toBeInTheDocument();
    expect(onRevealChange).toHaveBeenLastCalledWith(true);
  });

  it("reports the reveal state through onRevealChange", () => {
    const onRevealChange = vi.fn();
    render(
      <FlashcardScrollItem
        learningItem={baseLearningItem}
        onRate={() => undefined}
        onRevealChange={onRevealChange}
      />
    );

    // Mounted with the answer hidden.
    expect(onRevealChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
    expect(onRevealChange).toHaveBeenLastCalledWith(true);
  });

  it("rates with number keys only after the answer is revealed", () => {
    const onRate = vi.fn();
    const { container } = render(
      <FlashcardScrollItem learningItem={baseLearningItem} onRate={onRate} />
    );
    const card = container.firstChild as HTMLElement;

    // Focus inside the card, answer still hidden: 1-4 must do nothing.
    fireEvent.keyDown(card, { key: "3" });
    expect(onRate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));

    fireEvent.keyDown(card, { key: "3" });
    expect(onRate).toHaveBeenCalledWith(3);
  });

  it("reveals the answer on Space when focus is inside the card", () => {
    const { container } = render(
      <FlashcardScrollItem learningItem={baseLearningItem} onRate={() => undefined} />
    );
    const card = container.firstChild as HTMLElement;

    fireEvent.keyDown(card, { key: " " });

    expect(screen.queryByRole("button", { name: /show answer/i })).not.toBeInTheDocument();
  });

  it("renders edit button when onEdit is provided and triggers callback on click", () => {
    const onEdit = vi.fn();
    render(
      <FlashcardScrollItem
        learningItem={baseLearningItem}
        onRate={() => undefined}
        onEdit={onEdit}
      />
    );

    const editBtn = screen.getByTestId("review-card-edit");
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("renders an accessible delete button beside the edit button and triggers its callback", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <FlashcardScrollItem
        learningItem={baseLearningItem}
        onRate={() => undefined}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    const editButton = screen.getByRole("button", { name: "Edit Flashcard" });
    const deleteButton = screen.getByRole("button", { name: "Delete Flashcard" });
    expect(editButton.parentElement).toBe(deleteButton.parentElement);
    expect(editButton.parentElement?.className).toContain("top-6 right-6");
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("does not render edit button when onEdit is not provided", () => {
    render(<FlashcardScrollItem learningItem={baseLearningItem} onRate={() => undefined} />);
    expect(screen.queryByTestId("review-card-edit")).not.toBeInTheDocument();
  });

  it("triggers onEdit on Cmd+E or Ctrl+E when focus is inside the card", () => {
    const onEdit = vi.fn();
    const { container } = render(
      <FlashcardScrollItem
        learningItem={baseLearningItem}
        onRate={() => undefined}
        onEdit={onEdit}
      />
    );
    const card = container.firstChild as HTMLElement;

    fireEvent.keyDown(card, { key: "e", metaKey: true });
    expect(onEdit).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(card, { key: "E", ctrlKey: true });
    expect(onEdit).toHaveBeenCalledTimes(2);
  });
});

