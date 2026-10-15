## Why

When importing an `.opml` file in the RSS Feed View, feeds are successfully parsed and saved, but they do not appear in the feed sidebar or dashboard until the user either navigates away to another view and returns, or triggers a manual feed refresh.

This occurs because OPML import attempts to sequentially fetch every feed over the network before updating local component state or completing the import. In large or slow imports, this blocks state updates, provides no visual progress feedback, and relies on native `alert()` dialogs that are silently suppressed in the desktop WKWebView. Feeds must register and display immediately upon import, with article synchronization handled concurrently in the background.

## What Changes

- **Immediate Feed Registration & UI Update**: Register all imported OPML feeds into the database/storage upfront and call `loadFeeds()` immediately so new feeds appear in the sidebar and dashboard without waiting for remote network fetches.
- **Concurrent Non-Blocking Article Synchronization**: Fetch and sync initial articles for imported feeds in the background using bounded concurrency (rather than slow, blocking serial iteration) and refresh feed item counts as they arrive.
- **In-App Progress & Completion Feedback**: Display active syncing status (via the existing sync indicators or toast notifications) instead of native `window.alert()`, ensuring feedback works reliably across desktop and mobile WebViews.
- **Robust Error Handling**: Ensure malformed feeds or network timeouts on individual feed URLs do not stall the rest of the import or prevent already imported feeds from displaying.

## Capabilities

### Modified Capabilities
- `rss-import-navigation`: Update OPML import requirements so that imported feeds are immediately registered, hydrated into UI state, and visible in the RSS sidebar and dashboard without requiring tab/view navigation or manual refresh triggers.

## Impact

- `src/components/media/RSSReader.tsx`: Refactor `handleImportOPML` to immediately persist imported feeds, update state, trigger concurrent background article fetching, and provide in-app feedback.
- `src/api/rss.ts`: Ensure batch/auto subscribe utilities support immediate registration and concurrent feed fetching.
- `src/__tests__/`: Verify OPML import state transitions and ensure compliance with WebView dialog constraints.
