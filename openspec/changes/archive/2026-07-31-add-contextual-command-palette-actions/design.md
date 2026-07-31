## Context

The command palette (`Ctrl/Cmd+K`) is the app's keyboard entry point. Today it is built imperatively inside `CommandCenter.handleSearch` (`src/components/search/CommandCenter.tsx:642`): every keystroke it rebuilds a flat list of global commands (navigation, theme, paste-extract, guided tour) plus, when RSS/Podcast tabs are active, switches its *content search* to articles/episodes instead of documents.

Key facts established by exploration:

- The palette already detects the active view via `useTabsStore` → active tab `type` (`CommandCenter.tsx:258-265`, `627-640`). It computes `isRssView` and `isPodcastView` but only to route *content search* — it never uses context to surface *actions*.
- Commands are returned as `SearchResultType.Command` with `metadata.resultKind === "command"` and a callback in `metadata.action`. There is **no registry**; the list is hand-assembled in `handleSearch`.
- Every view already has rich handlers: DocumentViewer/PDF/EPUB (`handleSearch`, `handleGoToPage`, `handleZoomIn/Out/Reset`, `toggleFullscreen`, `openExtractDialog`...), RSS (`handleKeyboardAction`, `refreshAllFeeds`, `handleMarkAllRead`, `handleToggleFavorite`...), PodcastManager (`handlePlayEpisode`, `handleTogglePlayed`, `handleDownloadEpisode`, `handleRefreshFeed`...), AudiobookViewer (`togglePlay`, `skip`, `cyclePlaybackRate`, `addBookmark`, `goToChapter`...). Many already have local keyboard shortcuts.
- Routing is event-based: a `"navigate"` CustomEvent resolves a path to a `TabType` (`MainLayout.tsx:35-57`, `622-634`).

The opportunity: surface these existing, in-context handlers through the palette so the palette becomes the keyboard hub for whatever the user is currently doing — without re-implementing any behavior.

## Goals / Non-Goals

**Goals:**

- When a supported view is the active tab, the palette surfaces a prioritized set of **actions that act on that view**, ranked above global navigation/theme commands.
- Actions are **context-driven**: only the actions valid for the active view are shown (no RSS actions inside a PDF).
- Each action **dispatches to the existing handler** in the active view — zero duplication of business logic.
- Coverage for four views: document viewer (PDF/EPUB/HTML/TXT/MD), RSS, Podcast, Audiobook.
- Additive only: existing global commands and content-search behavior are unchanged.
- Discoverable: actions appear by default when the palette opens in a supported view (empty query), and via title matching when typing.
- Type-safe and low-ceremony to extend (a future view's actions should be one registry entry + one handler hookup).

**Non-Goals:**

- Unifying the three independent audio keydown handlers (AudioPlayer/Podcast/Audiobook) — out of scope.
- Adding *new* document/RSS/podcast/audiobook features — this only exposes existing operations.
- Customizable/rebindable palette action shortcuts (the existing `useShortcutStore` / `useKeyboardShortcutsStore` systems are untouched).
- Visual redesign of the palette UI beyond minimal grouping/labeling for the contextual section.
- Mobile-specific action sets (actions render in the existing palette on all form factors, but no new touch affordances).
- A general-purpose plugin/extension command registry for third parties — this is a project-internal, per-view registry.

## Decisions

### Decision 1 — Per-view action registry (declarative action descriptors)

Introduce a small, declarative registry that maps each supported `TabType` (or a small set of type aliases) to a list of `ViewAction` descriptors. Each descriptor is plain data:

```
interface ViewAction {
  id: string;            // e.g. "doc.search"
  title: string;         // e.g. "Search in Document"
  subtitle?: string;     // hint / shortcut echo
  keywords?: string[];   // for fuzzy title/keyword matching
  icon?: ...;            // existing icon family
  // dispatch target — see Decision 2
  dispatch: ViewActionDispatch;
}
```

`CommandCenter.handleSearch` consults this registry using the already-computed active-tab `type`, maps matching `ViewAction`s into `SearchResultType.Command` results (reusing the existing result shape), and inserts them **at the top** when the query is empty, or filters them by title/keyword when typing.

**Why over alternatives:**
- *vs. a React context/provider `registerCommand` API* — the palette has no React tree to subscribe to (it lives at the layout root and the active view is a lazy-loaded sibling). A provider wired across lazy boundaries would be brittle and order-dependent. A static registry consulted during `handleSearch` matches the existing imperative style and is trivially auditable.
- *vs. continuing to hand-assemble in `handleSearch`* — that approach does not scale to per-view context and is already hard to read for global commands alone.

**Alternatives considered:** React-context-based command providers (rejected: lazy-loading + sibling topology), a global imperative `registerCommand()` store (rejected: lifecycle/teardown complexity, ordering bugs), appending to `getDefaultCommands()` (rejected: not context-aware).

### Decision 2 — Dispatch via a typed palette-action event channel

Palette actions are selected inside `GlobalSearch` and their `metadata.action` is invoked. For contextual actions we must reach into the active view's existing handler. We dispatch a **typed DOM `CustomEvent`** on `window` (e.g. `palette-action`) carrying `{ view, actionId }`, and each view component listens for events whose `view` matches its own type and routes `actionId` to its existing handler via a local lookup table. The palette never imports view code or stores handlers directly.

Concretely, each view gets a tiny `usePaletteActions()` hook (or a `useEffect` listener) that wires `actionId → existingHandler`:

- RSS: maps to its existing `handleKeyboardAction(actionName)` dispatcher (`RSSReader.tsx:1334`), which already centralizes next/prev, mark-read, star, open-original, refresh, etc. — maximal reuse.
- Audiobook: maps to `togglePlay`, `skip(±)`, `cyclePlaybackRate`, `addBookmark`, `goToChapter`, `setShowTranscript`, sleep-timer handlers.
- Podcast: maps to `handlePlayEpisode`/`handleTogglePlayed`/`handleDownloadEpisode`/`handleRefreshFeed` for the currently-selected episode.
- Document: maps to `handleSearch`/`handleGoToPage`/zoom/extract/fullscreen handlers already on `DocumentViewer`.

**Why a DOM event channel:**
- The active view is a lazily-loaded component inside `TabContent`, a sibling of the palette — there is no shared React scope to call into. DOM events are already the app's established cross-boundary mechanism (`"navigate"`, `"command-palette-open"`, `"play-podcast-episode"`).
- It keeps the registry purely declarative (data, no closures captured at registration time), avoiding stale-closure bugs that a stored-callback registry would risk across re-renders.
- It naturally scopes to the mounted view: only the active view's listener is mounted, so a stray event for an inactive view is a no-op.

**Alternatives considered:** storing live handler callbacks in the registry (rejected: stale closures, re-registration on every render, memory leaks), a Zustand store holding the "current handler map" populated by each view on mount (workable, but reinvents DOM events and adds store-coupling surface).

**Listener lifecycle:** each view registers its listener on mount and removes it on unmount. To prevent duplicates if a view is mounted in split panes, only the **active pane's** view should register (gated on `useTabsStore` active-tab check, mirroring how `CommandCenter` already picks the active tab). When no supported view is active, no listener is mounted and contextual actions simply don't appear.

### Decision 3 — Ranking and empty-query behavior

When the palette opens with an empty query in a supported view, contextual actions are listed first (capped to a reasonable number, e.g. top 8–10), followed by the existing global commands. This gives immediate, predictable keyboard access (arrow down to an action, Enter) without requiring the user to type.

When the user types, contextual actions are **fused into the same ranked result set** as global commands and content results: they match on `title`/`keywords`, and matching contextual actions are boosted (sorted above global commands) so the in-context action wins ties. This preserves content-search behavior (documents/articles/episodes still appear) while making relevant in-context actions competitive.

The existing global commands and the RSS/Podcast content-search branches are **untouched** — contextual actions are additive results merged in.

### Decision 4 — Scope of "active view" and document sub-types

Document actions apply when `activeTab.type === "document-viewer"` (the unified reader used by Queue/ContinueReading/Documents/KnowledgeSphere/Audiobook-epub-sync). Because capabilities differ per format (e.g. "Jump to Page" is meaningful for PDF/EPUB but not plain HTML/TXT/MD; "Toggle Vim Mode" only when vim runtime is available), document actions carry an optional `applies(viewerKind)` predicate. The active document's kind is already known to `DocumentViewer` (it routes to PDF/EPUB/Markdown sub-viewers), and the listener reports the current kind so the registry can filter. Non-applicable actions are hidden, not just disabled, to keep the list clean.

RSS actions require `type === "rss"`; Podcast `type === "podcast"`; Audiobook `type === "audiobook"`. (The `audiobook-epub-sync` type shares Audiobook handlers and reuses the audiobook action set.)

### Decision 5 — Reuse the existing result/command shape

Contextual actions are emitted as `SearchResultType.Command` results with `metadata.resultKind === "contextual-action"` (a new value alongside `"command"`), carrying `{ view, actionId }`. The click/Enter path in `GlobalSearch` already invokes `metadata.action`; we extend it so that for `resultKind === "contextual-action"`, instead of (or in addition to) a stored callback it dispatches the `palette-action` CustomEvent and then closes the palette. This minimizes changes to `GlobalSearch` and keeps keyboard navigation/selection semantics identical.

## Risks / Trade-offs

- **[Duplicate listeners in split panes]** Two views of the same type mounted simultaneously could both handle an event. → Mitigation: gate listener registration on "I am the active tab in the first/active pane" using the same `useTabsStore` active-tab resolution the palette already uses; only the active view listens.
- **[Event name / payload drift between registry and listeners]** A typo in `actionId` makes an action silently no-op. → Mitigation: a single shared TypeScript module exports the `actionId` union and view constants; both registry and listeners import from it. Add a dev-only warning when an event arrives with no matching handler.
- **[Stale-handler risk is avoided by design]** because the listener reads the latest handler via refs/closures on each event rather than capturing handlers at registration.
- **[Action list feels empty for a sub-view that lacks a feature]** e.g. Markdown has no "Jump to Page". → Mitigation: `applies()` predicates hide inapplicable actions (Decision 4); acceptable to show a smaller list for simpler formats.
- **[Overloading the palette]** Adding a contextual section could push global commands below the fold. → Mitigation: cap contextual actions to ~10, rank rest below globals; empty-query already shows contextual first by design intent.
- **[Podcast "current episode" ambiguity]** Podcast actions like "Mark Played" need a target episode. → Mitigation: act on the currently-selected/playing episode (fall back to the highlighted row); if none, the action is hidden. Documented as a scenario.
- **[No new tests for event wiring]** Event/listener wiring is integration-y. → Mitigation: unit-test the pure parts — the registry's context resolution, title/keyword matching, and `applies()` filtering — which is where regressions are most likely.

## Migration Plan

- Fully additive; no migration or data changes. Ships behind existing feature code paths.
- Rollout order: (1) registry + dispatch channel + Document view actions; (2) RSS; (3) Audiobook; (4) Podcast. Each is independently shippable and testable.
- Rollback: remove the contextual-action results from `CommandCenter.handleSearch` and the per-view listeners; global palette behavior is untouched.

## Open Questions

- Should contextual actions also echo their existing local shortcut (e.g. `⌘F` for Search in Document) in the result subtitle? *Proposed: yes, where a stable shortcut exists, for discoverability — purely display, no rebinding.*
- For Podcast "current episode" actions, is "selected row" or "now playing" the better default target? *Proposed: now-playing if playing, else selected/highlighted row; hide if neither.*
