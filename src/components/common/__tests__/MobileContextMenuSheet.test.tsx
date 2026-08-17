import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MobileContextMenuSheet } from "../MobileContextMenuSheet";

const mockUseMobileShell = vi.fn();

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => mockUseMobileShell(),
}));

describe("MobileContextMenuSheet responsive presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders centered modal dialog on desktop with close button and no drag handle", () => {
    mockUseMobileShell.mockReturnValue(false);
    const onClose = vi.fn();

    const { container } = render(
      <MobileContextMenuSheet open onClose={onClose} title="Learn this">
        <div>Content text</div>
      </MobileContextMenuSheet>
    );

    // Dialog role exists
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("items-center", "justify-center");

    // Title is shown
    expect(screen.getByText("Learn this")).toBeInTheDocument();
    expect(screen.getByText("Content text")).toBeInTheDocument();

    // Close button (X) is rendered on desktop
    const closeBtn = screen.getByRole("button", { name: /close/i });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Sheet container has desktop rounded-2xl and max-w classes
    const sheetPanel = document.querySelector(".mobile-context-menu-sheet");
    expect(sheetPanel).toHaveClass("rounded-2xl", "border");
  });

  it("renders bottom sheet with drag handle on mobile", () => {
    mockUseMobileShell.mockReturnValue(true);
    const onClose = vi.fn();

    render(
      <MobileContextMenuSheet open onClose={onClose} title="Learn this">
        <div>Mobile content</div>
      </MobileContextMenuSheet>
    );

    // Bottom-anchored on mobile
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("justify-end");

    // Sheet panel is rounded top only on mobile
    const sheetPanel = document.querySelector(".mobile-context-menu-sheet");
    expect(sheetPanel).toHaveClass("rounded-t-2xl");

    // Content is rendered
    expect(screen.getByText("Mobile content")).toBeInTheDocument();
  });

  it("dismisses on Escape key press", () => {
    mockUseMobileShell.mockReturnValue(false);
    const onClose = vi.fn();

    render(
      <MobileContextMenuSheet open onClose={onClose} title="Test Sheet">
        <div>Content</div>
      </MobileContextMenuSheet>
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
