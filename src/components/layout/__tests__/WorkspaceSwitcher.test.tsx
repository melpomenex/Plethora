import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../stores/uiStore", () => ({ useUIStore: { getState: () => ({ setSidebarCollapsed: vi.fn(), setCurrentView: vi.fn() }) } }));
vi.mock("../../../stores/collectionStore", () => ({ useCollectionStore: { getState: () => ({ activeCollectionId: null }), setState: vi.fn() } }));
// useSettingsStore is used both as a React hook (useI18n subscribes to the
// language setting) and via .getState(). Provide a callable mock that handles
// both forms.
vi.mock("../../../stores/settingsStore", () => {
  const state = { settings: { general: { restoreSession: true, language: "en" } } };
  const useSettingsStore: any = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});

import { WorkspaceSwitcher } from "../WorkspaceSwitcher";
import { createTabPane, useTabsStore } from "../../../stores/tabsStore";

const Content = () => null;

describe("WorkspaceSwitcher", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], rootPane: createTabPane([], null), closedTabs: [], activeTabHistory: [] });
  });

  it("filters open tabs and activates the selected tab in its pane", () => {
    const first = useTabsStore.getState().addTab({ title: "Reading queue", icon: null, type: "queue", content: Content, closable: true });
    const second = useTabsStore.getState().addTab({ title: "Research notes", icon: null, type: "documents", content: Content, closable: true });
    const onClose = vi.fn();
    render(<WorkspaceSwitcher isOpen onClose={onClose} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search open tabs" }), { target: { value: "research" } });
    expect(screen.queryByText("Reading queue")).not.toBeInTheDocument();
    expect(screen.queryByText("Recently closed")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Research notes/ }));

    expect((useTabsStore.getState().rootPane as ReturnType<typeof createTabPane>).activeTabId).toBe(second);
    expect(first).not.toBe(second);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers the last closed tab for recovery", () => {
    useTabsStore.getState().addTab({ title: "Keep open", icon: null, type: "queue", content: Content, closable: true });
    const id = useTabsStore.getState().addTab({ title: "Closed document", icon: null, type: "documents", content: Content, closable: true });
    useTabsStore.getState().closeTab(id);
    render(<WorkspaceSwitcher isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Reopen Closed document" }));
    expect(useTabsStore.getState().tabs.some((tab) => tab.title === "Closed document")).toBe(true);
  });
});
