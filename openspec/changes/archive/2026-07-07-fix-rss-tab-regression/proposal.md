## Why

There is a regression in the RSS Tab within the app. Users cannot import `.opml` files and have all the feeds successfully added. Furthermore, clicking on top-level feeds/folders in the sidebar does not display their child feed articles, and batch operations run concurrently without throttling, leading to network and DB performance issues.

## What Changes

- **OPML Import Fix**:
  - Connect the dashboard's "Import OPML" button directly to the file input picker trigger instead of reopening the simple URL dialog.
  - Correctly map backend HTTP import count returns to show the exact number of imported feeds in the user success alert.
  - Throttle Tauri OPML import feed fetching by changing the concurrent `Promise.all` into sequential or batched imports, preventing timeouts/failures.
- **Top-Level Folder Navigation**:
  - Make folders and categories in the sidebar clickable. Selecting a folder or category will display articles from all feeds grouped under it, highlighting the active folder.
  - Clicking the global "All" button will reset any selected feed or folder, displaying all subscribed feeds.

## Capabilities

### New Capabilities
- `rss-import-navigation`: Define behaviors for OPML file imports and folder-based RSS article filtering.

### Modified Capabilities
<!-- None -->

## Impact

- **Affected Components**:
  - `src/components/media/RSSReader.tsx` (sidebar interaction, folder navigation, import logic)
  - `src/components/media/RSSDashboard.tsx` (OPML import trigger callback)
  - `src/api/rss.ts` (`importOpmlAuto` integration)
