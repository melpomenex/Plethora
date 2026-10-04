## 1. Data Model and Storage Layer

- [x] 1.1 Add TypeScript interfaces for `SavedQueue`, `SavedQueueFilters`, and CRUD DTOs in `src/types/savedQueue.ts`. Verify types with `npx tsc --noEmit`.
- [x] 1.2 Create database migration `src-tauri/migrations/118_add_saved_queues.sql` defining `saved_queues` table and register migration in `src-tauri/src/database/migrations.rs`. Verify compilation with `cargo check`.
- [x] 1.3 Implement Rust backend commands and repository in `src-tauri/src/commands/saved_queues.rs` (`get_saved_queues`, `create_saved_queue`, `update_saved_queue`, `delete_saved_queue`, `set_active_saved_queue`). Verify compilation with `cargo check`.
- [x] 1.4 Implement API layer in `src/api/savedQueues.ts` with Tauri invoke wrappers and browser/localStorage fallback with starter default queues ("All Due", "Quick Review", "Deep Dive"). Verify with unit tests in `src/api/__tests__/savedQueues.test.ts`.

## 2. State Management

- [x] 2.1 Create Zustand store in `src/stores/savedQueueStore.ts` managing `savedQueues`, `activeQueueId`, and CRUD actions (`loadSavedQueues`, `createSavedQueue`, `updateSavedQueue`, `deleteSavedQueue`, `activateSavedQueue`). Verify with unit tests in `src/stores/__tests__/savedQueueStore.test.ts`.
- [x] 2.2 Wire `savedQueueStore` to initialize at startup in `src/stores/startupStore.ts` and re-sync when collection switches. Verify startup initialization via test.

## 3. UI Components and Workflows

- [x] 3.1 Create `src/components/queue/SavedQueueDropdown.tsx` providing a dropdown menu in the queue header displaying active queue name, queue list, "New Queue", and "Manage Queues". Verify with component unit test.
- [x] 3.2 Create `src/components/queue/ManageSavedQueuesModal.tsx` for renaming, reordering, deleting, and setting default queues. Verify with component unit test.
- [x] 3.3 Enhance `src/components/review/SessionCustomizeModal.tsx` with "Save as New Queue" and "Update Current Queue" buttons. Verify with component unit test.
- [x] 3.4 Integrate `SavedQueueDropdown` into `src/components/review/ReviewQueueView.tsx` header controls and connect active queue changes to update `sessionCustomization` and list filtering. Verify with unit tests in `src/components/review/__tests__/ReviewQueueView.test.tsx`.
- [x] 3.5 Add "Saved Queues" action to `src/components/Toolbar.tsx` and Command Palette (`Ctrl/Cmd+K`) to switch queues. Verify toolbar and command palette integration with tests.

## 4. Scroll Mode Integration, Localization, and Verification

- [x] 4.1 Ensure active saved queue filters and item types carry over into `onOpenScrollMode` in `ReviewQueueView.tsx`. Verify with `src/components/review/__tests__/ReviewQueueView.scrollModeEntry.test.tsx`.
- [x] 4.2 Add localization keys for all saved queue UI strings in `src/lib/i18n` across supported languages. Verify no missing keys.
- [x] 4.3 Update `docs/USER_HANDBOOK.md` to ensure instructions match the newly implemented UI workflow. Verify docs consistency.
- [x] 4.4 Run full automated test suite and benchmark gate (`npm test` and `npm run bench:check`). Verify all tests pass with zero regressions.
