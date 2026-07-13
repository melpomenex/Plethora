## 1. UI States & Selection Support in Card Component

- [x] 1.1 Update `DiscoverSiteCard.tsx` props to accept `viewMode`, `selectable`, `checked`, and `onToggleSelect`
- [x] 1.2 Implement the checkbox markup and behavior in `DiscoverSiteCard.tsx` for Grid view
- [x] 1.3 Implement the alternative row-based layout in `DiscoverSiteCard.tsx` for List view (compact details, inline actions)

## 2. State & Filtering in Discover Panel

- [x] 2.1 Add states `viewMode`, `hideSubscribed`, and `selectedSiteIds` to `DiscoverSitesPanel.tsx`
- [x] 2.2 Re-architect layout in `DiscoverSitesPanel.tsx` to condense/hide the three large `StatCard` components, adding stats in a single compact status line
- [x] 2.3 Implement the `hideSubscribed` logic inside the `visibleSites` memo block in `DiscoverSitesPanel.tsx`
- [x] 2.4 Add View Mode toggle icons (Grid vs. List) and "Hide Subscribed" toggle checkbox to the panel filter bar
- [x] 2.5 Add custom icons for common categories in the sidebar list (e.g. Tech, Finance, News)

## 3. Bulk & Category-Level Action Mechanics

- [x] 3.1 Implement category-level "Subscribe to All" button in the active category subheader, showing how many sites will be subscribed to
- [x] 3.2 Add a master selection toggle/checkbox in the catalog section header to select/deselect all visible unsubscribed items
- [x] 3.3 Create and position the floating glassmorphic Bulk Actions Bar at the bottom-center of the viewport
- [x] 3.4 Implement bulk handlers in `DiscoverSitesPanel.tsx` to sequentially subscribe to selected feeds with progress feedback, and batch dismiss selected items
