import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BulkActionBar, selectionCapabilities } from "../BulkActionBar";
import type { QueueItem } from "../../../types/queue";

const item = (id: string, itemType: QueueItem["itemType"]): QueueItem =>
  ({
    id,
    documentId: `doc-${id}`,
    documentTitle: `Title ${id}`,
    itemType,
    priority: 5,
    estimatedTime: 3,
    tags: [],
    progress: 0,
  }) as QueueItem;

const noop = () => {};
const props = {
  isLoading: false,
  collections: [{ id: "c1", name: "Research" }],
  onSuspend: noop,
  onUnsuspend: noop,
  onDelete: noop,
  onClearSelection: noop,
  onSetPriority: noop,
  onPostpone: noop,
  onSmartPostpone: noop,
  onMoveToCollection: noop,
  onUpdateTags: noop,
  onLifecycle: noop,
  onOpenFlashcardStudio: noop,
};

describe("selectionCapabilities", () => {
  it("allows priority when the selection has documents or extracts", () => {
    expect(selectionCapabilities([item("a", "document")]).canPrioritize).toBe(true);
    expect(selectionCapabilities([item("a", "extract")]).canPrioritize).toBe(true);
  });

  it("denies priority for a flashcard-only selection", () => {
    // learning_items has no priority column at all.
    expect(selectionCapabilities([item("a", "learning-item")]).canPrioritize).toBe(false);
  });

  it("allows the AI studio only for an all-extract selection", () => {
    expect(selectionCapabilities([item("a", "extract"), item("b", "extract")]).canOpenStudio).toBe(true);
    expect(selectionCapabilities([item("a", "extract"), item("b", "document")]).canOpenStudio).toBe(false);
    expect(selectionCapabilities([]).canOpenStudio).toBe(false);
  });
});

describe("BulkActionBar (queue-bulk-actions)", () => {
  it("renders nothing when the selection is empty", () => {
    const { container } = render(<BulkActionBar {...props} selectedItems={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the selected count", () => {
    render(<BulkActionBar {...props} selectedItems={[item("a", "document"), item("b", "document")]} />);
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
  });

  it("disables the AI studio for a mixed selection and explains why", () => {
    render(<BulkActionBar {...props} selectedItems={[item("a", "extract"), item("b", "document")]} />);
    const studio = screen.getByTitle(/only extracts/i);
    expect(studio).toBeDisabled();
  });

  it("enables the AI studio for an all-extract selection", () => {
    render(<BulkActionBar {...props} selectedItems={[item("a", "extract")]} />);
    expect(screen.getByTitle("AI Studio")).not.toBeDisabled();
  });

  it("warns that flashcards will be skipped by a priority change", () => {
    render(<BulkActionBar {...props} selectedItems={[item("a", "learning-item")]} />);
    fireEvent.click(screen.getByTitle("Priority"));
    expect(screen.getByText(/no priority/i)).toBeInTheDocument();
  });

  it("applies the chosen priority value", () => {
    const onSetPriority = vi.fn();
    render(
      <BulkActionBar {...props} onSetPriority={onSetPriority} selectedItems={[item("a", "document")]} />,
    );
    fireEvent.click(screen.getByTitle("Priority"));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "80" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(onSetPriority).toHaveBeenCalledWith(80);
  });

  it("clamps an out-of-range priority instead of sending it", () => {
    const onSetPriority = vi.fn();
    render(
      <BulkActionBar {...props} onSetPriority={onSetPriority} selectedItems={[item("a", "document")]} />,
    );
    fireEvent.click(screen.getByTitle("Priority"));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "150" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(onSetPriority).toHaveBeenCalledWith(100);
  });

  it("offers the fixed postpone presets and smart postpone", () => {
    const onPostpone = vi.fn();
    render(<BulkActionBar {...props} onPostpone={onPostpone} selectedItems={[item("a", "document")]} />);
    fireEvent.click(screen.getByTitle("Postpone"));
    for (const label of ["+1d", "+3d", "+7d", "+30d"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText("+7d"));
    expect(onPostpone).toHaveBeenCalledWith(7);
  });

  it("moves to the chosen collection", () => {
    const onMoveToCollection = vi.fn();
    render(
      <BulkActionBar {...props} onMoveToCollection={onMoveToCollection} selectedItems={[item("a", "document")]} />,
    );
    fireEvent.click(screen.getByTitle("Move to collection"));
    fireEvent.click(screen.getByText("Research"));
    expect(onMoveToCollection).toHaveBeenCalledWith("c1");
  });

  it("sends tag additions and removals together", () => {
    const onUpdateTags = vi.fn();
    render(
      <BulkActionBar {...props} onUpdateTags={onUpdateTags} selectedItems={[item("a", "document")]} />,
    );
    fireEvent.click(screen.getByTitle("Add or remove tags"));
    fireEvent.change(screen.getByLabelText(/add tags/i), { target: { value: "physics, math" } });
    fireEvent.change(screen.getByLabelText(/remove tags/i), { target: { value: "old" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(onUpdateTags).toHaveBeenCalledWith(["physics", "math"], ["old"]);
  });

  it("exposes all three lifecycle transitions", () => {
    const onLifecycle = vi.fn();
    render(<BulkActionBar {...props} onLifecycle={onLifecycle} selectedItems={[item("a", "document")]} />);
    fireEvent.click(screen.getByTitle("Lifecycle"));
    fireEvent.click(screen.getByText("Forget"));
    expect(onLifecycle).toHaveBeenCalledWith("forget");
  });

  it("clears the selection from the close control", () => {
    const onClearSelection = vi.fn();
    render(
      <BulkActionBar {...props} onClearSelection={onClearSelection} selectedItems={[item("a", "document")]} />,
    );
    fireEvent.click(screen.getByLabelText("Clear selection"));
    expect(onClearSelection).toHaveBeenCalled();
  });

  it("disables actions while a bulk operation is in flight", () => {
    render(<BulkActionBar {...props} isLoading selectedItems={[item("a", "document")]} />);
    expect(screen.getByTitle("Priority")).toBeDisabled();
    expect(screen.getByTitle(/delete/i)).toBeDisabled();
  });
});
