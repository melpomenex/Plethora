/** Real palette and queue layouts; deterministic data replaces native services. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { ThemeProvider } from "../contexts/ThemeContext";
import { PresentationProvider } from "../contexts/PresentationContext";
import { CommandCenter } from "../components/search/CommandCenter";
import { QueueTab } from "../components/tabs/QueueTab";
import { TabContent } from "../components/common/Tabs/TabContent";
import { useTabsStore } from "../stores/tabsStore";
import { useUIStore } from "../stores/uiStore";
import { useSavedQueueStore } from "../stores/savedQueueStore";
import { useQueueStore } from "../stores/queueStore";
import { useStartupStore } from "../stores/startupStore";
import { useDocumentStore } from "../stores/documentStore";
import { useCollectionStore } from "../stores/collectionStore";
import { Toast } from "../components/common/Toast";
import { SelectionTranslationDialog } from "../components/viewer/SelectionTranslationDialog";
import { usePaletteSelection, getPaletteSelection } from "../commandPalette/selectionTranslation";
import { usePaletteActionListener } from "../commandPalette/paletteActionEvents";
import type { PaletteSelection } from "../commandPalette/selectionTranslation";
import type { QueueItem } from "../types/queue";

const passage = "Bonjour. Comment allez-vous ?";
const profile = {
  id: "quick-review", name: "Quick Review", isDefault: false, sortOrder: 1,
  filters: { tags: ["study"], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: true },
  itemTypes: { documents: false, extracts: false, learningItems: true }, sessionDurationMinutes: 15, maxItems: 1,
  createdAt: "2026-10-16", updatedAt: "2026-10-16",
};
const items: QueueItem[] = [
  { id: "eligible", documentId: "doc-1", learningItemId: "card-1", documentTitle: "Eligible study card", itemType: "learning-item", tags: ["study"], priority: 5, estimatedTime: 2, progress: 0 },
  { id: "excluded", documentId: "doc-2", documentTitle: "Excluded reading item", itemType: "document", tags: ["other"], priority: 5, estimatedTime: 2, progress: 0 },
];
useCollectionStore.setState({ activeCollectionId: "col-default" });
useSavedQueueStore.setState({ savedQueues: [profile], activeQueueId: null, error: null, isLoading: false });
localStorage.setItem("plethora_saved_queues", JSON.stringify([profile]));
useQueueStore.setState({
  items, isLoading: false, error: null, hasCompletedFirstLoad: true, loadedQueryKey: "all-items",
  loadQueue: async () => {}, loadDueQueueItems: async () => {}, loadDueDocumentsOnly: async () => {}, loadStats: async () => {},
  setQueueFilterMode: (queueFilterMode) => useQueueStore.setState({ queueFilterMode }),
  applyRankSnapshot: async () => {},
});
useStartupStore.setState({ ensureStartup: async () => null });
useDocumentStore.setState({ documents: [{ id: "doc-1", title: "Selected document", fileType: "markdown", tags: [], collectionId: "col-default", dateAdded: "2026-10-16", dateModified: "2026-10-16", content: passage } as never], isLoading: false, hasCompletedFirstLoad: true });

function ReaderFixture() {
  const [translation, setTranslation] = useState<PaletteSelection | null>(null);
  usePaletteSelection({ documentId: "doc-1", tabId: "reader", paneId: "main", text: passage }, true);
  usePaletteActionListener("document-viewer", { "doc.translateSelection": () => setTranslation(getPaletteSelection()) });
  return <main className="p-6"><h1 className="text-xl">Selected document</h1><p className="my-4">{passage}</p>
    {translation && <SelectionTranslationDialog selection={translation} onClose={() => setTranslation(null)} />}
  </main>;
}

const tabs = [
  { id: "reader", type: "document-viewer" as const, title: "Selected document", content: ReaderFixture, closable: true, icon: null, data: { documentId: "doc-1" } },
  { id: "queue", type: "queue" as const, title: "Queue", content: QueueTab, closable: true, icon: null },
];
useTabsStore.setState({ tabs, rootPane: { id: "main", type: "tabs", tabIds: ["reader", "queue"], activeTabId: "reader" }, navigationPaneId: "main", activeTabHistory: ["reader"] });

function Harness() {
  const currentTabs = useTabsStore((state) => state.tabs);
  const root = useTabsStore((state) => state.rootPane);
  useEffect(() => {
    useSavedQueueStore.setState({ savedQueues: [profile], activeQueueId: null, error: null, isLoading: false });
    const navigate = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (path === "/queue") useTabsStore.getState().setActiveTab("main", "queue");
    };
    window.addEventListener("navigate", navigate);
    return () => window.removeEventListener("navigate", navigate);
  }, []);
  return <div className="flex h-screen flex-col bg-background text-foreground">
    <nav className="flex gap-3 border-b border-border p-3">
      <button onClick={() => useTabsStore.getState().setActiveTab("main", "reader")}>Document</button>
      <button onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}>Open commands</button>
    </nav>
    <div className="min-h-0 flex-1"><TabContent tabs={currentTabs} activeTabId={root.type === "tabs" ? root.activeTabId : null} paneId="main" /></div>
    <CommandCenter /><Toast />
  </div>;
}

createRoot(document.getElementById("root")!).render(<ThemeProvider><PresentationProvider><Harness /></PresentationProvider></ThemeProvider>);

(window as unknown as { paletteActionSession: () => unknown }).paletteActionSession = () =>
  useTabsStore.getState().tabs.filter((tab) => tab.type === "queue-scroll").at(-1)?.data;
