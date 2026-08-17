import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toolbar } from "../Toolbar";
import { useTabsStore, createTabPane } from "../../stores";

function resetTabsStore() {
  useTabsStore.setState({
    tabs: [],
    rootPane: createTabPane([], null),
    closedTabs: [],
    activeTabHistory: [],
    forwardTabHistory: [],
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

  it("middle-clicking the Extracts button adds the tab in the background", () => {
    render(<Toolbar position="top" />);

    const extractsButton = screen.getByRole("button", { name: "Extracts" });
    act(() => {
      extractsButton.dispatchEvent(
        new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
      );
    });

    const tabs = useTabsStore.getState().tabs;
    expect(tabs.filter((tab) => tab.type === "extracts")).toHaveLength(1);
    // Background open must not activate the tab (active history stays empty).
    expect(useTabsStore.getState().activeTabHistory).not.toContain(
      tabs.find((tab) => tab.type === "extracts")?.id,
    );
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
});
