## 1. Core Feed Registration & Immediate Refresh

- [x] 1.1 Refactor OPML import in `RSSReader.tsx` to persist all parsed feeds immediately to storage/database in Phase 1 before network fetching
- [x] 1.2 Call `loadFeeds()` immediately after Phase 1 registration so imported feeds appear in the sidebar and dashboard without delay

## 2. Background Concurrent Article Synchronization

- [x] 2.1 Implement Phase 2 background article fetching using bounded concurrency (`mapWithConcurrency` with concurrency 4)
- [x] 2.2 Connect synchronization indicators (`isAutoRefreshing`, `syncFeedback`) to provide visible feedback during article sync
- [x] 2.3 Refresh feeds and unread counts via `loadFeeds()` once Phase 2 article synchronization finishes

## 3. UI Feedback & WebView Compatibility

- [x] 3.1 Replace native `window.alert()` dialogs in `handleImportOPML` with in-app sync feedback or notifications compatible with WKWebView
- [x] 3.2 Ensure individual feed network errors or timeouts during Phase 2 do not disrupt other feeds or remove already registered feeds

## 4. Verification & Testing

- [x] 4.1 Add or update unit tests covering the immediate OPML import hydration flow and error tolerance
- [x] 4.2 Run test suites including `noNativeDialogs.test.ts` and verify build integrity
