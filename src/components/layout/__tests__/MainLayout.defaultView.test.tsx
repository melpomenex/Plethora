import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

const { Placeholder } = vi.hoisted(() => ({ Placeholder: () => null }));

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
vi.mock("../../common/KeyboardShortcuts", () => ({ useShortcut: vi.fn() }));
vi.mock("../../../hooks/useKeyboardShortcuts", () => ({ useGlobalShortcuts: vi.fn() }));
vi.mock("../../../hooks/useMobileShell", () => ({ useMobileShell: () => false }));
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
}));

import { MainLayout } from "../MainLayout";
import { createTabPane, useTabsStore, type Pane } from "../../../stores";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useDocumentStore } from "../../../stores/documentStore";

/**
 * Settings ▸ Default View only took effect on a true cold boot (no saved
 * session). restoreSession defaults to true and a session gets saved after
 * the very first tab is opened, so on every subsequent launch loadTabs()
 * restored the prior session and the `!restored` branch that applied
 * defaultView never ran again — the preference silently stopped mattering.
 */
describe("MainLayout applies Default View after a restored session", () => {
  beforeEach(() => {
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
      forwardTabHistory: [],
    });

    useSettingsStore.getState().updateSettingsCategory("general", {
      restoreSession: true,
      defaultView: "analytics",
    });

    useDocumentStore.setState({ loadDocuments: vi.fn() });
  });

  afterEach(() => {
    cleanup();
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
});
