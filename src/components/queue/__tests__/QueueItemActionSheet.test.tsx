import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { QueueItem } from "../../../types/queue";
import { QueueItemActionSheet } from "../QueueItemActionSheet";

const documentItem: QueueItem = {
  id: "doc-queue-1",
  documentId: "doc-1",
  documentTitle: "A document to read",
  itemType: "document",
  priority: 5,
  estimatedTime: 3,
  tags: [],
  progress: 0,
};

const learningItem: QueueItem = {
  id: "card-queue-1",
  documentId: "doc-1",
  documentTitle: "A card to review",
  itemType: "learning-item",
  priority: 5,
  estimatedTime: 1,
  tags: [],
  progress: 0,
};

describe("QueueItemActionSheet", () => {
  it("shows contextual document actions and restores focus on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open actions
          </button>
          <QueueItemActionSheet
            item={documentItem}
            open={open}
            onClose={() => setOpen(false)}
            triggerElement={screen.queryByRole("button", { name: "Open actions" })}
          />
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open actions" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Item actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Document" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Postpone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select for bulk actions" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("shows review actions for learning items and invokes the selected action", () => {
    const onStartReview = vi.fn();
    render(
      <QueueItemActionSheet
        item={learningItem}
        open
        onClose={vi.fn()}
        onStartReview={onStartReview}
      />,
    );

    expect(screen.getByRole("button", { name: "Study Now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Document" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Study Now" }));
    expect(onStartReview).toHaveBeenCalledWith("card-queue-1");
  });
});
