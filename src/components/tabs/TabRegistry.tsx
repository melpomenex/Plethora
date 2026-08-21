import { lazy, type ComponentType } from "react";
import type { TabType } from "../../stores/tabsStore";
import { importWithRetry } from "../../utils/importWithRetry";

// Central registry of all lazy-loaded tab components
// Components use named exports, so we need to convert them to default exports

/** Wrap a lazy import with timeout + retry (WebView chunk stalls) and error
 * logging to identify which module fails to load */
function debugLazy<T extends ComponentType<unknown>>(
  name: string,
  loader: () => Promise<{ default: T }>
) {
  return lazy(() =>
    importWithRetry(name, loader).catch((err) => {
      console.error(`[TabRegistry] Failed to lazy-load "${name}":`, err);
      // Re-throw so React.lazy triggers the error boundary
      throw err;
    })
  );
}

export const DashboardTab = debugLazy("DashboardTab", () => import("./DashboardTab").then(m => ({ default: m.DashboardTab })));
export const ContinueReadingTab = debugLazy("ContinueReadingTab", () => import("./ContinueReadingTab").then(m => ({ default: m.ContinueReadingTab })));
export const QueueTab = debugLazy("QueueTab", () => import("./QueueTab").then(m => ({ default: m.QueueTab })));
export const QueueScrollPage = debugLazy("QueueScrollPage", () => import("../../pages/QueueScrollPage").then(m => ({ default: m.QueueScrollPage })));
export const ReviewTab = debugLazy("ReviewTab", () => import("./ReviewTab").then(m => ({ default: m.ReviewTab })));
export const DocumentsTab = debugLazy("DocumentsTab", () => import("./DocumentsTab").then(m => ({ default: m.DocumentsTab })));
export const AnalyticsTab = debugLazy("AnalyticsTab", () => import("./AnalyticsTab").then(m => ({ default: m.AnalyticsTab })));
export const SettingsTab = debugLazy("SettingsTab", () => import("../settings/SettingsPage").then(m => ({ default: m.SettingsPage })));

export const DocumentViewer = debugLazy("DocumentViewer", () => import("../viewer/DocumentViewerWrapper").then(m => ({ default: m.DocumentViewer })));
export const DocumentExtractsTab = debugLazy("DocumentExtractsTab", () => import("./DocumentExtractsTab").then(m => ({ default: m.DocumentExtractsTab })));
export const ExtractsTab = debugLazy("ExtractsTab", () => import("./ExtractsTab").then(m => ({ default: m.ExtractsTab })));
export const ExtractReader = debugLazy("ExtractReader", () => import("./ExtractReader").then(m => ({ default: m.ExtractReader })));
export const KnowledgeNetworkTab = debugLazy("KnowledgeNetworkTab", () => import("./knowledge/KnowledgeNetworkTab").then(m => ({ default: m.KnowledgeNetworkTab })));
export const KnowledgeSphereTab = debugLazy("KnowledgeSphereTab", () => import("./knowledge/KnowledgeSphereTab").then(m => ({ default: m.KnowledgeSphereTab })));
export const WebBrowserTab = debugLazy("WebBrowserTab", () => import("./WebBrowserTab").then(m => ({ default: m.WebBrowserTab })));
export const RssTab = debugLazy("RssTab", () => import("./RssTab").then(m => ({ default: m.RssTab })));
export const RSSReader = debugLazy("RSSReader", () => import("../media/RSSReader").then(m => ({ default: m.RSSReader })));
export const NewsletterDirectoryTab = debugLazy("NewsletterDirectoryTab", () => import("../newsletter/NewsletterDirectory").then(m => ({ default: m.NewsletterDirectory })));
export const ScreenshotTab = debugLazy("ScreenshotTab", () => import("./ScreenshotTab").then(m => ({ default: m.ScreenshotTab })));
export const DocumentQATab = debugLazy("DocumentQATab", () => import("./DocumentQATab").then(m => ({ default: m.DocumentQATab })));
export const NotebookLMTab = debugLazy("NotebookLMTab", () => import("../../pages/NotebookLMPage").then(m => ({ default: m.NotebookLMPage })));
export const ImageRegistryTab = debugLazy("ImageRegistryTab", () => import("./ImageRegistryTab").then(m => ({ default: m.ImageRegistryTab })));
export const PodcastTab = debugLazy("PodcastTab", () => import("../media/PodcastManager").then(m => ({ default: m.PodcastManager })));
export const AudiobooksTab = debugLazy("AudiobooksTab", () => import("./AudiobooksTab").then(m => ({ default: m.AudiobooksTab })));
export const ImportNeedsReviewTab = debugLazy("ImportNeedsReviewTab", () => import("../../pages/ImportNeedsReviewPage").then(m => ({ default: m.ImportNeedsReviewTab })));

/**
 * Destinations a user is likely to tap first on a fresh boot. Their lazy
 * chunks are warmed right after the backend readiness gate clears so the
 * first tap never races the WebView cold-start fetch-stall window (the
 * "first switch to a view spins forever, away-and-back fixes it" class of
 * bug; see importWithRetry.ts and lib/tauri.ts for the stall mechanics).
 *
 * Raw loaders (not the lazy components) — React.lazy would only invoke each
 * loader once anyway, and calling these thunks early populates the same ESM
 * module cache the later lazy render reads.
 */
const COMMON_TAB_LOADERS: Array<() => Promise<unknown>> = [
  () => import("./DocumentsTab"),
  () => import("../settings/SettingsPage"),
  () => import("./QueueTab"),
  () => import("./ReviewTab"),
  () => import("./DashboardTab"),
  () => import("./ContinueReadingTab"),
];

let prefetchStarted = false;

export function prefetchCommonTabs(): void {
  if (prefetchStarted) return;
  prefetchStarted = true;
  for (const load of COMMON_TAB_LOADERS) {
    // importWithRetry already retries + logs; failures here are non-fatal by
    // design (the tab's own lazy loader will surface them if ever real).
    void load().catch(() => {});
  }
}

export const TAB_TYPE_ICONS: Record<string, string> = {
  dashboard: "📊", documents: "📂", queue: "📚", review: "🧠",
  analytics: "📈", settings: "⚙️", rss: "📡", newsletter: "📰",
  podcast: "🎙️", "knowledge-sphere": "🌐", "knowledge-network": "🕸️",
  "doc-qa": "💬", notebooklm: "🤖", "image-registry": "🖼️",
  "web-browser": "🌐", "document-viewer": "📄", "document-extracts": "🔖", "extract-reader": "📑", "continue-reading": "📖",
  extracts: "✂️",
  "queue-scroll": "📜", "audiobook-epub-sync": "🎧",
  audiobook: "🎧",
  "import-needs-review": "🧭",
};

export const tabContentRegistry: Record<TabType, { content: ComponentType; title: string; icon: string; closable: boolean }> = {
  dashboard: { content: DashboardTab, title: "Dashboard", icon: "📊", closable: false },
  "continue-reading": { content: ContinueReadingTab, title: "Continue Reading", icon: "📖", closable: true },
  queue: { content: QueueTab, title: "Queue", icon: "📚", closable: true },
  "queue-scroll": { content: QueueScrollPage, title: "Scroll Mode", icon: "📜", closable: true },
  review: { content: ReviewTab, title: "Review", icon: "🧠", closable: true },
  documents: { content: DocumentsTab, title: "Documents", icon: "📂", closable: true },
  "document-viewer": { content: DocumentViewer, title: "Document", icon: "📄", closable: true },
  "document-extracts": { content: DocumentExtractsTab, title: "Extracts", icon: "🔖", closable: true },
  "extract-reader": { content: ExtractReader, title: "Extract", icon: "📑", closable: true },
  analytics: { content: AnalyticsTab, title: "Statistics", icon: "📈", closable: true },
  settings: { content: SettingsTab, title: "Settings", icon: "⚙️", closable: true },
  "knowledge-sphere": { content: KnowledgeSphereTab, title: "Knowledge Sphere", icon: "🌐", closable: true },
  "knowledge-network": { content: KnowledgeNetworkTab, title: "Knowledge Network", icon: "🕸️", closable: true },
  rss: { content: RssTab, title: "RSS", icon: "📡", closable: true },
  newsletter: { content: NewsletterDirectoryTab, title: "Newsletters", icon: "📰", closable: true },
  "web-browser": { content: WebBrowserTab, title: "Web Browser", icon: "🌐", closable: true },
  "doc-qa": { content: DocumentQATab, title: "Document Q&A", icon: "💬", closable: true },
  notebooklm: { content: NotebookLMTab, title: "NotebookLM", icon: "🤖", closable: true },
  "image-registry": { content: ImageRegistryTab, title: "Images", icon: "🖼️", closable: true },
  podcast: { content: PodcastTab, title: "Podcasts", icon: "🎙️", closable: true },
  "audiobook-epub-sync": { content: DocumentViewer, title: "Audiobook Sync", icon: "🎧", closable: true },
  audiobook: { content: AudiobooksTab, title: "Audiobooks", icon: "🎧", closable: true },
  extracts: { content: ExtractsTab, title: "Extracts", icon: "✂️", closable: true },
  "import-needs-review": { content: ImportNeedsReviewTab, title: "Import Needs Review", icon: "🧭", closable: true },
};

/**
 * Reconstruct a full Tab from serialized data (localStorage).
 */
export function rehydrateTab(serialized: { id: string; title: string; icon: string; type: TabType; closable: boolean; data?: Record<string, unknown> }) {
  const registry = tabContentRegistry[serialized.type];
  return {
    id: serialized.id,
    title: serialized.title,
    icon: registry?.icon ?? serialized.icon,
    type: serialized.type,
    content: registry?.content ?? DashboardTab,
    closable: serialized.closable,
    data: serialized.data,
  };
}
