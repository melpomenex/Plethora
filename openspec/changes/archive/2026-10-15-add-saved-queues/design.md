## Context

Plethora features an adaptive queue (`ReviewQueueView.tsx`) with dynamic ranking (DAQE) and a per-session filter modal (`SessionCustomizeModal.tsx`). Today, users can filter by category, item types, priority thresholds, and exclusion of suspended items. However, these configurations are ephemeral or only partially saved across restarts (only `sessionItemTypes` in `settingsStore.ts`). Users cannot save named query configurations, forcing them to re-select filters every study session.

See `proposal.md` for background and user need, and `specs/saved-queues/spec.md` for formal behavior requirements.

## Goals / Non-Goals

**Goals:**
- Provide a robust `SavedQueue` data model with full CRUD operations and cross-session persistence.
- Seamlessly integrate with `ReviewQueueView`, `SessionCustomizeModal`, and the main app `Toolbar`.
- Support one-click switching between saved queue profiles with instant list re-filtering.
- Allow creating a new saved queue either from `SessionCustomizeModal` or directly via `Queue → Saved Queues → New Queue`.
- Ensure active saved queue filters carry over into sequential and optimal Scroll Mode sessions.
- Provide starter default queues ("All Due", "Quick Review", "Deep Dive") on initial run.

**Non-Goals:**
- Modifying underlying FSRS scheduling equations, stability/difficulty states, or interval calculations.
- Replacing Collections; collections define document ownership and partitioning, while saved queues define dynamic query/filter views.
- Introducing multi-device cloud sync for saved queues in phase 1 (saved queues will be stored locally with export support).

## Decisions

### 1. Persistence via Dedicated SQLite Table with Tauri IPC and PWA Fallback
- **Decision**: Introduce a dedicated SQLite table `saved_queues` in `src-tauri` via migration `118_add_saved_queues.sql`, accompanied by Tauri commands (`get_saved_queues`, `create_saved_queue`, `update_saved_queue`, `delete_saved_queue`, `set_active_saved_queue`). In web/PWA mode, provide transparent `localStorage` fallback in `src/api/savedQueues.ts` matching existing patterns (such as `collections.ts`).
- **Rationale**: An SQLite table ensures relational data integrity, clean migrations, reliable atomic updates, and easy query indexing. Storing complex structured queue presets in raw `settings.json` would risk bloat and concurrency issues.
- **Alternatives Considered**:
  - *Storing in `settingsStore`*: Simpler initially, but lacks schema isolation, indexing, and clean migration guarantees.

### 2. SavedQueue Schema Definition
```typescript
export interface SavedQueue {
  id: string;
  name: string;
  icon?: string;
  collectionId?: string | null; // Scoped to a specific collection or null for global
  filters: {
    categories: string[];
    tags: string[];
    priorityRange: { min: number; max: number };
    excludeSuspended: boolean;
  };
  itemTypes: {
    documents: boolean;
    extracts: boolean;
    learningItems: boolean;
  };
  sessionDurationMinutes: number;
  maxItems: number;
  daqePresetId?: string;
  sessionGoal?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### 3. Frontend Architecture: `useSavedQueueStore`
- **Decision**: Create a dedicated Zustand store `src/stores/savedQueueStore.ts` that manages:
  - `savedQueues: SavedQueue[]`
  - `activeQueueId: string | null`
  - Methods: `loadSavedQueues()`, `createSavedQueue()`, `updateSavedQueue()`, `deleteSavedQueue()`, `activateSavedQueue(id)`
- **Rationale**: Keeps queue state decoupled from monolithic `queueStore`, avoiding unnecessary re-renders while allowing direct subscription by `ReviewQueueView`, `SessionCustomizeModal`, and `Toolbar`.

### 4. UI Entry Points & Workflow
- **Queue Header Dropdown (`SavedQueueDropdown.tsx`)**:
  - Positioned prominently in `ReviewQueueView` beside the session customization button.
  - Shows current active queue name.
  - Dropdown lists all saved queues, a "New Queue" button, and a "Manage Queues" button.
- **Save from `SessionCustomizeModal`**:
  - Adds a "Save as New Queue" button and an "Update [Queue Name]" button (when an existing saved queue is modified).
- **Manage Modal (`ManageSavedQueuesModal.tsx`)**:
  - Allows renaming, reordering, setting the default queue, and deleting queues with confirmation.
- **Main Toolbar Navigation**:
  - Connects toolbar actions to open the Saved Queues selector or launch a saved queue session directly.

## Risks / Trade-offs

- **[Risk] Category or Tag drift**: A saved queue filters by a category or tag that was renamed or deleted.
  - *Mitigation*: Filtering logic in `applyFilters` safely filters by existing metadata. If zero items match, an informative empty state displays ("No items match this saved queue's filters") with a button to edit the queue's filters.
- **[Risk] State desynchronization between `SessionCustomizeModal` and active saved queue**:
  - *Mitigation*: When a user modifies filter sliders in `SessionCustomizeModal` without saving, the active queue indicator displays an "Unsaved changes" or modified badge (e.g. `*` or dot).
- **[Risk] Scroll Mode compatibility**:
  - *Mitigation*: Active saved queue item types, categories, and priority ranges are passed cleanly to `onOpenScrollMode` options, ensuring consistency between list and reading views.
