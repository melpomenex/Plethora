## Why

The current RSS Discover Sites page is visually cluttered and lacks density, leaving minimal vertical space to browse actual recommended and discovered feeds. Furthermore, users cannot easily subscribe to multiple feeds at once (e.g., subscribing to all tech blogs or multiple selected feeds in bulk), requiring repetitive, single clicks that hinder onboarding.

## What Changes

- **Denser & Differentiable Layouts**: Introduce a togglable View Mode (Grid vs. Compact List) to allow bulk-scanning of many feeds on a single screen.
- **Bulk Subscription Actions**: Add multi-select checkboxes to discovered site items, a category-level "Subscribe to All" action, and a floating Bulk Actions Bar for subscribing to or dismissing multiple selected sites simultaneously.
- **Advanced Filtering**: Add a toggle to "Hide Subscribed" feeds to keep the discovery feed clean and relevant.
- **Enhanced Visual Cues**: Add unique category icons in the sidebar and layout categories for better recognition and styling.

## Capabilities

### New Capabilities
- `discover-sites-ux`: Covers togglable grid/list views, bulk selection & actions (multi-subscribe, multi-dismiss, category-level subscribe), and subscription state filters.

### Modified Capabilities

## Impact

- `src/components/media/DiscoverSitesPanel.tsx`: Re-architect header layout, add view options, filters, bulk selection state, floating action banner, and Category/Bulk action handlers.
- `src/components/media/DiscoverSiteCard.tsx`: Support checkbox rendering, checked state, and list-view styling.
