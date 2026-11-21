# Design: Dashboard and Desktop Interactions

## 1. Dashboard Sleep & Learning Card (#2)
- Lazy-fetch `healthApi.getSleepChart` (last 7 days) and `healthApi.getLearningInsights` after Dashboard mounts, gated on `isTauri()` and user visibility preference (`localStorage` / dashboard preference key so hiding persists).
- Never block Dashboard initial render or `observeStartupSurface({ surface: "dashboard" })`.
- Display up to 3 primary metrics (7d Avg. sleep, Bedtime variability or Regularity if >= 8 days, Recent recall / tracked nights), a lightweight CSS/SVG 7-day bar strip (zero Recharts dependency in Dashboard), and at most 1 evidence-backed `PersonalInsight` (never causal claims, never mixing demo data with real data, clearly badged if `demo === true`).
- Empty state offers "Log sleep" / "Connect wearable" / "Learn about Learning Insights" -> opens `LearningInsightsTab`.

## 2. Expanded Native Tray Menu (#4)
- In `src-tauri/src/tray.rs`, add menu items with stable IDs (`tray-open`, `tray-queue`, `tray-review`, `tray-continue-reading`, `tray-import`, `tray-learning-insights`, `tray-settings`, `tray-hide`, `tray-quit`), localized/clear labels, and platform gating (`#[cfg(desktop)]`).
- On menu click: `show_main_window(app)` (show + unminimize + set_focus), then emit `"tray://action"` with `{ action: "..." }` AND store the latest pending action in a small Rust `PendingTrayAction` state (or `tray_take_pending_action` command) so actions triggered before `MainLayout` mounts are never lost.
- In `MainLayout.tsx`, listen once to `"tray://action"` and consume any pending action on mount, routing via `openTabByType` / `requestDestinationAction` (reusing existing tabs and avoiding duplicate sessions).

## 3. Flashcard Studio Icon (#5)
- Use `CardsThree` (verified exported by `@phosphor-icons/react`) for Flashcard Studio launchers in `DocumentViewer.tsx` (desktop and mobile toolbars) and `FlashcardStudioModal.tsx` mobile drafts toggle, leaving `Brain` on Learning Cards (`viewMode === "cards"`).

## 4. Handbook Terminology (#9)
- Update `docs/USER_HANDBOOK.md` and `docs/USER_HANDBOOK.{zh,ja,fr,es,de}.md` plus `docs/product/features/scheduling/{adaptive-algorithm,precision-arena}.md`, `docs/DEVELOPER_SCHEDULERS.md`, and `src/lib/i18n/locales/*.ts` `handbook.*` strings to use `SM-18` and `SM-20`, clearly distinguishing pure SM-20 kernel vs Algorithm Arena ensemble.
- Run `npm run docs:build-index` and `npm run docs:validate` to regenerate `helpIndexData.ts` / `helpIndex.json`.

## 5. Interactive Due-Date Rescheduling (#12)
- Add a clean `reschedule_document(document_id, next_reading_date)` Tauri command in `src-tauri/src/commands/queue_bulk.rs` that updates `next_reading_date` via `repo.update_document_scheduling` (preserving stability, difficulty, reps, total_time_spent, progress, and review history) and journals for sync, returning the previous `next_reading_date` for safe Undo.
- In `DocumentViewer.tsx`, replace the static `<span>` badge with a `<button>` + accessible popover (`role="dialog"` / Escape / focus return) offering Today (if future), Tomorrow, In 3 days, In 7 days, and `<input type="date">` custom picker, using local calendar dates.
- Synchronize `useDocumentStore` and `useQueueStore` immediately and show an Undo toast that restores the previous date only if `nextReadingDate` still matches the rescheduled value.
