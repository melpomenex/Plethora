# Implementation Tasks

## 1. Shared success path
- [x] 1.1 Decide and implement: either (a) route context-menu/`quick-extract` creation through the content script (send selection to the active/`tab` content script → `createExtract`/`createSmartExtract`), or (b) after a successful `sendToIncrementum` in `createExtractFromSelection`, notify the content script to register the created record into `pageExtracts` with the same shape (id, url, title, text, range/selector/analysis fields where applicable)
- [x] 1.2 Ensure the popup `loadStats()` refresh is triggered when the popup is open (or reads the updated state on open)

## 2. Exactly-once + failure semantics
- [x] 2.1 Ensure the content-script registration happens only on server success (no optimistic increment for the context-menu path that could be rolled back)
- [x] 2.2 Guard against double registration (e.g. a dedupe by extract id in `pageExtracts`)
- [x] 2.3 Keep error feedback (existing toast/retry) and no counter change on failure

## 3. Lifecycle/multi-tab robustness
- [x] 3.1 Handle background service-worker restarts between server create and registration (idempotent registration, persisted response data)
- [x] 3.2 Keep updates per-tab (only the tab whose extract was created updates)

## 4. Tests
- [x] 4.1 Normal extraction → counter increments (regression)
- [x] 4.2 Context-menu extraction → counter increments exactly once
- [x] 4.3 Failed/rejected extraction → counter unchanged
- [x] 4.4 Multiple extracts → counter reflects count
- [x] 4.5 Extension UI reopened after extraction → counter correct
- [x] 4.6 Service-worker restart → no double/lost increment
- [x] 4.7 Run `npm run test:browser-extension` and add tests under `browser_extension/tests/*.test.cjs`

## 5. Spec
- [x] 5.1 Confirm spec matches implementation