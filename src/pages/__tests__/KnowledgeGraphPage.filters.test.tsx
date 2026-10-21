import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "../../test/utils";
import type { PresentationMode } from "../../lib/presentation";

const presentation = vi.hoisted(() => ({
  mode: "phone" as PresentationMode,
}));
const activeTab = vi.hoisted(() => ({ value: true }));
const invokeCommand = vi.hoisted(() =>
  vi.fn(async (command: string) => {
    if (
      command === "get_documents" ||
      command === "get_extracts" ||
      command === "get_all_learning_items"
    ) {
      return [];
    }
    return null;
  }),
);

vi.mock("../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return { ...actual, invokeCommand };
});
vi.mock("../../api/documents", () => ({
  getDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));
vi.mock("../../api/extracts", () => ({
  updateExtract: vi.fn(),
  deleteExtract: vi.fn(),
}));
vi.mock("../../api/concept-links", () => ({
  listConcepts: vi.fn(async () => []),
  listConfirmedConceptLinks: vi.fn(async () => []),
  CONCEPT_LINKS_CHANGED_EVENT: "concept-links-changed",
}));
vi.mock("../../components/tabs/TabRegistry", () => ({
  DocumentViewer: () => null,
  ReviewTab: () => null,
}));
vi.mock("../../components/graph/ObsidianGraph", () => ({
  ObsidianGraph: () => <div data-testid="obsidian-graph" />,
}));
vi.mock("../../components/graph/KnowledgeUniverseLazy", () => ({
  KnowledgeUniverseLazy: () => <div data-testid="knowledge-universe" />,
}));
vi.mock("../../components/common/Tabs", () => ({
  useIsActiveTab: () => activeTab.value,
  usePaneId: () => undefined,
  useTabId: () => undefined,
  TabContent: () => null,
}));
vi.mock("../../components/common/Tabs/TabContent", () => ({
  useIsActiveTab: () => activeTab.value,
  usePaneId: () => undefined,
  useTabId: () => undefined,
  TabContent: () => null,
}));
vi.mock("../../contexts/PresentationContext", () => ({
  usePresentation: () => ({ mode: presentation.mode }),
}));

import { KnowledgeGraphPage } from "../KnowledgeGraphPage";

function filtersButton() {
  return screen.getByRole("button", { name: /Toggle filters/ });
}

async function renderPage() {
  const result = render(<KnowledgeGraphPage />);
  await screen.findByRole("heading", { name: "Knowledge Graph" });
  await waitFor(() => expect(screen.getByTestId("knowledge-graph-canvas")).toBeInTheDocument());
  return result;
}

beforeEach(() => {
  presentation.mode = "phone";
  activeTab.value = true;
  localStorage.clear();
  invokeCommand.mockClear();
});

describe("KnowledgeGraphPage filter workspace", () => {
  it("starts with the canvas unobstructed and opens a dismissible sheet", async () => {
    await renderPage();

    expect(screen.getByTestId("knowledge-graph-header")).toHaveAttribute("data-layout", "stacked");
    expect(filtersButton()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("status")).toHaveTextContent("0 visible of 0 total");
    expect(screen.getByTestId("obsidian-graph")).toBeInTheDocument();

    fireEvent.click(filtersButton());
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toHaveClass("adaptive-dialog-sheet");
    fireEvent.click(screen.getByRole("button", { name: "Show 0 nodes" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("obsidian-graph")).toBeInTheDocument();
  });

  it("shows removable active-filter chips after the sheet closes", async () => {
    await renderPage();

    fireEvent.click(filtersButton());
    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    fireEvent.click(screen.getByRole("button", { name: "Show 0 nodes" }));

    const summary = screen.getByLabelText("Active filters");
    expect(within(summary).getByRole("button", { name: "Remove filter Without Documents" })).toBeInTheDocument();

    fireEvent.click(within(summary).getByRole("button", { name: "Remove Without Documents" }));
    expect(within(summary).queryByRole("button", { name: "Remove filter Without Documents" })).not.toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: "Remove filter Without Extracts" })).toBeInTheDocument();
  });

  it("docks the sidebar on desktop and collapses it from the page control", async () => {
    presentation.mode = "desktop";
    await renderPage();

    expect(screen.getByTestId("knowledge-graph-header")).toHaveAttribute("data-layout", "single");
    expect(screen.getByRole("complementary", { name: "Graph filters" })).toBeInTheDocument();
    expect(filtersButton()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(filtersButton());
    expect(screen.queryByRole("complementary", { name: "Graph filters" })).not.toBeInTheDocument();
    expect(filtersButton()).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("plethora:knowledge-graph:sidebar-open:v1")).toContain('"desktop":false');
  });

  it("starts compact desktop with the sidebar collapsed", async () => {
    presentation.mode = "compact-desktop";
    await renderPage();

    expect(screen.getByTestId("knowledge-graph-header")).toHaveAttribute("data-layout", "single");
    expect(screen.queryByRole("complementary", { name: "Graph filters" })).not.toBeInTheDocument();
    expect(filtersButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps header and sheet search in sync", async () => {
    presentation.mode = "desktop";
    await renderPage();

    const headerSearch = screen.getByPlaceholderText("Search nodes...");
    fireEvent.change(headerSearch, { target: { value: "memory" } });
    expect(screen.getByPlaceholderText("Search knowledge...")).toHaveValue("memory");
  });

  it("closes the portalled sheet when the tab becomes inactive", async () => {
    const { rerender } = await renderPage();
    fireEvent.click(filtersButton());
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();

    activeTab.value = false;
    rerender(<KnowledgeGraphPage />);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument(),
    );
  });

  it("keeps the universe view inside the constrained canvas wrapper", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("radio", { name: /Universe/ }));
    const universe = screen.getByTestId("knowledge-universe");
    expect(universe.closest("[data-testid='knowledge-graph-canvas']")).not.toBeNull();
    expect(screen.getByTestId("knowledge-graph-canvas").className).toContain("min-h-0");
    expect(screen.getByTestId("knowledge-graph-canvas").className).toContain("min-w-0");
  });

  it("exposes the active count in the Filters accessible name", async () => {
    await renderPage();

    fireEvent.click(filtersButton());
    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    expect(screen.getByRole("button", { name: "Toggle filters, 7 active" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
