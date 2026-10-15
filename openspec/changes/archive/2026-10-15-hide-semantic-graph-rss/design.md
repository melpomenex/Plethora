## Context

The RSS reader (`src/components/media/RSSReader.tsx`) uses a three-pane layout: a fixed `lg:w-72` left sidebar, an items list, and a reader pane. The sidebar currently contains a persistent "Semantic Graph Analysis" card (`RSSReader.tsx:1827-1851`) — an always-visible orange gradient block ~110px tall sitting between the intelligence filter controls (ending line 1824) and the scrollable feed list (line 1854).

The card's only function is to open the `SemanticGraphPanel`, which is itself a full-screen `fixed inset-0 z-50` overlay (`SemanticGraphPanel.tsx:346`). So the card is pure launch chrome: it holds a title, an optional batch-count badge (`rssStudy.selectedRssItems.length`), a "clear batch" button, and an "Open Graph Visualization" button. It is the primary, but not the only, entry point — the RSS dashboard stat tile (`RSSDashboard.tsx:155-170`) also opens the same panel via the `onOpenSemanticGraph` prop.

The sidebar already has an established pattern for on-demand actions: the **options menu** (gear dropdown, `RSSReader.tsx:1643-1728`), which contains "Import OPML", "Export OPML", "Manage Training", "Discover Sites", "Keyboard Shortcuts", and "Customize". Each item opens a modal/overlay and closes the menu. This is the natural home for a "Semantic Graph" entry.

## Goals / Non-Goals

**Goals:**
- Reclaim the ~110px of always-visible vertical space the graph card occupies, giving the feed list maximum room.
- Keep the Semantic Graph exactly one interaction away (openable from the RSS tab).
- Preserve the article-batch state visibility (count + clear) so users don't lose track of batched articles when the card is gone.
- Match the existing options-menu interaction convention exactly (no new UI patterns).

**Non-Goals:**
- Changing the `SemanticGraphPanel` overlay behavior, the `ObsidianGraph` canvas, or its internals.
- Touching the Review Queue's use of `SemanticGraphPanel` (`ReviewQueueView.tsx:1943`).
- Removing or altering the dashboard stat-tile entry point.
- Adding a settings preference or persistence for sidebar layout.
- Inline-embedding the graph in the sidebar (the full-screen overlay stays).

## Decisions

### Decision 1: Move the launch into the existing options menu (gear dropdown)

**Choice:** Add a "Semantic Graph" item to the options menu at `RSSReader.tsx:1643-1728`, alongside "Manage Training" / "Discover Sites", calling `setSemanticGraphOpen(true)` and `setShowOptionsMenu(false)`.

**Rationale:** This is the established convention for "open an overlay from the RSS sidebar." It requires no new component, no new state, and no new layout system. The gear icon is already a recognized affordance for secondary actions in this view.

**Alternatives considered:**
- *A collapse/accordion (chevron) on the card itself* — keeps it inline but even collapsed it still consumes a header row and adds a new UI pattern not present in this sidebar. Rejected: the user explicitly asked to hide it in "a menu or something," not to add a collapsible.
- *A new icon button next to the gear in the sidebar header* — viable and one-click, but proliferates header buttons and the gear menu is the designated home for this class of action. The menu item is more discoverable-by-label.
- *Removing it entirely (relying only on the dashboard tile)* — too hidden; users in the RSS tab shouldn't have to navigate to the dashboard to reach the graph.

### Decision 2: Relocate the batch badge to the sidebar header

**Choice:** When `rssStudy.selectedRssItems.length > 0`, render a compact badge (count + `×` clear button) inline in the sidebar header row near the options gear, rather than inside the removed card.

**Rationale:** The batch count and clear action are the only functional content the card carried beyond the launch button. They must survive the card's removal. A tiny badge in the header is the lowest-space way to keep that state visible without re-introducing a card. It also visually associates the batch with the graph entry point.

**Alternatives considered:**
- *Put the batch count on the menu item itself (e.g. "Semantic Graph (3)")* — clever, but the count is invisible until the menu opens, and the clear (`×`) action wouldn't have a home. Header badge is always-visible.
- *Drop the batch badge entirely* — loses the ability to clear a batch from the sidebar; rejected.

### Decision 3: Keep the dashboard tile as a second entry point (unchanged)

**Choice:** Do not modify `RSSDashboard.tsx:155-170`. It continues to call `onOpenSemanticGraph`.

**Rationale:** Multiple entry points to the same overlay is already the status quo and is desirable. Removing the card doesn't require touching the tile.

## Risks / Trade-offs

- **[Discoverability]** Moving the graph from always-visible to a menu item makes it less prominent. → Mitigation: the gear menu is the conventional home for such actions, the label "Semantic Graph" is explicit, and the dashboard tile remains a prominent second entry. Acceptable per the user's explicit request to prioritize feed space.
- **[Batch-badge placement]** Adding a badge to the header row could crowd it on narrow widths. → Mitigation: render the badge only when `selectedRssItems.length > 0` (already the condition), and keep it minimal (count + `×`), no card chrome.
- **[i18n]** The new menu item needs a label. Existing menu items mix translated keys (`rssReader.importOpml`) and hardcoded English ("Manage Training", "Discover Sites"). → Mitigation: add a `rssReader.semanticGraph` key with an English fallback to match the translated-item convention; if the localization pipeline isn't touched for the hardcoded items, a hardcoded "Semantic Graph" label is consistent with neighbors.
