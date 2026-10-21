import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "../../../test/utils";
import type { PresentationMode } from "../../../lib/presentation";

const presentation = vi.hoisted(() => ({
  mode: "phone" as PresentationMode,
}));

vi.mock("../../../contexts/PresentationContext", () => ({
  usePresentation: () => ({ mode: presentation.mode }),
}));

import { GraphNodeType, LayoutAlgorithm } from "../KnowledgeGraph";
import {
  GraphActiveFilterSummary,
  GraphFilterSheet,
  GraphFilterSidebar,
  createEmptyGraphFilters,
  type GraphFilters,
} from "../GraphFilters";

const nodeCounts = {
  [GraphNodeType.Document]: 10,
  [GraphNodeType.Extract]: 5,
  [GraphNodeType.Flashcard]: 2,
  [GraphNodeType.Category]: 0,
  [GraphNodeType.Tag]: 0,
  [GraphNodeType.Rss]: 0,
  [GraphNodeType.Concept]: 1,
};

function panelProps(
  filters: GraphFilters,
  onFiltersChange: ((filters: GraphFilters) => void) | React.Dispatch<React.SetStateAction<GraphFilters>> = vi.fn()
) {
  return {
    filters,
    onFiltersChange,
    availableCategories: ["Research", "Personal"],
    availableTags: ["ai", "memory"],
    layout: LayoutAlgorithm.Force,
    onLayoutChange: vi.fn(),
    nodeCounts,
    linkDistance: 120,
    onLinkDistanceChange: vi.fn(),
    nodeScale: 1,
    onNodeScaleChange: vi.fn(),
  };
}

beforeEach(() => {
  presentation.mode = "phone";
});

describe("GraphFilterSheet", () => {
  function Harness({ initial = createEmptyGraphFilters() }: { initial?: GraphFilters }) {
    const [open, setOpen] = useState(false);
    const [filters, setFilters] = useState(initial);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open filters
        </button>
        <GraphFilterSheet
          {...panelProps(filters, setFilters)}
          open={open}
          onClose={() => setOpen(false)}
          visibleCount={12}
          totalCount={20}
        />
      </>
    );
  }

  it("renders as a modal sheet with the live result count", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open filters" }));

    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toHaveClass("adaptive-dialog-sheet");
    expect(screen.getByText(/Choose which nodes and connections appear in the graph/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 12 nodes" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close filters" })).toHaveLength(2);
  });

  it("closes from the sheet CTA without clearing filters", () => {
    render(<Harness initial={{ ...createEmptyGraphFilters(), searchQuery: "memory" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Open filters" }));

    fireEvent.click(screen.getByRole("button", { name: "Show 12 nodes" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open filters" }));
    expect(screen.getByPlaceholderText("Search knowledge...")).toHaveValue("memory");
  });

  it("resets filters and closes on Escape with focus returned", () => {
    render(<Harness initial={{ ...createEmptyGraphFilters(), tags: ["ai"] }} />);
    const trigger = screen.getByRole("button", { name: "Open filters" });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByPlaceholderText("Search knowledge...")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Reset" })).toBeDisabled();

    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("focuses the search field when the caller opens from search", async () => {
    function SearchHarness() {
      const [open, setOpen] = useState(false);
      const [filters, setFilters] = useState(createEmptyGraphFilters());
      const searchRef = useRef<HTMLInputElement>(null);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open search
          </button>
          <GraphFilterSheet
            {...panelProps(filters, setFilters)}
            open={open}
            onClose={() => setOpen(false)}
            visibleCount={12}
            totalCount={20}
            searchInputRef={searchRef}
          />
        </>
      );
    }

    render(<SearchHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    const input = screen.getByPlaceholderText("Search knowledge...");
    await waitFor(() => expect(input).toHaveFocus());
  });
});

describe("GraphFilterSidebar", () => {
  it("shows the active count and visible total and resets filters", () => {
    const onFiltersChange = vi.fn();
    render(
      <GraphFilterSidebar
        {...panelProps(
          { ...createEmptyGraphFilters(), nodeTypes: [GraphNodeType.Document], tags: ["ai"] },
          onFiltersChange,
        )}
        visibleCount={7}
        totalCount={20}
      />,
    );

    expect(screen.getByRole("complementary", { name: "Graph filters" })).toBeInTheDocument();
    expect(screen.getByText("7 visible of 20 total")).toBeInTheDocument();
    expect(screen.getByTestId("graph-filter-active-count")).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onFiltersChange).toHaveBeenCalledWith(createEmptyGraphFilters());
    expect(screen.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument();
  });
});

describe("GraphActiveFilterSummary", () => {
  it("returns nothing when there are no filters", () => {
    const { container } = render(
      <GraphActiveFilterSummary filters={createEmptyGraphFilters()} onFiltersChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("removes only the clicked filter", () => {
    const onFiltersChange = vi.fn();
    const current = {
      ...createEmptyGraphFilters(),
      searchQuery: "graph",
      nodeTypes: [GraphNodeType.Document],
      categories: ["Research"],
      tags: ["ai"],
    };
    render(<GraphActiveFilterSummary filters={current} onFiltersChange={onFiltersChange} />);

    expect(screen.getByLabelText("Active filters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove filter Search: \"graph\"" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove #ai" }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...current, tags: [] });
  });

  it("clears every filter from the summary", () => {
    const onFiltersChange = vi.fn();
    render(
      <GraphActiveFilterSummary
        filters={{ ...createEmptyGraphFilters(), tags: ["ai"] }}
        onFiltersChange={onFiltersChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onFiltersChange).toHaveBeenCalledWith(createEmptyGraphFilters());
  });
});
