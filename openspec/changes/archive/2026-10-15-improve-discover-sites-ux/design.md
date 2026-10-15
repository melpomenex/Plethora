## Context

The current RSS Discover Sites view is implemented as a full-screen overlay component (`DiscoverSitesPanel.tsx`) that renders cards (`DiscoverSiteCard.tsx`). The layout suffers from high vertical usage due to large stat cards and large grid cards. Additionally, subscribing is purely one-by-one, which is tedious when users want to subscribe to entire curated groups (like "Tech" or "Productivity").

## Goals / Non-Goals

**Goals:**
- Provide a toggle to switch between standard Grid view and a high-density List view.
- Enable bulk selection (multi-select checkboxes) and a floating Bulk Actions Bar for batch operations.
- Provide a "Subscribe to All" option at the category level.
- Provide a filter to hide already subscribed feeds.
- Maintain premium aesthetics using Tailwind 4, custom transitions, glassmorphism, and Phosphor icons.

**Non-Goals:**
- Changing the backend APIs or storage schemas for discovered sites or subscriptions. All backend commands (`get_discovered_sites`, `subscribe_to_feed`) will be reused.

## Decisions

### 1. View Mode State & Toggle
We will introduce a `'grid' | 'list'` view mode toggle in the Discover panel header.
- **Grid View**: Best for browsing rich content summaries.
- **List View**: A highly compact table-like row layout that maximizes information density, showing 3-4x more sites on screen.
- *Alternatives considered*: Automatic list view on small screens. Dropped in favor of explicit toggle because power users on desktop also prefer list views for bulk management.

### 2. Multi-Select & Floating Actions Bar
To support bulk subscriptions:
- Checkboxes will be integrated into both Grid cards and List rows.
- A master checkbox at the header level will allow selecting all visible, unsubscribed items.
- A fixed, floating panel at the bottom center of the screen will appear when `selectedSiteIds.size > 0`. It will offer "Subscribe to Selected" and "Dismiss Selected" actions.
- Subscribing in bulk will process feeds sequentially in the background using a throttled loop, updating the local UI state dynamically as each feed succeeds.

### 3. Header Re-Architecture
To reclaim vertical space, the large header section with three standalone `StatCard` blocks will be condensed.
- Stats will be rendered as inline text/badges or inside a smaller horizontal stats bar.
- Filters (Hide Subscribed, Feed Only) and View Mode toggles will be grouped compactly adjacent to the search input.

## Risks / Trade-offs

- **API Throttling/IPC Overhead** → Subscribing to many feeds at once might cause SQLite lockups or rate-limiting.
  *Mitigation*: We will process bulk subscriptions sequentially with a small delay (e.g. 100ms) between calls rather than concurrently, displaying a progress indicator (e.g., "Subscribed to 3 of 10...") on the bulk actions button.
