import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "../../../test/utils";
import type { PresentationMode } from "../../../lib/presentation";

const presentation = vi.hoisted(() => ({
  mode: "phone" as PresentationMode,
}));

vi.mock("../../../contexts/PresentationContext", () => ({
  usePresentation: () => ({ mode: presentation.mode }),
}));

import { KnowledgeGraphHeader } from "../KnowledgeGraphHeader";

function renderHeader(overrides: Partial<React.ComponentProps<typeof KnowledgeGraphHeader>> = {}) {
  const props = {
    visibleCount: 382,
    totalCount: 382,
    viewMode: "graph" as const,
    onViewModeChange: vi.fn(),
    filtersOpen: false,
    onToggleFilters: vi.fn(),
    onOpenSearch: vi.fn(),
    activeFilterCount: 0,
    searchQuery: "",
    onSearchQueryChange: vi.fn(),
    onExport: vi.fn(),
    onResetFilters: vi.fn(),
    ...overrides,
  };
  render(<KnowledgeGraphHeader {...props} />);
  return props;
}

beforeEach(() => {
  presentation.mode = "phone";
});

describe("KnowledgeGraphHeader", () => {
  it("uses a stacked, content-driven header on phones", () => {
    renderHeader();

    const header = screen.getByTestId("knowledge-graph-header");
    expect(header).toHaveAttribute("data-layout", "stacked");
    expect(header.className).toContain("flex-col");
    expect(header.className).toContain("min-h-16");
    expect(header.className.split(" ")).not.toContain("h-16");

    expect(screen.getByRole("heading", { name: "Knowledge Graph" })).toBeInTheDocument();
    expect(screen.getByText("382 visible of 382 total")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search knowledge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Graph view" })).toBeInTheDocument();
  });

  it("keeps the inline search and direct export on desktop", () => {
    presentation.mode = "desktop";
    const props = renderHeader({ activeFilterCount: 2 });

    const header = screen.getByTestId("knowledge-graph-header");
    expect(header).toHaveAttribute("data-layout", "single");
    expect(screen.getByPlaceholderText("Search nodes...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export graph" })).toBeInTheDocument();

    const filters = screen.getByRole("button", { name: "Toggle filters, 2 active" });
    expect(filters).toHaveAttribute("aria-expanded", "false");
    expect(filters).toHaveAttribute("aria-controls", "knowledge-graph-filter-panel");
    fireEvent.click(filters);
    expect(props.onToggleFilters).toHaveBeenCalledOnce();
  });

  it("moves secondary actions into the overflow menu on compact desktop", () => {
    presentation.mode = "compact-desktop";
    const props = renderHeader({ activeFilterCount: 1 });

    expect(screen.queryByPlaceholderText("Search nodes...")).not.toBeInTheDocument();
    const overflow = screen.getByRole("button", { name: "More actions" });
    fireEvent.click(overflow);

    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(menu).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Export graph" }));
    expect(props.onExport).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(overflow);
    fireEvent.keyDown(screen.getByRole("menu", { name: "More actions" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens search and forwards query changes", () => {
    presentation.mode = "desktop";
    const props = renderHeader({ searchQuery: "memory" });

    const input = screen.getByPlaceholderText("Search nodes...");
    fireEvent.change(input, { target: { value: "graph" } });
    expect(props.onSearchQueryChange).toHaveBeenCalledWith("graph");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(props.onSearchQueryChange).toHaveBeenLastCalledWith("");
  });

  it("offers filter reset in the overflow only when filters are active", () => {
    presentation.mode = "phone";
    renderHeader({ activeFilterCount: 0 });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Reset" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    cleanupHeader();
    const props = renderHeader({ activeFilterCount: 3 });
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset" }));
    expect(props.onResetFilters).toHaveBeenCalledOnce();
  });
});

function cleanupHeader() {
  cleanup();
}
