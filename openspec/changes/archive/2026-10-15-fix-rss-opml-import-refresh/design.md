## Context

In `RSSReader.tsx`, the `handleImportOPML` function allows users to import lists of feeds from `.opml` files. Currently in Tauri mode, it iterates through all parsed feeds in a serial `for` loop, calling `fetchFeed(feed.feedUrl)` over the network before inserting the feed and articles into the database via `syncFeedToTauri`.

Because this network fetching is sequential and foreground-blocking:
1. Feeds are not added to SQLite until their individual network requests complete.
2. `loadFeeds()` is only called after all feeds finish fetching, which can take several minutes for typical OPML files containing dozens of subscriptions.
3. No loading or progress state is rendered, leaving users with the impression that nothing happened.
4. If the user navigates away and returns, the component remounts and calls `loadFeeds()`, displaying whichever feeds managed to be inserted. Clicking "Refresh Feeds" similarly triggers `loadFeeds()`.
5. At the conclusion of the import, `alert()` is called, which is suppressed in the macOS WKWebView environment.

## Goals / Non-Goals

**Goals:**
- Provide immediate visibility of imported feeds in the RSS sidebar and dashboard without requiring navigation away or manual refresh.
- Separate subscription registration (fast, local) from article retrieval (network-bound, concurrent).
- Utilize bounded concurrency (`mapWithConcurrency`, concurrency 4) for article synchronization after feeds are registered.
- Provide live sync feedback (`isAutoRefreshing`, `syncFeedback`, or in-app toast) instead of native `window.alert()`.
- Ensure graceful handling of unreachable feed URLs without stalling remaining imports.

**Non-Goals:**
- Changing OPML parsing syntax or XML export formatting.
- Altering the underlying SQLite table schemas for RSS feeds or articles.

## Decisions

### Decision 1: Two-Phase Import Architecture
**Choice**: Split OPML import into two explicit phases:
- **Phase 1: Rapid Local Registration & UI Hydration**: Persist all imported feeds immediately to the database using their OPML metadata (`title`, `feedUrl`, `category`). Call `await loadFeeds()` immediately so all feeds appear in the sidebar and dashboard within milliseconds.
- **Phase 2: Concurrent Article Synchronization**: In the background, fetch the latest articles for the imported feeds using bounded concurrency (4 parallel requests), matching `refreshAllFeeds`. Set `isAutoRefreshing` and `syncFeedback("syncing")` so the user sees active progress. When complete, call `await loadFeeds()` to populate article items and unread counts.

*Alternatives considered*:
- *Fetch everything first before saving*: Current broken behavior; causes minute-long freezes and appears unresponsive.
- *Save feeds but never fetch articles on import*: Requires user to manually refresh all feeds to get content, which is poor UX.

### Decision 2: Replacing Native `window.alert` with In-App Feedback
**Choice**: Use `setSyncFeedback` (`"syncing"` -> `"success"` / `"error"`) and in-app status indication rather than `window.alert()`.

*Alternatives considered*:
- *`window.alert()`*: Silently suppressed in desktop WebView by WKUIDelegate, providing zero feedback.
- *`useModal()` dialog*: Adds modal blocking for an operation that can be communicated via existing status indicators.

### Decision 3: Concurrency Management and Deduplication
**Choice**: Check existing feeds in memory before creating subscriptions to avoid duplicate database queries, then batch or concurrently create feed entries. Use `mapWithConcurrency` with concurrency 4 for article fetching to prevent network/IPC bottlenecks while finishing in a fraction of the time.

## Risks / Trade-offs

- **[Risk] Multiple feeds imported with identical URLs in the same OPML file** → *Mitigation*: OPML parser already dedupes URLs using a `seenUrls` set; `createOrUpdateFeedViaTauri` performs normalization and check before insertion.
- **[Risk] User closes tab while background Phase 2 is fetching articles** → *Mitigation*: Feeds are already persisted in Phase 1, so no subscriptions are lost. Background fetches complete or abort cleanly, and articles will fetch on the next refresh or tab focus.
