import type { TabType } from "../stores/tabsStore";
import type { PlatformCapabilityId } from "../lib/platformCapabilities";

/**
 * Canonical navigation destinations for the whole app (revamp of the palette
 * destination surface).
 *
 * This table is the single source of truth for:
 * - the command palette's navigation commands (`commandPalette/registry`),
 * - the navigate-event path resolver used by `MainLayout`, vimium, help
 *   actions, and the guided tour (`resolveTabType` / `TAB_TYPE_ALIASES`),
 * - the help-intent section matcher adapter (`components/search/sectionRegistry`).
 *
 * A drift test (`src/navigation/__tests__/tabDestinations.test.ts`) asserts
 * every destination path resolves to its declared tab type and that label
 * keys exist, so the three consumers cannot diverge.
 */
export interface NavigationDestination {
  /** Stable id; also the section id help intent reports. */
  id: string;
  /** i18n key for the palette label. */
  labelKey: string;
  /** i18n key for the palette description. */
  descriptionKey: string;
  /** Canonical navigate-event path, including the leading slash. */
  path: string;
  /** Tab type the path resolves to. */
  tabType: TabType;
  /** Additional match aliases (never duplicated across destinations). */
  aliases: string[];
  /** Lowercase match terms beyond label and aliases. */
  keywords: string[];
  /** Platform capability governing this destination; undefined ⇒ ungated. */
  capabilityId?: PlatformCapabilityId;
}

export const NAVIGATION_DESTINATIONS: NavigationDestination[] = [
  {
    id: "dashboard",
    labelKey: "nav.dashboard",
    descriptionKey: "palette.destination.dashboardDesc",
    path: "/dashboard",
    tabType: "dashboard",
    aliases: ["home", "overview", "main"],
    keywords: ["home", "start", "landing", "overview"],
    capabilityId: "tab_dashboard",
  },
  {
    id: "continue-reading",
    labelKey: "tabs.continueReading",
    descriptionKey: "palette.destination.continueReadingDesc",
    path: "/continue-reading",
    tabType: "continue-reading",
    aliases: ["continue", "resume", "resume reading", "last read"],
    keywords: ["continue", "resume", "reading", "progress"],
    capabilityId: "core_read",
  },
  {
    id: "documents",
    labelKey: "nav.documents",
    descriptionKey: "palette.destination.documentsDesc",
    path: "/documents",
    tabType: "documents",
    aliases: ["library", "docs", "files", "books"],
    keywords: ["library", "files", "pdf", "epub", "articles"],
    capabilityId: "tab_documents",
  },
  {
    id: "queue",
    labelKey: "nav.queue",
    descriptionKey: "palette.destination.queueDesc",
    path: "/queue",
    tabType: "queue",
    aliases: ["reading queue", "todo", "list"],
    keywords: ["reading", "items", "todo"],
    capabilityId: "tab_queue",
  },
  {
    id: "scroll-mode",
    labelKey: "palette.destination.scrollMode",
    descriptionKey: "palette.destination.scrollModeDesc",
    path: "/scroll-mode",
    tabType: "queue-scroll",
    aliases: ["scroll", "scroll queue", "tiktok", "incremental reading", "optimal queue"],
    keywords: ["scroll", "session", "reading"],
    capabilityId: "core_read",
  },
  {
    id: "review",
    labelKey: "review.title",
    descriptionKey: "palette.destination.reviewDesc",
    path: "/review",
    tabType: "review",
    aliases: ["flashcards", "cards", "study", "practice", "review session", "spaced repetition"],
    keywords: ["study", "practice", "cards", "flashcards", "review"],
    capabilityId: "tab_review",
  },
  {
    id: "analytics",
    labelKey: "palette.destination.analytics",
    descriptionKey: "palette.destination.analyticsDesc",
    path: "/analytics",
    tabType: "analytics",
    aliases: ["stats", "statistics", "progress", "charts", "insights"],
    keywords: ["stats", "statistics", "progress", "charts"],
    capabilityId: "tab_analytics",
  },
  {
    id: "settings",
    labelKey: "nav.settings",
    descriptionKey: "palette.destination.settingsDesc",
    path: "/settings",
    tabType: "settings",
    aliases: ["preferences", "prefs", "config", "configuration", "options"],
    keywords: ["preferences", "config", "account"],
    capabilityId: "tab_settings",
  },
  {
    id: "rss",
    labelKey: "palette.destination.rss",
    descriptionKey: "palette.destination.rssDesc",
    path: "/rss",
    tabType: "rss",
    aliases: ["rss reader", "feeds", "news feeds", "subscriptions", "newsblur"],
    keywords: ["feeds", "articles", "subscriptions", "reader"],
    capabilityId: "tab_rss",
  },
  {
    id: "podcasts",
    labelKey: "podcastManager.podcasts",
    descriptionKey: "palette.destination.podcastsDesc",
    path: "/podcast",
    tabType: "podcast",
    aliases: ["podcast", "shows", "episodes"],
    keywords: ["audio", "episodes", "shows", "transcripts"],
    capabilityId: "tab_podcast",
  },
  {
    id: "audiobooks",
    labelKey: "toolbar.audiobooks",
    descriptionKey: "palette.destination.audiobooksDesc",
    path: "/audiobook",
    tabType: "audiobook",
    aliases: ["audiobook", "ab", "narration"],
    keywords: ["audio", "books", "narration", "chapters", "sync"],
    capabilityId: "tab_audiobook",
  },
  {
    id: "newsletters",
    labelKey: "palette.destination.newsletters",
    descriptionKey: "palette.destination.newslettersDesc",
    path: "/newsletter",
    tabType: "newsletter",
    aliases: ["newsletter", "news", "email newsletters", "directory"],
    keywords: ["email", "subscriptions", "news"],
    capabilityId: "tab_newsletter",
  },
  {
    id: "images",
    labelKey: "nav.images",
    descriptionKey: "palette.destination.imagesDesc",
    path: "/image-registry",
    tabType: "image-registry",
    aliases: ["image registry", "screenshots", "captures", "ocr images"],
    keywords: ["screenshots", "figures", "ocr"],
    capabilityId: "tab_image_registry",
  },
  {
    id: "knowledge-sphere",
    labelKey: "palette.destination.knowledgeSphere",
    descriptionKey: "palette.destination.knowledgeSphereDesc",
    path: "/knowledge-sphere",
    tabType: "knowledge-sphere",
    aliases: ["sphere", "graph", "knowledge graph", "ks", "universe"],
    keywords: ["graph", "connections", "visualization"],
    capabilityId: "tab_knowledge_sphere",
  },
  {
    id: "knowledge-network",
    labelKey: "tabs.knowledgeNetwork",
    descriptionKey: "palette.destination.knowledgeNetworkDesc",
    path: "/knowledge-network",
    tabType: "knowledge-network",
    aliases: ["network", "connections", "kn", "links"],
    keywords: ["graph", "network", "connections"],
    // Same surface family as the sphere: both are hidden together on
    // platforms without the knowledge-graph surface.
    capabilityId: "tab_knowledge_sphere",
  },
  {
    id: "doc-qa",
    labelKey: "documentQA.title",
    descriptionKey: "palette.destination.docQaDesc",
    path: "/doc-qa",
    tabType: "doc-qa",
    aliases: ["qa", "ask library", "chat with documents", "document chat", "q&a"],
    keywords: ["chat", "questions", "rag", "assistant"],
    capabilityId: "tab_doc_qa",
  },
  {
    id: "notebooklm",
    labelKey: "palette.destination.notebooklm",
    descriptionKey: "palette.destination.notebooklmDesc",
    path: "/notebooklm",
    tabType: "notebooklm",
    aliases: ["notebook", "nb", "research notebook"],
    keywords: ["notebook", "research", "google"],
    capabilityId: "tab_notebooklm",
  },
  {
    id: "extracts",
    labelKey: "extractsTab.title",
    descriptionKey: "palette.destination.extractsDesc",
    path: "/extracts",
    tabType: "extracts",
    aliases: ["highlights", "quotes", "clippings"],
    keywords: ["extracts", "highlights", "quotes"],
    capabilityId: "tab_extracts",
  },
  {
    id: "import-needs-review",
    labelKey: "palette.destination.importNeedsReview",
    descriptionKey: "palette.destination.importNeedsReviewDesc",
    path: "/needs-review",
    tabType: "import-needs-review",
    aliases: ["needs review", "browser imports", "uncertain imports", "review imports"],
    keywords: ["imports", "browser", "tags", "organization"],
  },
  {
    id: "web-browser",
    labelKey: "palette.destination.webBrowser",
    descriptionKey: "palette.destination.webBrowserDesc",
    path: "/web-browser",
    tabType: "web-browser",
    aliases: ["browser", "web", "url"],
    keywords: ["web", "url", "browse"],
  },
];

/**
 * Navigate-event path → tab type aliases. Moved here from `MainLayout` so the
 * palette registry and the navigate handler share exactly one map.
 */
export const TAB_TYPE_ALIASES: Record<string, TabType> = {
  dash: "dashboard", dashboard: "dashboard", home: "dashboard",
  docs: "documents", documents: "documents", doc: "documents",
  queue: "queue", q: "queue",
  "queue-scroll": "queue-scroll", qs: "queue-scroll", scroll: "queue-scroll", "scroll-mode": "queue-scroll", "optimal-queue": "queue-scroll",
  rev: "review", review: "review",
  anal: "analytics", analytics: "analytics", stats: "analytics",
  set: "settings", settings: "settings",
  rss: "rss", feeds: "rss",
  news: "newsletter", newsletter: "newsletter",
  pod: "podcast", podcast: "podcast", podcasts: "podcast",
  audiobook: "audiobook", audiobooks: "audiobook", ab: "audiobook",
  ks: "knowledge-sphere", sphere: "knowledge-sphere", "knowledge-sphere": "knowledge-sphere",
  kn: "knowledge-network", network: "knowledge-network", "knowledge-network": "knowledge-network",
  qa: "doc-qa", "doc-qa": "doc-qa",
  nb: "notebooklm", notebook: "notebooklm", notebooklm: "notebooklm",
  img: "image-registry", images: "image-registry", "image-registry": "image-registry",
  web: "web-browser", browser: "web-browser", "web-browser": "web-browser",
  "needs-review": "import-needs-review", "import-needs-review": "import-needs-review",
  "continue-reading": "continue-reading",
  extracts: "extracts",
};

/** Resolve a navigate-event path (without or with a leading slash) to a tab type. */
export function resolveTabType(input: string): TabType | null {
  const clean = input.replace(/^\//, "").toLowerCase();
  return TAB_TYPE_ALIASES[clean] ?? null;
}
