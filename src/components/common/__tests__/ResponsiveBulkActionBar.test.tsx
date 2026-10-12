import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResponsiveBulkActionBar, type BulkActionItem } from "../ResponsiveBulkActionBar";

describe("ResponsiveBulkActionBar", () => {
  const sampleActions: BulkActionItem[] = [
    { id: "tag", label: "Tag", onClick: vi.fn() },
    { id: "move", label: "Move", onClick: vi.fn() },
    { id: "suspend", label: "Suspend", onClick: vi.fn() },
    { id: "delete", label: "Delete", variant: "destructive", onClick: vi.fn() },
  ];

  it("renders nothing when selectedCount is 0", () => {
    const { container } = render(
      <ResponsiveBulkActionBar
        selectedCount={0}
        actions={sampleActions}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders desktop inline toolbar with count and actions by default", () => {
    const onClear = vi.fn();
    render(
      <ResponsiveBulkActionBar
        selectedCount={3}
        selectedCountLabel="3 selected"
        onClearSelection={onClear}
        actions={sampleActions}
      />
    );

    expect(screen.getByText("3 selected")).toBeInTheDocument();
    expect(screen.getByText("Tag")).toBeInTheDocument();
    expect(screen.getByText("Move")).toBeInTheDocument();
    expect(screen.getByText("Suspend")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Tag"));
    expect(sampleActions[0].onClick).toHaveBeenCalled();

    const clearButton = screen.getByLabelText(/clear/i);
    fireEvent.click(clearButton);
    expect(onClear).toHaveBeenCalled();
  });

  it("renders mobile floating toolbar and handles overflow sheet", () => {
    const onClear = vi.fn();
    render(
      <ResponsiveBulkActionBar
        selectedCount={2}
        selectedCountLabel="2 items selected"
        onClearSelection={onClear}
        actions={sampleActions}
        forceMobile={true}
      />
    );

    expect(screen.getByText("2 items selected")).toBeInTheDocument();

    // On mobile with 4 actions, the overflow trigger should be present
    const moreBtn = screen.getByLabelText("More actions");
    expect(moreBtn).toBeInTheDocument();

    fireEvent.click(moreBtn);

    // Overflow sheet opens with full list of actions
    const deleteBtns = screen.getAllByText("Delete");
    expect(deleteBtns.length).toBeGreaterThanOrEqual(1);

    // Click the delete action inside the sheet
    fireEvent.click(deleteBtns[deleteBtns.length - 1]);
    expect(sampleActions[3].onClick).toHaveBeenCalled();
  });

  it("renders custom children when passed", () => {
    render(
      <ResponsiveBulkActionBar selectedCount={1}>
        <button type="button">Custom Action</button>
      </ResponsiveBulkActionBar>
    );

    expect(screen.getByText("Custom Action")).toBeInTheDocument();
  });
});
