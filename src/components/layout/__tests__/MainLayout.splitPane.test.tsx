import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

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
  // Preserve the real synchronous platform helpers (isNativeMobile,
  // isNativePhone, nativePlatform, getPlatform, …) so the presentation layer
  // pulled in by the tour host can read them; only stub the async surface
  // that hits the Rust backend.
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
}));

import { MainLayout } from "../MainLayout";
import { createSplitPane, createTabPane, useTabsStore } from "../../../stores";
import { useDocumentStore } from "../../../stores/documentStore";

describe("MainLayout split-pane rendering", () => {
  beforeEach(() => {
    const left = createTabPane(["left-tab"], "left-tab");
    const right = createTabPane(["right-tab"], "right-tab");
    useTabsStore.setState({
      tabs: [
        { id: "left-tab", title: "Left", icon: null, type: "documents", content: Placeholder, closable: true },
        { id: "right-tab", title: "Right", icon: null, type: "queue", content: Placeholder, closable: true },
      ],
      rootPane: createSplitPane("horizontal", [left, right], [50, 50]),
      closedTabs: [],
      activeTabHistory: ["left-tab", "right-tab"],
      forwardTabHistory: [],
    });
    useDocumentStore.setState({ loadDocuments: vi.fn() });
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts a split layout without React maximum-update-depth errors", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<MainLayout />)).not.toThrow();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Maximum update depth exceeded"),
    );

    consoleError.mockRestore();
  });
});
