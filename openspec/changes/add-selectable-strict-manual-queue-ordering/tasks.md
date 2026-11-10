# Tasks: Selectable Strict Manual Queue Ordering

## 1. Backend Core & Queue Algorithms

- [ ] 1.1 Define `QueueOrderingMode` enum (`Adaptive`, `StrictManual`, `SrsPriority`) with Serde serialization in `src-tauri/src/models/queue.rs`.
- [ ] 1.2 Implement `rank_strict_manual` pure function in `src-tauri/src/algorithms/daqe/ranker.rs` ordering items by $P$ descending with due date and stable identity tie-breaking.
- [ ] 1.3 Add `rank_with_mode` dispatcher in `src-tauri/src/algorithms/daqe/ranker.rs` supporting all three modes.
- [ ] 1.4 Update `QueueSelector::sort_queue_items_at` in `src-tauri/src/algorithms/queue_selector.rs` to support strict manual ordering without bucketing when requested.
- [ ] 1.5 Update Tauri command `get_ranked_queue` in `src-tauri/src/commands/queue.rs` to accept `mode: Option<QueueOrderingMode>` and forward to ranker.
- [ ] 1.6 Add Rust unit tests in `src-tauri/src/algorithms/daqe/ranker.rs` verifying that items with higher $P$ are never displaced by lower $P$ items in `StrictManual` mode.

## 2. Frontend Store & Queue Scroll Order

- [ ] 2.1 Add `queueOrderingMode: QueueOrderingMode` to `UserSettings` interface in `src/stores/settingsStore.ts` with default `"adaptive"`.
- [ ] 2.2 Update `src/utils/queueScrollOrder.ts` `orderScrollItemsByPriority` to accept `strictManual` flag and bypass variety guard deferrals.
- [ ] 2.3 Update `src/stores/queueStore.ts` `refreshQueue` to supply the configured `queueOrderingMode` to backend invoke calls.
- [ ] 2.4 Update `src/pages/QueueScrollPage.tsx` to pass `queueOrderingMode === "strict-manual"` to `orderScrollItemsByPriority`.
- [ ] 2.5 Add frontend unit tests in `src/utils/__tests__/queueScrollOrder.test.ts` verifying that strict manual mode preserves runs of 4+ same-type high-priority items without deferral.

## 3. Settings UI & Search Catalog Coverage

- [ ] 3.1 Add Queue Ordering Mode dropdown selector to `src/components/settings/sections/ReviewSettings.tsx` with localized label and descriptive help text.
- [ ] 3.2 Add stable DOM `id="setting-queue-ordering-mode"` to the control container in `ReviewSettings.tsx`.
- [ ] 3.3 Register `setting-queue-ordering-mode` in `src/components/settings/search/settingsSearchCatalog.ts` under `SettingsTab.Review`.
- [ ] 3.4 Add search coverage assertion in `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts` verifying catalog entry resolution and keyword matching.
- [ ] 3.5 Run `npm run bench:check` to ensure no regression on queue ranking and settings catalog lookup budgets.
