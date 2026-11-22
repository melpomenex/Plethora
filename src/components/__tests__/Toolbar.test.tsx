import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toolbar } from "../Toolbar";
import { Tabs } from "../common/Tabs/Tabs";
import { useTabsStore, createTabPane } from "../../stores";
import { useAudioEditionGenerationStore } from "../../stores/audioEditionGenerationStore";

function resetTabsStore() {
  useTabsStore.setState({
    tabs: [],
    rootPane: createTabPane([], null),
    closedTabs: [],
    activeTabHistory: [],
  });
}

describe("Toolbar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTabsStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["an empty workspace", false],
    ["a Queue-only workspace", true],
  ])("opens one Dashboard from %s", (_label, queueOnly) => {
    if (queueOnly) {
      useTabsStore.getState().addTab({
        title: "Queue",
        icon: null,
        type: "queue",
        content: () => null,
        closable: true,
      });
    }

    render(<Toolbar position="top" />);
    const dashboardButton = screen.getByRole("button", { name: "Dashboard" });
    expect(dashboardButton).toHaveAttribute("title", "Dashboard (Ctrl+D)");

    act(() => {
      dashboardButton.click();
    });

    let state = useTabsStore.getState();
    const dashboard = state.tabs.find((tab) => tab.type === "dashboard");
    expect(state.tabs.filter((tab) => tab.type === "dashboard")).toHaveLength(1);
    expect(dashboard).toMatchObject({ title: "Dashboard", icon: "📊", closable: false });
    expect(state.rootPane.type === "tabs" ? state.rootPane.activeTabId : null).toBe(dashboard?.id);
    if (queueOnly) expect(state.tabs.some((tab) => tab.type === "queue")).toBe(true);

    act(() => {
      dashboardButton.click();
    });
    state = useTabsStore.getState();
    expect(state.tabs.filter((tab) => tab.type === "dashboard")).toHaveLength(1);
    expect(state.rootPane.type === "tabs" ? state.rootPane.activeTabId : null).toBe(dashboard?.id);
  });

  it.each(["top", "left", "right"] as const)("displays a detached Dashboard from the %s toolbar without duplicating it", (position) => {
    // Matches the installed app's saved session: Dashboard exists in tabs,
    // but the pane only contains Queue and Documents.
    useTabsStore.setState({
      tabs: [
        { id: "dashboard", title: "Dashboard", icon: "📊", type: "dashboard", content: () => <div>Recovered dashboard content</div>, closable: false },
        { id: "queue", title: "Queue", icon: null, type: "queue", content: () => <div>Queue content</div>, closable: true },
        { id: "documents", title: "Documents", icon: null, type: "documents", content: () => null, closable: true },
      ],
      rootPane: createTabPane(["queue", "documents"], "queue"),
      navigationByPane: {},
      activeTabHistory: ["queue"],
    });
    render(<><Toolbar position={position} /><Tabs /></>);
    const dashboardButton = screen.getByRole("button", { name: "Dashboard" });

    fireEvent.click(dashboardButton);

    expect(screen.getByText("Recovered dashboard content").closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("Queue content").closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
    expect(useTabsStore.getState().tabs.map(tab => tab.id)).toEqual(["dashboard", "queue", "documents"]);
    fireEvent.click(dashboardButton);
    expect(useTabsStore.getState().tabs.filter(tab => tab.type === "dashboard")).toHaveLength(1);
    expect(useTabsStore.getState().findPaneContainingTab("dashboard")?.activeTabId).toBe("dashboard");
  });

  it("the Extracts button opens the library-wide extracts tab and reuses an already-open one", () => {
    render(<Toolbar position="top" />);

    const extractsButton = screen.getByRole("button", { name: "Extracts" });
    expect(extractsButton).toBeInTheDocument();

    act(() => {
      extractsButton.click();
    });
    let tabs = useTabsStore.getState().tabs;
    expect(tabs.filter((tab) => tab.type === "extracts")).toHaveLength(1);

    // Clicking again must reuse the open tab (single-instance), not add a second.
    act(() => {
      extractsButton.click();
    });
    tabs = useTabsStore.getState().tabs;
    expect(tabs.filter((tab) => tab.type === "extracts")).toHaveLength(1);
  });

  it("middle-clicking a toolbar button opens that item in split screen when a tab is already open", () => {
    render(<Toolbar position="left" />);

    // Open Dashboard first so there is an active pane to split against
    const dashboardButton = screen.getByRole("button", { name: "Dashboard" });
    act(() => {
      dashboardButton.click();
    });
    expect(useTabsStore.getState().rootPane.type).toBe("tabs");
    expect(useTabsStore.getState().getTabPaneIds()).toHaveLength(1);

    // Middle-click Extracts -> should split horizontally and open Extracts in the new pane
    const extractsButton = screen.getByRole("button", { name: "Extracts" });
    act(() => {
      extractsButton.dispatchEvent(
        new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
      );
    });

    const state = useTabsStore.getState();
    expect(state.rootPane.type).toBe("split");
    if (state.rootPane.type === "split") {
      expect(state.rootPane.direction).toBe("horizontal");
    }
    const paneIds = state.getTabPaneIds();
    expect(paneIds).toHaveLength(2);

    const extractsTab = state.tabs.find((tab) => tab.type === "extracts");
    expect(extractsTab).toBeDefined();
    const extractsPane = state.findPaneContainingTab(extractsTab!.id);
    expect(extractsPane?.id).toBe(paneIds[1]);
    expect(extractsPane?.activeTabId).toBe(extractsTab!.id);

    // Middle-clicking another button (e.g. Settings) when already in split view opens it in the other pane
    const leftPaneId = paneIds[0];
    const dashboardTab = state.tabs.find((tab) => tab.type === "dashboard")!;
    act(() => {
      state.setActiveTab(leftPaneId, dashboardTab.id);
    });

    const settingsButton = screen.getByRole("button", { name: "Settings" });
    act(() => {
      settingsButton.dispatchEvent(
        new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
      );
    });

    const nextState = useTabsStore.getState();
    expect(nextState.getTabPaneIds()).toHaveLength(2);
    const settingsTab = nextState.tabs.find((tab) => tab.type === "settings");
    expect(settingsTab).toBeDefined();
    const settingsPane = nextState.findPaneContainingTab(settingsTab!.id);
    expect(settingsPane?.id).toBe(paneIds[1]);
    expect(settingsPane?.activeTabId).toBe(settingsTab!.id);
  });

  it("middle-clicking a toolbar button whose tab is already open in the same pane splits it into its own pane", () => {
    render(<Toolbar position="left" />);

    act(() => {
      screen.getByRole("button", { name: "Dashboard" }).click();
      screen.getByRole("button", { name: "Go to Queue" }).click();
      screen.getByRole("button", { name: "Dashboard" }).click();
    });
    expect(useTabsStore.getState().getTabPaneIds()).toHaveLength(1);

    // Middle-click Queue -> moves Queue into a new split pane on the right
    act(() => {
      screen.getByRole("button", { name: "Go to Queue" }).dispatchEvent(
        new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
      );
    });

    const state = useTabsStore.getState();
    const paneIds = state.getTabPaneIds();
    expect(paneIds).toHaveLength(2);
    const queueTab = state.tabs.find((tab) => tab.type === "queue")!;
    expect(state.findPaneContainingTab(queueTab.id)?.id).toBe(paneIds[1]);
    expect(state.tabs.filter((tab) => tab.type === "queue")).toHaveLength(1);
  });

  it("middle-clicking a toolbar button in an empty workspace opens it normally without creating an empty split pane", () => {
    render(<Toolbar position="left" />);

    const rssButton = screen.getByRole("button", { name: "RSS Feeds" });
    act(() => {
      rssButton.dispatchEvent(
        new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
      );
    });

    const state = useTabsStore.getState();
    expect(state.getTabPaneIds()).toHaveLength(1);
    expect(state.tabs.filter((tab) => tab.type === "rss")).toHaveLength(1);
  });

  it("expands after the open delay on hover and collapses after the close delay on leave", () => {
    const { container } = render(<Toolbar position="left" />);
    const rail = container.querySelector(".toolbar-rail")!;
    expect(rail).not.toHaveAttribute("data-expanded");

    act(() => {
      fireEvent.pointerEnter(rail);
    });
    // Still collapsed inside the open delay.
    act(() => {
      vi.advanceTimersByTime(119);
    });
    expect(rail).not.toHaveAttribute("data-expanded");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(rail).toHaveAttribute("data-expanded");

    act(() => {
      fireEvent.pointerLeave(rail);
    });
    // Still expanded inside the close delay.
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(rail).toHaveAttribute("data-expanded");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(rail).not.toHaveAttribute("data-expanded");
  });

  it("does not expand when the pointer merely crosses the rail (shorter than the open delay)", () => {
    const { container } = render(<Toolbar position="right" />);
    const rail = container.querySelector(".toolbar-rail")!;

    act(() => {
      fireEvent.pointerEnter(rail);
      fireEvent.pointerLeave(rail);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(rail).not.toHaveAttribute("data-expanded");
  });

  it("expands immediately when a button receives keyboard focus and collapses when focus leaves", () => {
    const { container } = render(<Toolbar position="top" />);
    const rail = container.querySelector(".toolbar-rail")!;
    expect(rail).not.toHaveAttribute("data-expanded");

    const firstButton = screen.getAllByRole("button")[0];
    act(() => {
      fireEvent.focusIn(firstButton);
    });
    // No delay for focus: expanded right away.
    expect(rail).toHaveAttribute("data-expanded");

    act(() => {
      fireEvent.focusOut(firstButton, { relatedTarget: null });
    });
    // No close delay for focus either (pointer is not on the rail).
    expect(rail).not.toHaveAttribute("data-expanded");
  });

  it("stays expanded when focus moves between toolbar buttons (focus never leaves the rail)", () => {
    const { container } = render(<Toolbar position="top" />);
    const rail = container.querySelector(".toolbar-rail")!;
    const buttons = screen.getAllByRole("button");

    act(() => {
      fireEvent.focusIn(buttons[0]);
    });
    expect(rail).toHaveAttribute("data-expanded");

    // Focus moves to another button inside the rail: must not collapse.
    act(() => {
      fireEvent.focusOut(buttons[0], { relatedTarget: buttons[1] });
      fireEvent.focusIn(buttons[1]);
    });
    expect(rail).toHaveAttribute("data-expanded");
  });

  it("does not collapse when a click outside blurs the rail while the pointer still hovers it", () => {
    const { container } = render(<Toolbar position="left" />);
    const rail = container.querySelector(".toolbar-rail")!;
    const firstButton = screen.getAllByRole("button")[0];

    // Pointer enters and rests (expanded after the open delay).
    act(() => {
      fireEvent.pointerEnter(rail);
      vi.advanceTimersByTime(120);
    });
    expect(rail).toHaveAttribute("data-expanded");

    // The focused button blurs (click into the content area) while the pointer
    // is still over the rail: must stay expanded.
    act(() => {
      fireEvent.focusIn(firstButton);
      fireEvent.focusOut(firstButton, { relatedTarget: null });
    });
    expect(rail).toHaveAttribute("data-expanded");

    // Only once the pointer actually leaves does the rail collapse.
    act(() => {
      fireEvent.pointerLeave(rail);
      vi.advanceTimersByTime(250);
    });
    expect(rail).not.toHaveAttribute("data-expanded");
  });

  it("collapses when the pointer leaves after a button received focus", () => {
    const { container } = render(<Toolbar position="right" />);
    const rail = container.querySelector(".toolbar-rail")!;
    const firstButton = screen.getAllByRole("button")[0];

    act(() => {
      fireEvent.focusIn(firstButton);
    });
    expect(rail).toHaveAttribute("data-expanded");

    // Pointer leaves after hover/focus: rail must collapse after the close delay.
    act(() => {
      fireEvent.pointerEnter(rail);
      fireEvent.pointerLeave(rail);
      vi.advanceTimersByTime(250);
    });
    expect(rail).not.toHaveAttribute("data-expanded");
  });

  it("collapses immediately when active tab changes", () => {
    const { container } = render(<Toolbar position="left" />);
    const rail = container.querySelector(".toolbar-rail")!;

    act(() => {
      fireEvent.pointerEnter(rail);
      vi.advanceTimersByTime(120);
    });
    expect(rail).toHaveAttribute("data-expanded");

    // Switching active tab (e.g. entering Settings mode) collapses the rail immediately
    act(() => {
      useTabsStore.setState({
        activeTabHistory: ["settings-tab-id"],
      });
    });
    expect(rail).not.toHaveAttribute("data-expanded");
  });

  it("collapses immediately when clicking outside the expanded rail", () => {
    const { container } = render(
      <div>
        <div data-testid="outside-area">Outside</div>
        <Toolbar position="left" />
      </div>,
    );
    const rail = container.querySelector(".toolbar-rail")!;
    const outsideArea = screen.getByTestId("outside-area");

    act(() => {
      fireEvent.pointerEnter(rail);
      vi.advanceTimersByTime(120);
    });
    expect(rail).toHaveAttribute("data-expanded");

    act(() => {
      fireEvent.pointerDown(outsideArea);
    });
    expect(rail).not.toHaveAttribute("data-expanded");
  });

  it("expands for the top position too (label row overlays downward)", () => {
    const { container } = render(<Toolbar position="top" />);
    const rail = container.querySelector(".toolbar-rail")!;
    expect(rail).toHaveAttribute("data-toolbar-position", "top");

    act(() => {
      fireEvent.pointerEnter(rail);
      vi.advanceTimersByTime(120);
    });
    expect(rail).toHaveAttribute("data-expanded");

    act(() => {
      fireEvent.pointerLeave(rail);
      vi.advanceTimersByTime(250);
    });
    expect(rail).not.toHaveAttribute("data-expanded");
  });

  it("annotates the rail with the toolbar position", () => {
    const { container } = render(<Toolbar position="right" />);
    expect(container.querySelector(".toolbar-rail")).toHaveAttribute(
      "data-toolbar-position",
      "right",
    );
  });

  it("displays an active synthesis badge on the Audiobooks button when activeJobs.length > 0", () => {
    useAudioEditionGenerationStore.setState({ activeJobs: [] });
    const { rerender } = render(<Toolbar position="top" />);

    expect(screen.queryByTestId("audiobook-synthesis-badge")).not.toBeInTheDocument();

    act(() => {
      useAudioEditionGenerationStore.setState({ activeJobs: ["ed-1"] });
    });
    rerender(<Toolbar position="top" />);

    expect(screen.getByTestId("audiobook-synthesis-badge")).toBeInTheDocument();

    act(() => {
      useAudioEditionGenerationStore.setState({ activeJobs: [] });
    });
    rerender(<Toolbar position="top" />);

    expect(screen.queryByTestId("audiobook-synthesis-badge")).not.toBeInTheDocument();
  });

  it("the Saved Queues button opens the Queue tab and dispatches plethora:manage-saved-queues", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(<Toolbar position="top" />);

    const savedQueuesBtn = screen.getByRole("button", { name: "Saved Queues" });
    expect(savedQueuesBtn).toBeInTheDocument();

    act(() => {
      savedQueuesBtn.click();
      vi.advanceTimersByTime(200);
    });

    const tabs = useTabsStore.getState().tabs;
    expect(tabs.filter((tab) => tab.type === "queue")).toHaveLength(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "plethora:manage-saved-queues" }),
    );
  });
});
