# Tasks: Refine Dashboard and Desktop Interactions

## 1. Dashboard Sleep & Learning Insights (#2)
- [x] 1.1 Create `SleepLearningDashboardCard` (`src/components/health/SleepLearningDashboardCard.tsx`) with populated, empty, demo-labeled, and dismissible states without importing Recharts into the Dashboard bundle.
- [x] 1.2 Integrate `SleepLearningDashboardCard` into `src/components/tabs/DashboardTab.tsx` without blocking Dashboard startup or render.
- [x] 1.3 Add unit tests for populated metrics, empty state, demo labeling, privacy/dismiss persistence, and navigation to Learning Insights.

## 2. Expanded Native Tray Menu (#4)
- [x] 2.1 Expand `src-tauri/src/tray.rs` with Open Plethora, Open Queue, Start Review, Continue Reading, Import Document…, Learning Insights, Settings, Hide Plethora, Quit Plethora, plus `PendingTrayAction` startup buffering.
- [x] 2.2 Wire `"tray://action"` listener and startup pending-action consumption in `src/components/layout/MainLayout.tsx` using canonical tab/action dispatchers.
- [x] 2.3 Add Rust unit tests for tray menu item definitions/action mapping.

## 3. Distinct Flashcard Studio Icon (#5)
- [x] 3.1 Replace `Brain` with `CardsThree` on AI Flashcard Studio toolbar buttons in `DocumentViewer.tsx` (desktop & mobile) and `FlashcardStudioModal.tsx`.
- [x] 3.2 Verify Learning Cards retains `Brain` and AI Flashcard Studio uses `CardsThree`.

## 4. Handbook Scheduler Terminology (#9)
- [x] 4.1 Update `docs/USER_HANDBOOK.md` (and translated handbooks + scheduling docs + `handbook.*` i18n keys) to use `SM-18` and `SM-20` with accurate Algorithm Arena / ensemble attribution.
- [x] 4.2 Regenerate help index (`npm run docs:build-index`) and run `npm run docs:validate`.

## 5. Interactive Due-Date Rescheduling (#12)
- [x] 5.1 Add `reschedule_document` Tauri command (`src-tauri/src/commands/queue_bulk.rs`) and `rescheduleDocument` API wrapper (`src/api/queue.ts`) preserving review history and reading progress.
- [x] 5.2 Replace the static due-date `<span>` in `DocumentViewer.tsx` with an accessible rescheduling popover (Today/Tomorrow/3d/7d/Custom date, keyboard/Escape/focus management, Undo toast, store sync).
- [x] 5.3 Add Vitest tests for relative-to-today date calculation, history preservation, and Undo safety (`DueDateRescheduleControl.test.tsx`).
