import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResponsiveBulkActionBar, type BulkActionItem } from "../ResponsiveBulkActionBar";

describe("Mobile Bulk Selection Toolbar Contract (mobile-bulk-selection-bar)", () => {
  const documentActions: BulkActionItem[] = [
    { id: "select-all", label: "Select All", onClick: vi.fn() },
    { id: "tag", label: "Tag", onClick: vi.fn() },
    { id: "move", label: "Move", onClick: vi.fn() },
    { id: "reprioritize", label: "Reprioritize", onClick: vi.fn() },
    { id: "suspend", label: "Suspend", onClick: vi.fn() },
    { id: "archive", label: "Archive", variant: "muted", onClick: vi.fn() },
    { id: "delete", label: "Delete", variant: "destructive", onClick: vi.fn() },
  ];

  it("renders a floating bar above the bottom navigation bar on mobile phones", () => {
    const onClear = vi.fn();
    render(
      <ResponsiveBulkActionBar
        selectedCount={1}
        selectedCountLabel="1 selected"
        onClearSelection={onClear}
        actions={documentActions}
        forceMobile={true}
      />
    );

    const toolbar = screen.getByTestId("responsive-bulk-action-bar");
    expect(toolbar).toBeInTheDocument();
    expect(toolbar.className).toContain("responsive-bulk-action-bar");
    expect(toolbar.className).toContain("fixed");
    expect(toolbar.className).toContain("bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]");

    // Single-line horizontal scroll track is present to prevent off-screen clipping
    const scrollTrack = toolbar.querySelector(".overflow-x-auto");
    expect(scrollTrack).not.toBeNull();
    expect(scrollTrack?.className).toContain("touch-pan-x");
    expect(scrollTrack?.className).toContain("flex-nowrap");

    // All actions are accessible in the scroll track
    expect(screen.getByText("Select All")).toBeInTheDocument();
    expect(screen.getByText("Tag")).toBeInTheDocument();
    expect(screen.getByText("Move")).toBeInTheDocument();
    expect(screen.getByText("Reprioritize")).toBeInTheDocument();
    expect(screen.getByText("Suspend")).toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("opens the overflow action sheet with all actions accessible on mobile", () => {
    render(
      <ResponsiveBulkActionBar
        selectedCount={1}
        selectedCountLabel="1 selected"
        actions={documentActions}
        forceMobile={true}
      />
    );

    const moreButton = screen.getByLabelText("More actions");
    expect(moreButton).toBeInTheDocument();
    fireEvent.click(moreButton);

    // Overflow sheet is open and displays all actions
    const archiveButtons = screen.getAllByText("Archive");
    expect(archiveButtons.length).toBeGreaterThanOrEqual(2); // One in horizontal bar, one in sheet
  });

  it("provides one-tap clear selection button in the compact badge", () => {
    const onClear = vi.fn();
    render(
      <ResponsiveBulkActionBar
        selectedCount={3}
        selectedCountLabel="3 selected"
        onClearSelection={onClear}
        actions={documentActions}
        forceMobile={true}
      />
    );

    const clearButton = screen.getByLabelText(/clear/i);
    fireEvent.click(clearButton);
    expect(onClear).toHaveBeenCalled();
  });

  it("renders inline header layout on desktop presentation", () => {
    render(
      <ResponsiveBulkActionBar
        selectedCount={2}
        selectedCountLabel="2 selected"
        actions={documentActions}
        forceMobile={false}
        desktopPresentation="inline"
      />
    );

    const toolbar = screen.getByTestId("responsive-bulk-action-bar");
    expect(toolbar.className).toContain("responsive-bulk-action-bar-inline");
    expect(toolbar.className).not.toContain("fixed");
  });
});
