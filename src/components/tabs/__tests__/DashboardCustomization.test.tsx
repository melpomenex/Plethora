/**
 * OpenSpec integration tests for customize-dashboard-layout.
 * Spec: openspec/changes/customize-dashboard-layout/specs/dashboard-customization/spec.md
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "../../../test/utils";
import { DashboardTab } from "../DashboardTab";
import {
  DASHBOARD_LAYOUT_STORAGE_KEY,
  useDashboardLayoutStore,
} from "../../../stores/dashboardLayoutStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { useStartupStore } from "../../../stores/startupStore";

vi.mock("../../../api/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/analytics")>();
  return {
    ...actual,
    getDashboardStats: vi.fn().mockResolvedValue({
      total_documents: 8,
      cards_due_today: 3,
      due_documents: 2,
      cards_learned: 25,
      reviews_today: 4,
      daily_goal: 20,
    }),
  };
});

vi.mock("../../../api/review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/review")>();
  return {
    ...actual,
    getDueItems: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("../../../hooks/useCaptureActivity", () => ({
  useCaptureActivity: () => ({
    activity: {
      data: {
        windowDays: 30,
        perDay: [],
        bySource: [],
        needsAttention: 0,
      },
      isLoading: false,
      error: null,
    },
    captures: {
      data: { items: [], totalCount: 0, limit: 6, offset: 0 },
      isLoading: false,
      error: null,
      reload: vi.fn(),
    },
    reload: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useTTS", () => ({
  useTTS: () => ({
    isSpeaking: false,
    speak: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("../../common/Tabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/Tabs")>();
  return {
    ...actual,
    useIsActiveTab: () => true,
  };
});

describe("Dashboard customization (OpenSpec: customize-dashboard-layout)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useDashboardLayoutStore.getState().resetToDefault();
    useDocumentStore.setState({ documents: [] });
    useStartupStore.setState({
      snapshot: { continueReading: [] } as unknown as ReturnType<
        typeof useStartupStore.getState
      >["snapshot"],
    });
  });

  it("enters Customize mode from header button and exits via Done or Escape", () => {
    render(<DashboardTab />);

    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to default" })).toBeInTheDocument();
    expect(screen.getByText("9 of 9 sections visible")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customize" })).toBeInTheDocument();
  });

  it("enters Customize mode from the Dashboard surface context menu", () => {
    const { container } = render(<DashboardTab />);
    const surface = container.querySelector('[data-responsive-surface="dashboard"]');
    expect(surface).not.toBeNull();

    fireEvent.contextMenu(surface!, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Customize dashboard" }));

    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Customize" })).toBeInTheDocument();
  });

  it("reorders sections via Move Up/Down, persists to localStorage, and renders in the new order", () => {
    const { container } = render(<DashboardTab />);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    const moveQuickActionsUp = screen.getByRole("button", { name: "Move Quick Actions up" });
    fireEvent.click(moveQuickActionsUp);

    const sectionsInEdit = Array.from(
      container.querySelectorAll<HTMLElement>("[data-dashboard-section-id]"),
    ).map((el) => el.dataset.dashboardSectionId);
    expect(sectionsInEdit[0]).toBe("quick-actions");
    expect(sectionsInEdit[1]).toBe("focus");

    const persisted = JSON.parse(
      window.localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY) || "{}",
    );
    expect(persisted.sectionOrder[0]).toBe("quick-actions");
    expect(persisted.sectionOrder[1]).toBe("focus");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // In normal mode, Quick Actions heading appears before Quick Tip heading
    const quickTipEl = screen.getByText(/Quick Tip/);
    const quickActionsEl = screen.getByText("Flashcards");
    expect(
      quickActionsEl.compareDocumentPosition(quickTipEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides a section in normal mode while keeping a collapsed Hidden bar in Customize mode", () => {
    render(<DashboardTab />);
    expect(screen.getByText(/Quick Tip/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    const tipToggle = screen.getByRole("switch", { name: "Show Quick Tip" });
    fireEvent.click(tipToggle);

    const tipSection = screen.getByRole("region", { name: "Quick Tip" });
    expect(within(tipSection).getByText("Hidden")).toBeInTheDocument();
    expect(within(tipSection).queryByText(/Command Palette/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText(/Quick Tip/)).not.toBeInTheDocument();
  });

  it("shows recovery empty state when all sections are hidden and restores defaults", () => {
    render(<DashboardTab />);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    const switches = screen.getAllByRole("switch");
    for (const sw of switches) {
      fireEvent.click(sw);
    }

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("All Dashboard sections are hidden")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(screen.queryByText("All Dashboard sections are hidden")).not.toBeInTheDocument();
    expect(screen.getByText(/Quick Tip/)).toBeInTheDocument();
  });

  it("allows hiding and reordering Quick Actions tiles and resetting to default", () => {
    const { container } = render(<DashboardTab />);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Show Audiobooks in Quick Actions" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move Flashcards left" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Audiobooks")).not.toBeInTheDocument();

    const flashcardsTitle = screen.getByText("Flashcards");
    const readingQueueTitle = screen.getByText("Reading Queue");
    expect(
      flashcardsTitle.compareDocumentPosition(readingQueueTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Reset to default restores Audiobooks and default order
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByText("Audiobooks")).toBeInTheDocument();
    expect(
      container.querySelectorAll("[data-dashboard-section-id]").length,
    ).toBe(0);
  });

  it("allows adding a toolbar action via Quick Actions Picker and removing it", () => {
    render(<DashboardTab />);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    fireEvent.click(screen.getByRole("button", { name: "Add Quick Action" }));
    const picker = screen.getByTestId("quick-actions-picker");
    expect(picker).toBeInTheDocument();

    const searchInput = within(picker).getByRole("textbox", { name: "Search quick actions" });
    fireEvent.change(searchInput, { target: { value: "Knowledge Graph" } });

    const kgButton = within(picker).getByRole("button", { name: /Knowledge Graph/i });
    fireEvent.click(kgButton);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Knowledge Graph")).toBeInTheDocument();

    // Remove the added action in Customize mode
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Knowledge Graph from Quick Actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Knowledge Graph")).not.toBeInTheDocument();
  });

  it("allows adding and removing interactive dashboard widgets via the Widget Gallery", () => {
    render(<DashboardTab />);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));

    fireEvent.click(screen.getByRole("button", { name: "Add Widget" }));
    expect(screen.getByTestId("dashboard-widget-gallery")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Focus Timer widget" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Quick Scratchpad widget" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByText("Focus Timer")).toBeInTheDocument();
    expect(screen.getByLabelText("Quick Scratchpad")).toBeInTheDocument();

    // Scratchpad persists input locally
    fireEvent.change(screen.getByLabelText("Quick Scratchpad"), {
      target: { value: "Review chapter 4 notes" },
    });
    expect(window.localStorage.getItem("plethora_dashboard_scratchpad_v1")).toBe(
      "Review chapter 4 notes",
    );

    // Remove Focus Timer widget from its section header
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Focus Timer" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Focus Timer")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quick Scratchpad")).toBeInTheDocument();
  });
});
