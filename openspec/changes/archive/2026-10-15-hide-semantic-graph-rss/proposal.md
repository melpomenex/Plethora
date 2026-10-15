## Why

The RSS feed tab's left sidebar permanently displays a "Semantic Graph Analysis" card (~110px tall, always visible) between the filter controls and the feed list. This card is rarely used relative to browsing feeds, yet it consumes prime vertical space every time the tab is open — pushing the actual feed list down and reducing the room users have to read their feeds. The visualization itself is already a full-screen overlay, so the persistent inline card is redundant chrome. We want to reclaim that space for feeds while keeping the graph one tap away.

## What Changes

- Remove the always-visible "Semantic Graph Analysis" card from the RSS reader sidebar (`RSSReader.tsx:1827-1851`).
- Add a "Semantic Graph" entry to the existing RSS sidebar options menu (the gear dropdown at `RSSReader.tsx:1643-1728`) that opens the same `SemanticGraphPanel` overlay — preserving the current trigger from the dashboard stat tile (`RSSDashboard.tsx:155-170`) as a second entry point.
- When articles are batched (`rssStudy.selectedRssItems.length > 0`), surface a compact badge in the sidebar header area so the batch state and clear action remain visible without the full card.
- No changes to the `SemanticGraphPanel` overlay behavior, the `ObsidianGraph` canvas, or the Review Queue's use of the panel.

## Capabilities

### New Capabilities

- `rss-semantic-graph-entry`: How the Semantic Graph Analysis visualization is surfaced and launched from within the RSS reader view — its entry point placement, discoverability, and interaction with the article batch state.

### Modified Capabilities

<!-- None — no existing spec covers the RSS sidebar layout or the semantic graph entry point. -->

## Impact

- **Code**: `src/components/media/RSSReader.tsx` — remove the graph card block, add an options-menu entry, relocate the batch badge. `src/components/media/RSSDashboard.tsx` unchanged (still calls `onOpenSemanticGraph`).
- **UX**: Sidebar regains ~110px of vertical space for the feed list; graph moves from always-visible card to on-demand menu item.
- **i18n**: New menu item label (e.g. `rssReader.semanticGraph`) — needs a translation key; existing English-only labels in the menu (e.g. "Manage Training") set the precedent for hardcoded fallback.
- **No API/data/dependency changes.**
