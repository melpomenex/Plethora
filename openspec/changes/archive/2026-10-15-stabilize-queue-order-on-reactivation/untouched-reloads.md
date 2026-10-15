# Reload triggers deliberately left alone

Per the bug report's final requirement, these queue-affecting reload
triggers were found during implementation and **deliberately not changed**.
None of them are sources of the reactivation reorder.

- **`reviewStore.startReviewAtItem` (`src/stores/reviewStore.ts:817`)** — calls
  `reviewStore`'s OWN `loadQueue` (`reviewStore.ts:254`), a completely separate
  loader that populates the flashcard review session's `queue` via `getDueItems`.
  It does NOT touch `queueStore.items` (the reading Queue) and therefore cannot
  reorder it. Not reproduced; not fixed. (The reading-queue reorder is the bug.)

- **`startupStore.fallbackToLegacyLoads` (`src/stores/startupStore.ts:36,38`)** —
  the bounded startup-snapshot fast-path. Explicitly preserved by requirement #5
  ("do not break the bounded startup snapshot fast-path for first paint"). This
  runs once per failed coordinated startup request; it is gated against
  truncation by `hydrateStartupQueue`'s guard (`queueStore.ts:420-427`).

- **`PodcastManager` (`src/components/media/PodcastManager.tsx:285`)** — refreshes
  the reading queue when a freshly downloaded podcast episode is auto-imported as
  a new Document. This is a genuine "new data entered the queue" trigger, not a
  reactivation reorder, so a refresh is correct. It calls `loadQueue()`, which is
  already mode-aware internally (`queueStore.ts:261`), so it re-issues the active
  query. Left as-is; could optionally be switched to `reloadForCurrentMode()` for
  naming consistency but is not a bug.

- **`offline-queue.ts:59`** — `this.loadQueue()` is a private method of the
  unrelated `OfflineQueueManager` class (loads a localStorage-backed HTTP request
  queue). Not the queueStore at all.

- **`queueStore.loadStats`** — refreshes `QueueStats` only (due counts, badges);
  does not touch `items` / `filteredItems` and cannot reorder rows. Untouched.

- **Toolbar refresh button / pull-to-refresh / `ensureStartup`** — these are the
  user's explicit "I want fresh data" affordances. They are the legitimate
  exception to the stability rule (requirement #3) and are intentionally left as
  direct calls to the loaders.
