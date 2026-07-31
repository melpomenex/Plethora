/**
 * Contextual command-palette actions.
 *
 * The command palette (Ctrl/Cmd+K) detects the active view via the tabs store
 * and, for supported views, surfaces a prioritized set of *actions* that operate
 * on that view. Actions are pure descriptors here: the palette lists them, and
 * the active view listens for a dispatched event (see `paletteActionEvents.ts`)
 * and routes the action id to its existing handler. No view behavior is
 * duplicated in the palette.
 *
 * To add a new action:
 *   1. Add its id to the relevant `ViewActionId` literal union below.
 *   2. Add a `ViewAction` descriptor to the per-view array.
 *   3. Add the matching `actionId -> handler` route in the view's listener.
 */

/** Supported view types (a subset of `TabType`). */
export type ContextualViewType =
  | "document-viewer"
  | "rss"
  | "podcast"
  | "audiobook";

/**
 * Coarse kind of document a document-viewer tab is showing. Used by the
 * `applies()` predicate to hide actions that don't make sense for a format
 * (e.g. "Jump to Page" for plain Markdown).
 */
export type ViewerKind = "pdf" | "epub" | "markdown" | "html" | "youtube" | "audio" | "other";

/** Live context the resolver can filter actions against. */
export interface ActionContext {
  /** Active document format, when the view is a document viewer. */
  viewerKind?: ViewerKind;
  /** Whether a vim reading runtime is available for the active document. */
  vimAvailable?: boolean;
  /** Whether there is a resolvable target episode (podcast) or article (rss). */
  hasTargetItem?: boolean;
}

/** Per-view action id unions (statically typed so typos fail at compile time). */
export type DocumentActionId =
  | "doc.search"
  | "doc.toggleToc"
  | "doc.nextPage"
  | "doc.prevPage"
  | "doc.goToPage"
  | "doc.zoomIn"
  | "doc.zoomOut"
  | "doc.zoomReset"
  | "doc.createExtract"
  | "doc.highlightSelection"
  | "doc.toggleFullscreen"
  | "doc.toggleVimMode";

export type RssActionId =
  | "rss.search"
  | "rss.nextArticle"
  | "rss.prevArticle"
  | "rss.markRead"
  | "rss.markUnread"
  | "rss.toggleStar"
  | "rss.openOriginal"
  | "rss.refreshFeed"
  | "rss.markAllRead"
  | "rss.cycleViewMode";

export type PodcastActionId =
  | "podcast.search"
  | "podcast.playPause"
  | "podcast.skipBack"
  | "podcast.skipForward"
  | "podcast.markPlayed"
  | "podcast.markUnplayed"
  | "podcast.download"
  | "podcast.refreshFeed"
  | "podcast.toggleTranscript";

export type AudiobookActionId =
  | "audiobook.playPause"
  | "audiobook.skipBack"
  | "audiobook.skipForward"
  | "audiobook.cycleSpeed"
  | "audiobook.toggleMute"
  | "audiobook.toggleChapters"
  | "audiobook.addBookmark"
  | "audiobook.toggleTranscript"
  | "audiobook.toggleSleepTimer"
  | "audiobook.toggleFullscreen";

/** All action ids, discriminated by view. */
export type ViewActionId =
  | DocumentActionId
  | RssActionId
  | PodcastActionId
  | AudiobookActionId;

/** A single contextual action descriptor (pure data). */
export interface ViewAction {
  id: ViewActionId;
  /** Human-readable label shown in the palette. */
  title: string;
  /** Optional hint / shortcut echo shown beneath the title. */
  subtitle?: string;
  /** Lowercase terms that should match a typed query, beyond the title. */
  keywords?: string[];
  /** Optional icon name (rendered by the palette if it knows it). */
  iconName?: string;
  /** The view this action belongs to. */
  view: ContextualViewType;
  /**
   * Optional predicate. When it returns false (or when required context is
   * missing), the action is hidden rather than shown disabled.
   */
  applies?: (ctx: ActionContext) => boolean;
  /**
   * Optional shortcut hint echoed in the result subtitle for discoverability
   * (display only — never rebinds the existing shortcut).
   */
  shortcutHint?: string;
}

// ---------------------------------------------------------------------------
// Document-viewer actions
// ---------------------------------------------------------------------------

const paginated = (ctx: ActionContext): boolean =>
  ctx.viewerKind === "pdf" || ctx.viewerKind === "epub";

export const documentActions: ViewAction[] = [
  {
    id: "doc.search",
    title: "Search in Document",
    view: "document-viewer",
    iconName: "MagnifyingGlass",
    keywords: ["find", "search", "lookup"],
    shortcutHint: "⌘F",
  },
  {
    id: "doc.toggleToc",
    title: "Toggle Table of Contents",
    view: "document-viewer",
    iconName: "List",
    keywords: ["toc", "outline", "chapters", "contents"],
    // Only PDF has a toggleable TOC panel; EPUB's TOC is navigated, not toggled.
    applies: (ctx) => ctx.viewerKind === "pdf",
  },
  {
    id: "doc.nextPage",
    title: "Next Page",
    view: "document-viewer",
    iconName: "ArrowRight",
    keywords: ["page", "forward", "next"],
    applies: paginated,
  },
  {
    id: "doc.prevPage",
    title: "Previous Page",
    view: "document-viewer",
    iconName: "ArrowLeft",
    keywords: ["page", "back", "previous"],
    applies: paginated,
  },
  {
    id: "doc.goToPage",
    title: "Jump to Page",
    view: "document-viewer",
    iconName: "Stack",
    keywords: ["page", "go", "jump", "goto"],
    applies: paginated,
  },
  {
    id: "doc.zoomIn",
    title: "Zoom In",
    view: "document-viewer",
    iconName: "MagnifyingGlassPlus",
    keywords: ["zoom", "scale", "larger", "bigger"],
    shortcutHint: "⌘+",
  },
  {
    id: "doc.zoomOut",
    title: "Zoom Out",
    view: "document-viewer",
    iconName: "MagnifyingGlassMinus",
    keywords: ["zoom", "scale", "smaller"],
    shortcutHint: "⌘-",
  },
  {
    id: "doc.zoomReset",
    title: "Reset Zoom",
    view: "document-viewer",
    iconName: "ArrowsInSimple",
    keywords: ["zoom", "reset", "100", "fit"],
    shortcutHint: "⌘0",
  },
  {
    id: "doc.createExtract",
    title: "Create Extract",
    view: "document-viewer",
    iconName: "Quotes",
    keywords: ["extract", "highlight", "quote", "annotation"],
    shortcutHint: "⌘E",
  },
  {
    id: "doc.highlightSelection",
    title: "Highlight Selection",
    view: "document-viewer",
    iconName: "Highlighter",
    keywords: ["highlight", "selection", "annotate"],
    shortcutHint: "⌘H",
  },
  {
    id: "doc.toggleFullscreen",
    title: "Toggle Fullscreen",
    view: "document-viewer",
    iconName: "ArrowsOutSimple",
    keywords: ["fullscreen", "fullscreen", "maximize", "f11"],
    shortcutHint: "F11",
  },
  {
    id: "doc.toggleVimMode",
    title: "Toggle Vim Reading Mode",
    view: "document-viewer",
    iconName: "CommandLine",
    keywords: ["vim", "keyboard", "reading", "mode"],
    applies: (ctx) => ctx.vimAvailable !== false,
  },
];

// ---------------------------------------------------------------------------
// RSS actions
// ---------------------------------------------------------------------------

export const rssActions: ViewAction[] = [
  {
    id: "rss.search",
    title: "Search Articles",
    view: "rss",
    iconName: "MagnifyingGlass",
    keywords: ["find", "filter", "search"],
    shortcutHint: "/",
  },
  {
    id: "rss.nextArticle",
    title: "Next Article",
    view: "rss",
    iconName: "ArrowDown",
    keywords: ["next", "down", "article"],
    shortcutHint: "j",
  },
  {
    id: "rss.prevArticle",
    title: "Previous Article",
    view: "rss",
    iconName: "ArrowUp",
    keywords: ["previous", "prev", "up", "article"],
    shortcutHint: "k",
  },
  {
    id: "rss.markRead",
    title: "Mark Current Read",
    view: "rss",
    iconName: "Check",
    keywords: ["read", "mark", "seen"],
    shortcutHint: "m",
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "rss.markUnread",
    title: "Mark Current Unread",
    view: "rss",
    iconName: "Circle",
    keywords: ["unread", "mark", "unseen"],
    shortcutHint: "u",
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "rss.toggleStar",
    title: "Toggle Star",
    view: "rss",
    iconName: "Star",
    keywords: ["star", "favorite", "favourite"],
    shortcutHint: "s",
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "rss.openOriginal",
    title: "Open Original",
    view: "rss",
    iconName: "ArrowSquareOut",
    keywords: ["open", "original", "browser", "external", "link"],
    shortcutHint: "o",
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "rss.refreshFeed",
    title: "Refresh Feed",
    view: "rss",
    iconName: "ArrowClockwise",
    keywords: ["refresh", "reload", "update", "sync"],
    shortcutHint: "r",
  },
  {
    id: "rss.markAllRead",
    title: "Mark All Read",
    view: "rss",
    iconName: "Checks",
    keywords: ["mark", "all", "read", "seen"],
    shortcutHint: "Shift+A",
  },
  {
    id: "rss.cycleViewMode",
    title: "Cycle View Mode",
    view: "rss",
    iconName: "Eye",
    keywords: ["view", "mode", "cycle", "text", "feed", "story"],
    shortcutHint: "v",
  },
];

// ---------------------------------------------------------------------------
// Podcast actions. Playback actions (play/pause/skip) target the now-playing
// episode; episode-specific actions require a resolvable target episode.
// ---------------------------------------------------------------------------

export const podcastActions: ViewAction[] = [
  {
    id: "podcast.search",
    title: "Search Episodes",
    view: "podcast",
    iconName: "MagnifyingGlass",
    keywords: ["find", "filter", "search"],
  },
  {
    id: "podcast.playPause",
    title: "Play / Pause",
    view: "podcast",
    iconName: "Play",
    keywords: ["play", "pause", "resume", "toggle"],
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "podcast.skipBack",
    title: "Skip Back 10s",
    view: "podcast",
    iconName: "Rewind",
    keywords: ["skip", "back", "rewind", "reverse"],
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "podcast.skipForward",
    title: "Skip Forward 10s",
    view: "podcast",
    iconName: "FastForward",
    keywords: ["skip", "forward", "ahead"],
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "podcast.markPlayed",
    title: "Mark Current Played",
    view: "podcast",
    iconName: "Check",
    keywords: ["mark", "played", "done", "seen"],
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "podcast.markUnplayed",
    title: "Mark Current Unplayed",
    view: "podcast",
    iconName: "Circle",
    keywords: ["mark", "unplayed", "new"],
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "podcast.download",
    title: "Download / Delete Download",
    view: "podcast",
    iconName: "DownloadSimple",
    keywords: ["download", "delete", "save", "offline"],
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
  {
    id: "podcast.refreshFeed",
    title: "Refresh Feed",
    view: "podcast",
    iconName: "ArrowClockwise",
    keywords: ["refresh", "reload", "update", "sync"],
  },
  {
    id: "podcast.toggleTranscript",
    title: "Toggle Transcript",
    view: "podcast",
    iconName: "TextAlignLeft",
    keywords: ["transcript", "toggle", "show"],
    applies: (ctx) => ctx.hasTargetItem !== false,
  },
];

// ---------------------------------------------------------------------------
// Audiobook actions. (When AudiobookViewer is reused by the Podcast tab as its
// inline player, it reports view "podcast" instead — see paletteActionEvents.)
// ---------------------------------------------------------------------------

export const audiobookActions: ViewAction[] = [
  {
    id: "audiobook.playPause",
    title: "Play / Pause",
    view: "audiobook",
    iconName: "Play",
    keywords: ["play", "pause", "resume", "toggle"],
    shortcutHint: "Space",
  },
  {
    id: "audiobook.skipBack",
    title: "Skip Back 10s",
    view: "audiobook",
    iconName: "Rewind",
    keywords: ["skip", "back", "rewind", "reverse"],
    shortcutHint: "←",
  },
  {
    id: "audiobook.skipForward",
    title: "Skip Forward 10s",
    view: "audiobook",
    iconName: "FastForward",
    keywords: ["skip", "forward", "ahead"],
    shortcutHint: "→",
  },
  {
    id: "audiobook.cycleSpeed",
    title: "Cycle Playback Speed",
    view: "audiobook",
    iconName: "Gauge",
    keywords: ["speed", "rate", "fast", "slow"],
    shortcutHint: "s",
  },
  {
    id: "audiobook.toggleMute",
    title: "Toggle Mute",
    view: "audiobook",
    iconName: "SpeakerSlash",
    keywords: ["mute", "unmute", "volume", "sound"],
    shortcutHint: "m",
  },
  {
    id: "audiobook.toggleChapters",
    title: "Toggle Chapters",
    view: "audiobook",
    iconName: "List",
    keywords: ["chapters", "toc", "table", "contents"],
    shortcutHint: "c",
  },
  {
    id: "audiobook.addBookmark",
    title: "Add Bookmark",
    view: "audiobook",
    iconName: "BookmarkSimple",
    keywords: ["bookmark", "add", "save", "mark"],
    shortcutHint: "b",
  },
  {
    id: "audiobook.toggleTranscript",
    title: "Toggle Transcript",
    view: "audiobook",
    iconName: "TextAlignLeft",
    keywords: ["transcript", "toggle", "show"],
    shortcutHint: "t",
  },
  {
    id: "audiobook.toggleSleepTimer",
    title: "Toggle Sleep Timer",
    view: "audiobook",
    iconName: "Moon",
    keywords: ["sleep", "timer", "stop", "pause"],
  },
  {
    id: "audiobook.toggleFullscreen",
    title: "Toggle Fullscreen",
    view: "audiobook",
    iconName: "ArrowsOutSimple",
    keywords: ["fullscreen", "maximize"],
    shortcutHint: "f",
  },
];

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

const ACTIONS_BY_VIEW: Record<ContextualViewType, ViewAction[]> = {
  "document-viewer": documentActions,
  rss: rssActions,
  podcast: podcastActions,
  audiobook: audiobookActions,
};

/**
 * Returns the contextual actions applicable to `view`, filtered by each
 * action's `applies()` predicate against `ctx`. Actions without a predicate
 * are always applicable. The returned order matches the declaration order
 * (intentional — it is the priority order shown in the palette).
 */
export function getActionsForView(
  view: ContextualViewType,
  ctx: ActionContext = {},
): ViewAction[] {
  const all = ACTIONS_BY_VIEW[view];
  if (!all) return [];
  return all.filter((action) => (action.applies ? action.applies(ctx) : true));
}

/** All contextual actions (flat), for tests/inspection. */
export function getAllContextualActions(): ViewAction[] {
  return [
    ...documentActions,
    ...rssActions,
    ...podcastActions,
    ...audiobookActions,
  ];
}

/**
 * Whether a typed query matches an action (case-insensitive). A query matches
 * when it is a substring of the title or any keyword. An empty query matches
 * everything (used to show all applicable actions when the palette first opens).
 */
export function actionMatchesQuery(action: ViewAction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (action.title.toLowerCase().includes(q)) return true;
  if (action.keywords?.some((k) => k.toLowerCase().includes(q))) return true;
  return false;
}
