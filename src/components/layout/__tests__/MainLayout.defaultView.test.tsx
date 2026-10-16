import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const { Placeholder, autoPostpone, mobileShell } = vi.hoisted(() => ({
  Placeholder: () => null,
  autoPostpone: { run: vi.fn().mockResolvedValue({ status: "disabled" }) },
  mobileShell: { enabled: false },
}));

vi.mock("../../common/Tabs", () => ({ Tabs: Placeholder }));
vi.mock("../../Toolbar", () => ({ Toolbar: Placeholder }));
vi.mock("../../search/CommandCenter", () => ({ CommandCenter: Placeholder }));
vi.mock("../../common/ThemeBackdrop", () => ({ ThemeBackdrop: Placeholder }));
vi.mock("../../common/KeyboardShortcutsHelp", () => ({ KeyboardShortcutsHelp: Placeholder }));
vi.mock("../../viewer/ImageSaveOverlay", () => ({ ImageSaveOverlay: Placeholder }));
vi.mock("../WorkspaceSwitcher", () => ({ WorkspaceSwitcher: Placeholder }));
vi.mock("../../extracts/PasteExtractDialog", () => ({ PasteExtractDialog: Placeholder }));
vi.mock("../../documents/TwitterImportDialog", () => ({ TwitterImportDialog: Placeholder }));
vi.mock("../../mobile/MobileLayoutWrapper", () => ({
  MobileLayoutWrapper: ({ children }: { children: unknown }) => children,
}));
vi.mock("../../common/VimiumNavigation", () => ({
  VimiumNavigationProvider: ({ children }: { children: unknown }) => children,
  useVimiumEnabled: () => [false],
}));
vi.mock("../../common/LectureCaptureHost", () => ({ LectureCaptureHost: Placeholder }));
vi.mock("../../common/KeyboardShortcuts", () => ({ useShortcut: vi.fn() }));
vi.mock("../../../hooks/useKeyboardShortcuts", () => ({ useGlobalShortcuts: vi.fn() }));
vi.mock("../../../hooks/useMobileShell", () => ({ useMobileShell: () => mobileShell.enabled }));
vi.mock("../../../lib/autoPostponeSession", () => ({ runAutoPostponeSession: autoPostpone.run }));
vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    invokeCommand: vi.fn().mockResolvedValue(null),
    isTauri: () => false,
    listen: vi.fn().mockResolvedValue(() => {}),
  };
});
vi.mock("../../../utils/updateChecker", () => ({ checkForUpdates: vi.fn() }));
vi.mock("../../../lib/feedback", () => ({ emitFeedback: vi.fn() }));
vi.mock("../../common/Toast", () => ({
  ToastType: { Info: "info" },
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

// Unlike MainLayout.splitPane.test.tsx, this suite needs loadTabs()'s dynamic
// `import(".../TabRegistry")` to actually rehydrate tabs (not just render
// placeholders), so it provides a working `rehydrateTab` alongside the stubs.
vi.mock("../../tabs/TabRegistry", () => ({
  DashboardTab: Placeholder,
  QueueTab: Placeholder,
  QueueScrollPage: Placeholder,
  DocumentsTab: Placeholder,
  ReviewTab: Placeholder,
  AnalyticsTab: Placeholder,
  SettingsTab: Placeholder,
  WebBrowserTab: Placeholder,
  RssTab: Placeholder,
  PodcastTab: Placeholder,
  AudiobooksTab: Placeholder,
  KnowledgeSphereTab: Placeholder,
  KnowledgeNetworkTab: Placeholder,
  NewsletterDirectoryTab: Placeholder,
  DocumentQATab: Placeholder,
  NotebookLMTab: Placeholder,
  ImageRegistryTab: Placeholder,
  ImportNeedsReviewTab: Placeholder,
  DocumentViewer: Placeholder,
  rehydrateTab: (serialized: { id: string; title: string; icon: string; type: string; closable: boolean; data?: Record<string, unknown> }) => ({
    id: serialized.id,
    title: serialized.title,
    icon: serialized.icon,
    type: serialized.type,
    content: Placeholder,
    closable: serialized.closable,
    data: serialized.data,
  }),
  // MainLayout warms common tab chunks once the backend gate clears
  // (whenBackendReady().then(() => prefetchCommonTabs())). Omitting this
  // export turns that late promise into an unhandled rejection after the
  // test finishes.
  prefetchCommonTabs: vi.fn(),
  createCanonicalTab: (type: string) => ({
    type,
    title: type === "dashboard" ? "Dashboard" : type,
    icon: type === "dashboard" ? "📊" : "",
    content: Placeholder,
    closable: type !== "dashboard",
  }),
  resolveNearestAvailableTabType: (type: string) => type,
}));

import { MainLayout } from "../MainLayout";
import { createSplitPane, createTabPane, useTabsStore, type Pane } from "../../../stores";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useDocumentStore } from "../../../stores/documentStore";

const originalLoadTabs = useTabsStore.getState().loadTabs;

/**
 * Settings ▸ Default View only took effect on a true cold boot (no saved
 * session). restoreSession defaults to true and a session gets saved after
 * the very first tab is opened, so on every subsequent launch loadTabs()
 * restored the prior session and the `!restored` branch that applied
 * defaultView never ran again — the preference silently stopped mattering.
 */
describe("MainLayout applies Default View after a restored session", () => {
  beforeEach(() => {
    mobileShell.enabled = false;
    autoPostpone.run.mockClear();
    localStorage.clear();
    localStorage.setItem(
      "plethora-tabs",
      JSON.stringify({
        tabs: [
          { id: "restored-doc-tab", title: "Documents", icon: "📂", type: "documents", closable: true },
        ],
        rootPane: createTabPane(["restored-doc-tab"], "restored-doc-tab"),
      }),
    );

    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane(),
      closedTabs: [],
      activeTabHistory: [],
      loadTabs: originalLoadTabs,
    });

    useSettingsStore.getState().updateSettingsCategory("general", {
      restoreSession: true,
      defaultView: "analytics",
    });

    useDocumentStore.setState({ loadDocuments: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("focuses the configured default view without discarding the restored tabs", async () => {
    render(<MainLayout />);

    await waitFor(() => {
      const state = useTabsStore.getState();
      expect(state.tabs.some((tab) => tab.type === "analytics")).toBe(true);
    });

    const state = useTabsStore.getState();
    const restoredTab = state.tabs.find((tab) => tab.id === "restored-doc-tab");
    expect(restoredTab).toBeDefined();

    const analyticsTab = state.tabs.find((tab) => tab.type === "analytics");
    expect(analyticsTab).toBeDefined();

    function findPaneWithTab(pane: Pane, tabId: string): Pane | null {
      if (pane.type === "tabs") {
        return pane.tabIds.includes(tabId) ? pane : null;
      }
      for (const child of pane.children) {
        const found = findPaneWithTab(child, tabId);
        if (found) return found;
      }
      return null;
    }

    const paneWithAnalytics = findPaneWithTab(state.rootPane, analyticsTab!.id);
    expect(paneWithAnalytics?.type).toBe("tabs");
    expect(paneWithAnalytics && "activeTabId" in paneWithAnalytics ? paneWithAnalytics.activeTabId : null).toBe(
      analyticsTab!.id,
    );
  });

  it("keeps the restored Queue and adds a Dashboard base tab", async () => {
    localStorage.setItem(
      "plethora-tabs",
      JSON.stringify({
        tabs: [
          { id: "restored-queue-tab", title: "Queue", icon: "📚", type: "queue", closable: true },
        ],
        rootPane: createTabPane(["restored-queue-tab"], "restored-queue-tab"),
      }),
    );
    useSettingsStore.getState().updateSettingsCategory("general", {
      restoreSession: true,
      defaultView: "queue",
    });

    render(<MainLayout />);

    await waitFor(() => {
      expect(useTabsStore.getState().tabs.some((tab) => tab.type === "queue")).toBe(true);
    });

    const state = useTabsStore.getState();
    expect(state.tabs.find((tab) => tab.id === "restored-queue-tab")).toBeDefined();
    expect(state.tabs.filter((tab) => tab.type === "dashboard")).toHaveLength(1);
    expect(state.tabs.find((tab) => tab.type === "dashboard")).toMatchObject({
      title: "Dashboard",
      closable: false,
    });
    expect(state.rootPane.type === "tabs" ? state.rootPane.activeTabId : null).toBe("restored-queue-tab");
  });

  it("adds Dashboard to a restored split workspace without changing its panes or default focus", async () => {
    const leftPane = createTabPane(["restored-queue-tab"], "restored-queue-tab");
    const rightPane = createTabPane(["restored-doc-tab"], "restored-doc-tab");
    const savedRootPane = createSplitPane("horizontal", [leftPane, rightPane]);
    localStorage.setItem(
      "plethora-tabs",
      JSON.stringify({
        tabs: [
          { id: "restored-queue-tab", title: "Queue", icon: "📚", type: "queue", closable: true },
          { id: "restored-doc-tab", title: "Documents", icon: "📂", type: "documents", closable: true },
        ],
        rootPane: savedRootPane,
      }),
    );
    useSettingsStore.getState().updateSettingsCategory("general", {
      restoreSession: true,
      defaultView: "documents",
    });

    render(<MainLayout />);

    await waitFor(() => {
      expect(useTabsStore.getState().tabs.some((tab) => tab.type === "documents")).toBe(true);
    });

    const state = useTabsStore.getState();
    expect(state.rootPane).toMatchObject({
      type: "split",
      id: savedRootPane.id,
      children: [{ id: leftPane.id }, { id: rightPane.id }],
    });
    expect(state.tabs.map((tab) => tab.id)).toEqual(
      expect.arrayContaining(["restored-queue-tab", "restored-doc-tab"]),
    );
    expect(state.tabs.filter((tab) => tab.type === "dashboard")).toHaveLength(1);
    const focusedPane = state.rootPane.type === "split" ? state.rootPane.children[1] : null;
    expect(focusedPane?.type === "tabs" ? focusedPane.activeTabId : null).toBe("restored-doc-tab");
  });

  it("recovers Dashboard from an empty saved workspace and preserves Default View focus", async () => {
    localStorage.setItem(
      "plethora-tabs",
      JSON.stringify({ tabs: [], rootPane: createTabPane([], null) }),
    );
    useSettingsStore.getState().updateSettingsCategory("general", {
      restoreSession: true,
      defaultView: "analytics",
    });

    render(<MainLayout />);

    await waitFor(() => {
      expect(useTabsStore.getState().tabs.some((tab) => tab.type === "analytics")).toBe(true);
    });

    const state = useTabsStore.getState();
    expect(state.tabs.filter((tab) => tab.type === "dashboard")).toHaveLength(1);
    expect(state.tabs.find((tab) => tab.type === "dashboard")).toMatchObject({ title: "Dashboard", closable: false });
    const analyticsTab = state.tabs.find((tab) => tab.type === "analytics");
    expect(state.rootPane.type === "tabs" ? state.rootPane.activeTabId : null).toBe(analyticsTab?.id);
  });

  it("opens Dashboard through the shell navigation event when the workspace has no Dashboard", async () => {
    localStorage.removeItem("plethora-tabs");
    useSettingsStore.getState().updateSettingsCategory("general", {
      restoreSession: false,
      defaultView: "queue",
    });
    useTabsStore.setState({ tabs: [], rootPane: createTabPane(), closedTabs: [], activeTabHistory: [] });

    render(<MainLayout />);

    await waitFor(() => {
      expect(useTabsStore.getState().tabs.some((tab) => tab.type === "queue")).toBe(true);
    });
    act(() => {
      window.dispatchEvent(new CustomEvent("navigate", { detail: "/dashboard" }));
    });

    const state = useTabsStore.getState();
    expect(state.tabs.filter((tab) => tab.type === "dashboard")).toHaveLength(1);
    const dashboard = state.tabs.find((tab) => tab.type === "dashboard");
    expect(state.rootPane.type === "tabs" ? state.rootPane.activeTabId : null).toBe(dashboard?.id);
  });

  it("preserves a tab opened while restoration is pending and still recovers Dashboard", async () => {
    let finishRestore!: (restored: boolean) => void;
    const pendingRestore = new Promise<boolean>((resolve) => {
      finishRestore = resolve;
    });
    useTabsStore.setState({ loadTabs: () => pendingRestore });
    useSettingsStore.getState().updateSettingsCategory("general", {
      restoreSession: true,
      defaultView: "queue",
    });

    render(<MainLayout />);

    let queueId = "";
    act(() => {
      queueId = useTabsStore.getState().addTab({
        title: "Queue",
        icon: "📚",
        type: "queue",
        content: Placeholder,
        closable: true,
      });
    });
    await act(async () => {
      finishRestore(false);
      await pendingRestore;
    });

    await waitFor(() => {
      expect(useTabsStore.getState().tabs.some((tab) => tab.type === "dashboard")).toBe(true);
    });

    const state = useTabsStore.getState();
    expect(state.tabs.filter((tab) => tab.type === "queue")).toHaveLength(1);
    expect(state.tabs.find((tab) => tab.id === queueId)).toBeDefined();
    expect(state.tabs.filter((tab) => tab.type === "dashboard")).toHaveLength(1);
    expect(state.rootPane.type === "tabs" ? state.rootPane.activeTabId : null).toBe(queueId);
  });

  it("does not add the desktop Dashboard base tab to a restored mobile workspace", async () => {
    mobileShell.enabled = true;
    localStorage.setItem(
      "plethora-tabs",
      JSON.stringify({
        tabs: [
          { id: "mobile-restored-queue", title: "Queue", icon: "📚", type: "queue", closable: true },
        ],
        rootPane: createTabPane(["mobile-restored-queue"], "mobile-restored-queue"),
      }),
    );
    useSettingsStore.getState().updateSettingsCategory("general", {
      restoreSession: true,
      defaultView: "queue",
    });

    render(<MainLayout />);

    await waitFor(() => {
      expect(useTabsStore.getState().tabs.some((tab) => tab.type === "queue")).toBe(true);
    });

    expect(useTabsStore.getState().tabs.some((tab) => tab.type === "dashboard")).toBe(false);
  });

  it("starts the shared postpone session from the main mobile shell once", async () => {
    mobileShell.enabled = true;
    vi.useFakeTimers();
    render(<MainLayout />);

    expect(autoPostpone.run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(autoPostpone.run).toHaveBeenCalledTimes(1);
  });

  it("activates an existing destination tab instead of duplicating it", async () => {
    localStorage.removeItem("plethora-tabs");
    useSettingsStore.getState().updateSettingsCategory("general", {
      restoreSession: false,
      defaultView: "queue",
    });
    useTabsStore.setState({ tabs: [], rootPane: createTabPane(), closedTabs: [], activeTabHistory: [] });

    render(<MainLayout />);
    await waitFor(() => {
      expect(useTabsStore.getState().tabs.length).toBeGreaterThan(0);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("navigate", { detail: "/rss" }));
    });
    await waitFor(() => {
      expect(useTabsStore.getState().tabs.filter((tab) => tab.type === "rss")).toHaveLength(1);
    });
    const rssId = useTabsStore.getState().tabs.find((tab) => tab.type === "rss")!.id;

    // Navigate away, then invoke the destination again: the existing tab must
    // be re-activated rather than duplicated.
    act(() => {
      window.dispatchEvent(new CustomEvent("navigate", { detail: "/dashboard" }));
    });
    act(() => {
      window.dispatchEvent(new CustomEvent("navigate", { detail: "/rss" }));
    });

    const state = useTabsStore.getState();
    expect(state.tabs.filter((tab) => tab.type === "rss")).toHaveLength(1);
    const pane = state.findPaneContainingTab(rssId);
    expect(pane?.type === "tabs" ? pane.activeTabId : null).toBe(rssId);
  });
});
