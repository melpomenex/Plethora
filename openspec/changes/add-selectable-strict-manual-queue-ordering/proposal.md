## Why

Users who meticulously organize and prioritize their incremental reading queues expect high-priority material (such as fundamental textbooks, high-yield articles, or core decks) to appear before lower-priority items. However, Plethora currently enforces an algorithmic blend via DAQE where manual priority $P$ accounts for only 20% of memory urgency ($M = 0.8T + 0.2P$), and downshifts or variety guards in Scroll Mode (`MAX_SAME_TYPE_CONSECUTIVE = 3`) shuffle items regardless of explicit user priority. To honor user intent without discarding algorithmic optimization, Plethora requires a user-selectable Queue Ordering Mode with a first-class `Strict Manual Priority` strategy.

## What Changes

- Introduce a user-configurable `queueOrderingMode` setting with three distinct strategies:
  1. `adaptive` (default): Dynamic Adaptive Queue Engine (DAQE) combining temporal urgency, goal alignment, energy target, friction penalty, and topic variety.
  2. `strict-manual`: Pure manual priority ordering where canonical priority $P \in [0, 1]$ (or position 1..N) strictly gates relative presentation order within eligible items. Algorithmic energy downshifts, friction penalties, and variety deferrals are bypassed.
  3. `srs-priority`: Spaced Repetition bucketed priority ordering (Due items sorted by manual priority, then New items sorted by manual priority, then Future-dated items).
- Provide backend queue selector and DAQE ranker execution branches that implement deterministic strict manual ordering.
- Unify frontend Scroll Mode (`queueScrollOrder.ts`) and Review Mode sorting to respect the selected queue ordering mode.
- Add Settings UI control in Review Settings, along with Settings search coverage (`setting-queue-ordering-mode` in `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`).
- Guarantee zero data loss: changing queue ordering mode never alters item due dates, review histories, interval modifiers, or stability.

## Capabilities

### New Capabilities

- `strict-manual-queue-ordering`: Bounded, deterministic queue ordering gated strictly by user-defined canonical manual priority, bypassing algorithmic interleaving and decay adjustments when activated.

### Modified Capabilities

- `queue-priority-configuration`: Extend queue settings to store, persist, and expose `queueOrderingMode` across desktop and mobile shells.
- `settings-search-coverage`: Register `setting-queue-ordering-mode` in the settings catalog and search index with required test gates.

## Impact

- **Backend**: `src-tauri/src/algorithms/daqe/ranker.rs`, `src-tauri/src/algorithms/queue_selector.rs`, `src-tauri/src/commands/queue.rs`.
- **Frontend**: `src/stores/settingsStore.ts`, `src/stores/queueStore.ts`, `src/utils/queueScrollOrder.ts`, `src/components/settings/sections/ReviewSettings.tsx`.
- **Settings Search**: `src/components/settings/search/settingsSearchCatalog.ts`, `src/components/settings/search/settingsSearchCoverage.ts`.
- **Invariants**: 100% backward compatible. Defaults to `adaptive` mode. No database schema migration needed; persisted in existing `UserSettings` JSON store.
