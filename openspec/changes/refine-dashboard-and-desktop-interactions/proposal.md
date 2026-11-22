# Change: Refine Dashboard Insights, Tray Menu, Iconography, Handbook Terminology, and Reader Rescheduling

Covers **Requirement #2** (Sleep & Learning Insights on Dashboard), **Requirement #4** (expanded native tray menu), **Requirement #5** (distinct AI Flashcard Studio icon), **Requirement #9** (correct scheduler terminology in Handbook), and **Requirement #12** (interactive overdue/due-date rescheduling in the reader).

## Why

1. **Dashboard Sleep & Learning Insights (#2):** Plethora has a full wearable health & Learning Insights workspace (`LearningInsightsTab.tsx`, `healthApi`), but none of its key sleep/learning signals are surfaced on the main `DashboardTab.tsx` where users start their study sessions.
2. **Native tray menu (#4):** `src-tauri/src/tray.rs` currently only exposes Show, Hide, and Quit, missing quick-access actions for Queue, Review, Continue Reading, Import Document, Learning Insights, and Settings.
3. **Flashcard Studio icon (#5):** `DocumentViewer.tsx` uses `Brain` for both "View Learning Cards" (`L7993`, `L7705`) and "AI Flashcard Studio" (`L8144`, `L7604`).
4. **Handbook terminology (#9):** `schedulerCatalog.ts` already maps `adaptive -> SM-18` and `precision -> SM-20`, but `docs/USER_HANDBOOK.md` (and translated handbooks + `docs/product/features/scheduling/`) still use "SM-18" and "SM-20".
5. **Interactive due-date label (#12):** `DocumentViewer.tsx:7935-7946` renders the overdue / due-date badge as a static `<span>` instead of an interactive rescheduling control.

## What Changes

- **Dashboard Sleep & Learning card:** Add a compact, dismissible, non-blocking `SleepLearningDashboardCard` to `DashboardTab.tsx` reusing `healthApi.getSleepChart` / `healthApi.getLearningInsights` (7-day sleep duration, bedtime/sleep variability or regularity, recent recall/insight, 7-day sparkbars, empty state with Connect/Log/Explore actions, and "View Learning Insights →" navigation).
- **Expanded native tray menu:** Expand `src-tauri/src/tray.rs` with Open Plethora, Open Queue, Start Review, Continue Reading, Import Document…, Learning Insights, Settings, Hide Plethora, Quit Plethora; dispatch typed tray actions through `MainLayout.tsx` with pending-action buffering during startup initialization.
- **Distinct Flashcard Studio icon:** Replace `Brain` on Flashcard Studio toolbar launchers in `DocumentViewer.tsx` (desktop & mobile) and draft toggle in `FlashcardStudioModal.tsx` with `CardsThree` from `@phosphor-icons/react`, keeping `Brain` for Learning Cards.
- **Handbook terminology:** Update `docs/USER_HANDBOOK.md`, translated handbooks, and scheduling feature docs to use `SM-18` and `SM-20` (preserving `Algorithm Arena` / ensemble distinctions and without renaming serialized IDs), and rebuild the help index (`npm run docs:build-index`).
- **Interactive due-date rescheduling:** Convert the reader's due-date badge in `DocumentViewer.tsx` into an accessible popover/sheet control with relative-to-today presets (Tomorrow, In 3 days, In 7 days, Today when future-scheduled), custom date picker, backend scheduling command (`reschedule_document` setting an exact target date without altering progress/history/rating or scaling by `interval_modifier`), store synchronization, and Undo toast.

## Impact

- **Affected specs:** `tray-integration` (modified), plus new specs for `dashboard-learning-insights`, `flashcard-studio-icon`, `handbook-scheduler-terminology`, `reader-due-date-rescheduling`
- **Non-goals:** Renaming internal Rust/DB scheduler IDs (`adaptive`, `precision`), adding cloud AI uploads of health data, or changing close-to-quit window behavior.
