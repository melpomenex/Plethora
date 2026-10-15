## Why

Plethora's documentation (`USER_HANDBOOK.md`) promises "Saved Queues" as a core pillar of Smart Queues alongside Adaptive Ranking (DAQE): creating custom focused queues by filtering a collection by category, item types, priority thresholds, naming and saving them, and accessing them via a "Queue → Saved Queues" workflow.

Currently, while `SessionCustomizeModal` provides per-session ephemeral filtering and DAQE knob tuning, users have no way to name, save, persist, or switch between filter presets (such as "Today's Focus", "Quick Review", "Deep Dive", or "Exam Prep"). Every time a learner wants to focus on a specific subset (e.g. only Biology cards with priority > 50), they must manually re-configure the modal filters from scratch. Implementing Saved Queues fulfills the promised capability, eliminates repetitive session setup, and bridges the gap between the documented handbook experience and the actual application.

## What Changes

- **Saved Queue Entity & Storage**: Define a typed `SavedQueue` model containing:
  - Identification: `id`, `name`, `icon`, `isDefault`, `createdAt`, `updatedAt`
  - Membership Filters: `categories`, `tags`, `itemTypes` (documents, extracts, flashcards), `priorityRange` (`min`, `max`), `excludeSuspended`
  - Session & Ranking Parameters: `sessionDurationMinutes`, `maxItems`, optional `sessionGoal`, and optional `daqePresetId`
  - Durably persist saved queues across sessions and application restarts.
- **Queue Toolbar & Header Navigation**:
  - Add a **Saved Queues** selector in the Queue view header and Toolbar navigation, enabling one-click switching between saved queue presets.
  - Provide a "New Queue" action directly accessible from the Queue header and Toolbar dropdown, fulfilling the documented `Queue → Saved Queues → New Queue` path.
- **Queue Creation & Management UI**:
  - Enhance `SessionCustomizeModal` with "Save as New Queue" and "Update Current Queue" actions.
  - Add a dedicated **Manage Saved Queues** modal/sheet to rename, duplicate, reorder, set default, and delete saved queues.
  - Provide sensible built-in starter queues (e.g. "All Due", "Quick Review", "Deep Dive") that users can customize or remove.
- **Store & Session Integration**:
  - Introduce `useSavedQueueStore` (or integrate into `queueStore`) to track the currently active saved queue ID and list of saved queues.
  - Applying or switching a saved queue immediately re-filters `filteredItems` in `queueStore` and propagates to sequential and optimal Scroll Mode sessions.
- **Command Palette & Keyboard Access**:
  - Add command palette actions (`Ctrl/Cmd+K`) to switch to any saved queue or create a new saved queue.

## Capabilities

### New Capabilities
- `saved-queues`: Defines the data model, storage persistence, CRUD management operations, toolbar navigation/switching, and filter application for user-defined saved queues.

### Modified Capabilities

## Impact

- **Frontend Types & Store**:
  - `src/types/savedQueue.ts`: Type definitions for `SavedQueue`, `SavedQueueFilterConfig`, and CRUD inputs.
  - `src/stores/savedQueueStore.ts`: Zustand store managing saved queues, active queue selection, and persistence.
- **Frontend Components**:
  - `src/components/queue/SavedQueueDropdown.tsx`: Dropdown selector for the Queue header / toolbar to switch queues and create a new queue.
  - `src/components/queue/ManageSavedQueuesModal.tsx`: Management dialog for editing, renaming, deleting, and reordering saved queues.
  - `src/components/review/SessionCustomizeModal.tsx`: Integrate "Save as Queue" / "Update Queue" triggers.
  - `src/components/review/ReviewQueueView.tsx`: Mount `SavedQueueDropdown` in the queue header controls.
  - `src/components/Toolbar.tsx`: Add Saved Queues menu item or quick-access action.
- **Persistence Layer**:
  - SQLite table `saved_queues` via a new migration or structured storage in settings repository, with export/import support.
- **Localization**:
  - Add translation keys for saved queues under `src/locales/` (`queue.savedQueues`, `queue.newQueue`, `queue.saveQueueAs`, etc.).
- **Documentation**:
  - Align handbook instructions with the exact UI interaction flow across all supported languages.
