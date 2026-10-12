import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockUseMobileShell = vi.fn();

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => mockUseMobileShell(),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params?.count !== undefined) return `${key}:${params.count}`;
      return key;
    },
    locale: "en",
  }),
}));

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn().mockResolvedValue({
    id: "doc-1",
    title: "Test Document",
    category: "General",
    tags: ["test"],
    readingCount: 3,
  }),
  dismissDocument: vi.fn().mockResolvedValue(undefined),
  updateDocument: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../hooks/useItemStats", () => ({
  useItemStats: () => ({
    summary: null,
    isSummaryLoading: false,
    summaryError: null,
  }),
}));

vi.mock("../ItemStatsSummary", () => ({
  ItemStatsSummaryBlock: () => <div data-testid="item-stats-summary" />,
}));

vi.mock("../ItemCategoryEditor", () => ({
  ItemCategoryEditor: () => <div data-testid="item-category-editor" />,
}));

vi.mock("../ItemTagEditor", () => ({
  ItemTagEditor: () => <div data-testid="item-tag-editor" />,
}));

vi.mock("../../settings/LocalOnlyShieldToggle", () => ({
  LocalOnlyShieldToggle: () => <div data-testid="local-shield-toggle" />,
}));

import { ItemDetailsPopover, type ItemDetailsTarget } from "../ItemDetailsPopover";

describe("ItemDetailsPopover mobile bottom sheet & desktop UX", () => {
  const target: ItemDetailsTarget = {
    type: "document",
    id: "doc-1",
    title: "Test Document",
    category: "General",
    tags: ["test"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = "";
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("renders mobile bottom sheet portaled to document.body with scrim, drag handle, and pinned header", async () => {
    mockUseMobileShell.mockReturnValue(true);

    const { container } = render(
      <ItemDetailsPopover
        target={target}
        renderTrigger={({ onClick, isOpen }) => (
          <button data-testid="details-trigger" onClick={onClick}>
            {isOpen ? "Close" : "Details"}
          </button>
        )}
      />
    );

    // Initially closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Click trigger to open
    fireEvent.click(screen.getByTestId("details-trigger"));

    // Dialog is portaled to document.body, outside the wrapper container
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);

    // Dialog is bottom-aligned for mobile
    expect(dialog).toHaveClass("fixed", "inset-0", "justify-end");

    // Has dimmed backdrop scrim
    const scrim = dialog.querySelector(".bg-black\\/60");
    expect(scrim).toBeInTheDocument();

    // Has drag handle pill
    const dragPill = dialog.querySelector(".h-1.w-10.rounded-full");
    expect(dragPill).toBeInTheDocument();

    // Has pinned header with close button (X)
    const closeBtn = screen.getByLabelText("itemDetails.closeDetails");
    expect(closeBtn).toBeInTheDocument();

    // Has scrollable content container
    const scrollContainer = dialog.querySelector(".overflow-y-auto.overscroll-contain");
    expect(scrollContainer).toBeInTheDocument();

    // Has mobile bottom close button
    const bottomCloseBtn = screen.getByRole("button", { name: "common.close" });
    expect(bottomCloseBtn).toBeInTheDocument();

    // Body scroll was locked
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes via header close button on mobile and restores body scroll", async () => {
    mockUseMobileShell.mockReturnValue(true);

    render(
      <ItemDetailsPopover
        target={target}
        renderTrigger={({ onClick }) => (
          <button data-testid="details-trigger" onClick={onClick}>
            Details
          </button>
        )}
      />
    );

    fireEvent.click(screen.getByTestId("details-trigger"));
    const closeBtn = await screen.findByLabelText("itemDetails.closeDetails");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(closeBtn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes via mobile bottom close button", async () => {
    mockUseMobileShell.mockReturnValue(true);

    render(
      <ItemDetailsPopover
        target={target}
        renderTrigger={({ onClick }) => (
          <button data-testid="details-trigger" onClick={onClick}>
            Details
          </button>
        )}
      />
    );

    fireEvent.click(screen.getByTestId("details-trigger"));
    const bottomCloseBtn = await screen.findByRole("button", { name: "common.close" });

    fireEvent.click(bottomCloseBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ignores scrim clicks during open tap guard and dismisses after guard expires", async () => {
    mockUseMobileShell.mockReturnValue(true);

    render(
      <ItemDetailsPopover
        target={target}
        renderTrigger={({ onClick }) => (
          <button data-testid="details-trigger" onClick={onClick}>
            Details
          </button>
        )}
      />
    );

    const now = Date.now();
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(now);

    fireEvent.click(screen.getByTestId("details-trigger"));
    const dialog = await screen.findByRole("dialog");
    const scrim = dialog.querySelector(".bg-black\\/60")!;

    // Tap immediately (< 300ms) - should NOT close
    dateSpy.mockReturnValue(now + 100);
    fireEvent.click(scrim);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Tap after 300ms - should close
    dateSpy.mockReturnValue(now + 350);
    fireEvent.click(scrim);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    dateSpy.mockRestore();
  });

  it("dismisses on Escape key", async () => {
    mockUseMobileShell.mockReturnValue(true);

    render(
      <ItemDetailsPopover
        target={target}
        renderTrigger={({ onClick }) => (
          <button data-testid="details-trigger" onClick={onClick}>
            Details
          </button>
        )}
      />
    );

    fireEvent.click(screen.getByTestId("details-trigger"));
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders bounded dropdown with inner scrolling on desktop", async () => {
    mockUseMobileShell.mockReturnValue(false);

    const { container } = render(
      <ItemDetailsPopover
        target={target}
        renderTrigger={({ onClick }) => (
          <button data-testid="details-trigger" onClick={onClick}>
            Details
          </button>
        )}
      />
    );

    fireEvent.click(screen.getByTestId("details-trigger"));
    const dialog = await screen.findByRole("dialog");

    // Rendered inline inside the wrapper container on desktop
    expect(container.contains(dialog)).toBe(true);

    // Has desktop absolute positioning and height bounding
    expect(dialog).toHaveClass("absolute", "overflow-hidden");

    // Has inner scrolling
    const scrollContainer = dialog.querySelector(".overflow-y-auto.overscroll-contain");
    expect(scrollContainer).toBeInTheDocument();

    // Desktop does not render mobile drag pill or bottom close button
    expect(dialog.querySelector(".h-1.w-10.rounded-full")).toBeNull();
    expect(screen.queryByRole("button", { name: "common.close" })).not.toBeInTheDocument();

    // Body scroll was not locked on desktop
    expect(document.body.style.overflow).toBe("");
  });
});
