# Tasks — unify-notifications-and-sound

Work strictly in order; each task compiles, passes `npm run lint` and
`npx vitest run <touched test files>` on its own. Never introduce new dependencies
or sound assets. Preserve the conventions in `design.md` §6. The scaffolding in
`src/lib/feedback/` (events.ts, policy.ts, capabilities.ts, index.ts, contract
tests) already exists — build on it, do not regenerate it.

## 1. Foundation (types, policy, capabilities) — scaffolded, finish the edges

- [x] 1.1 Mount the toast container once at the root.
  - Files: `src/main.tsx` (render `<Toast />` from `src/components/common/Toast.tsx`
    as a sibling of `<DevPerformanceMonitor />` inside `HashRouter`).
  - Accessibility: container already sets `aria-live`; verify with a screen reader
    that success/error toasts announce.
  - Tests: extend `src/components/common/__tests__/Toast.test.tsx` with a smoke test
    that a store dispatch renders without `ToastProvider`. Manual: trigger an import
    on desktop browser + Tauri and see the toast.
  - Acceptance: dispatched toasts visible on all surfaces; exactly one
    `.toast-container` in DOM; no console errors.
  - Non-goals: restyling; migrating `uiStore.toasts` (see 6.3).
- [x] 1.2 Delete or deprecate the legacy `uiStore` toast state so implementers have
  one toast store.
  - Files: `src/stores/uiStore.ts` (`toasts`, `addToast`, `removeToast`),
    `src/types/index.ts` (`Toast` type) — grep first; if any consumer exists,
    migrate it to `useToastStore`, else remove the state and type.
  - Acceptance: typecheck passes; no references remain.
- [x] 1.3 Implement async capability checks behind the scaffolded interface.
  - Files: `src/lib/feedback/capabilities.ts` (fill `queryAsyncCapabilities` TODO)
    using `checkNotificationPermission` (`src/utils/notificationService.ts`),
    `isPeriodicSyncSupported` (`src/utils/pushSubscription.ts`),
    `"setAppBadge" in navigator`, `supportsHaptics` (`src/utils/soundService.ts`).
  - Tests: unit tests with mocked `navigator`/`window` per surface matrix in
    `src/lib/feedback/__tests__/`.
  - Acceptance: returns honest values on jsdom (unsupported ⇒ false, never throws).

## 2. Orchestrator (decision layer)

- [x] 2.1 Implement `emitFeedback` in `src/lib/feedback/orchestrator.ts`.
  - Consume `FEEDBACK_POLICY_REGISTRY`; gates in order: policy → settings
    (`useSettingsStore.getState().settings.notifications`) → capabilities →
    visibility/focus (`document.visibilityState` + `blur`/`focus` listeners) →
    active-review-session flag (exported setter) → quiet hours (single
    implementation; port logic from `notificationService.isInQuietHours`) →
    cooldown map keyed by `dedupeKey ?? eventId`.
  - Delivery: toast via `useToastStore.getState().addToast` (do NOT also play a
    sound there — pass `silent` context so `useToast`-style double-sounds don't
    occur), sound via `playFile`/role map + gate-appropriate volume, haptic via
    `vibrate`, OS via `sendNotification` with `tag`.
  - State: module-level cooldown `Map`; persisted key
    `incrementum-feedback:last-reminder` only.
  - Tests: unit tests covering the spec scenarios (foreground downgrade, denied
    downgrade, quiet hours, dedup, sound-never-sole-channel). Mock delivery
    modules; assert resolved-channel return value.
  - Acceptance: all policy contract tests + orchestrator tests green; no delivery
    module imported at call sites anymore for migrated events.
  - Non-goals: migrating call sites (task 3), scheduling (task 4).
- [x] 2.2 Add debug instrumentation.
  - `localStorage["incrementum-feedback:debug"] = "1"` ⇒ console lines
    `event → channels | suppressed-by`. No analytics, no network.

## 3. Call-site migrations (one per commit, mechanical)

- [x] 3.1 `src/components/review/ReviewComplete.tsx`: replace direct
  `playNotificationGatedFeedback` calls with
  `emitFeedback("review.session-completed", …)` + `"review.streak-milestone"`;
  add hidden-window OS pathway per policy. Keep the `didPlaySoundsRef` guard.
- [x] 3.2 `src/components/review/queueActions.ts` + `src/utils/reviewUx.ts`:
  route action success/failure feedback through `emitFeedback("review.card-action")`
  keeping existing toast copy + Undo wiring exactly (this file is under active
  development on `main` — coordinate, smallest possible diff).
- [x] 3.3 `src/stores/documentStore.ts`: import completed / none-found / failed →
  `emitFeedback("import.completed" | "import.failed", …)`; keep messages.
- [x] 3.4 `src/components/focus/FocusTimer.tsx`: replace raw `new Notification`
  with `emitFeedback("focus.phase-completed", …)`; keep `playTimerComplete` as the
  sound delivery for this event's `complete` role; respect
  `config.notifications_enabled`.
- [x] 3.5 `src/components/layout/MainLayout.tsx`: update-available, database
  recovery, auto-backup → orchestrator events (`update.available`,
  `db.recovered-after-quarantine`, `backup.auto-backup-found`); add the missing
  `incrementum:sync-corruption` window listener → `sync.corruption` persistent
  toast.
  - Each 3.x: unit-test the mapping where a test file already exists nearby;
    manual check per surface; acceptance = identical or better visible behavior,
    no direct settings/localStorage reads left at the call site.

## 4. Reminders, badge, background repair

- [x] 4.1 `src/lib/feedback/reminderScheduler.ts`: daily reminder while app runs.
  - Boot from `src/main.tsx` via the existing `runAfterFirstPaint` pattern.
  - Read `studyReminders`/`reminderTime`; compute next fire; `setTimeout` chain +
    `visibilitychange` re-check; deliver `emitFeedback("reminder.reviews-due",
    { dueCount })` with due count from the queue stats API
    (`src/api/queue.ts` / analytics due counts — pick the cheapest existing query).
  - Cooldown: persisted once-per-calendar-day; suppress during active review
    session; `tag: "due-cards"`.
  - Replace dead `initializeNotifications`/`scheduleStudyReminder` in
    `notificationService.ts` (delete or mark deprecated with pointer).
  - Tests: fake timers around fire-time math, cooldown, quiet-hours interaction.
- [x] 4.2 Repair the installed-PWA background path: write `due-card-count`.
  - Files: `src/utils/pushSubscription.ts` (add `storeDueCountForSW(count)`), call
    it wherever queue stats load and after review completion (same hook points as
    4.3), and on `subscribeToPush`. Keep SW (`public/sw.js`) unchanged if possible.
  - Manual validation: DevTools → Application → Periodic Background Sync → trigger
    `check-due-cards`; notification shows real count.
- [x] 4.3 Badge wiring: on queue-stats load and review completion call
  `updateBadgeCount(dueCount)` / `clearBadge()` (exist in
  `notificationService.ts`), gated by `showBadge` + capability.
  - Acceptance: badge visible on installed Chromium PWA, silently absent elsewhere.

## 5. Settings UX polish

- [x] 5.1 `src/components/settings/NotificationSettings.tsx`: add
  "Reset to recommended defaults" (confirm dialog → `resetCategory("notifications")`),
  render app-preference vs. permission vs. capability as three distinct facts with
  per-platform recovery copy for denied state.
- [x] 5.2 i18n: add new keys (reset button, recovery guidance, reminder copy,
  sync-corruption toast) to all 6 locales in `src/lib/i18n/locales/` following the
  flat `"notificationSettings.*"` / `"mainLayout.*"` style; English strings are
  source of truth, other locales may start with English values marked for
  translation if that is the existing convention (verify with a recent commit).
- [x] 5.3 Verify persistence: settings survive restart on Tauri + PWA (deep-merge
  rehydration covers absent keys; confirm no version bump needed since the slice
  shape is unchanged).

## 6. Quality gates (final pass)

- [x] 6.1 Automated: `npm run lint`, `npx tsc -p tsconfig.json --noEmit` (or
  `npm run build:check`), `npx vitest run src/lib/feedback src/components/common/__tests__/Toast.test.tsx`
  plus the existing review/queue suites
  (`src/components/review/__tests__/queueActions.test.ts`,
  `src/utils/__tests__/reviewUx.test.ts`, `src/utils/__tests__/soundService.test.ts`).
- [ ] 6.2 Manual matrix (record results in the PR/commit description):
  - Tauri desktop: foreground toast-only; minimized → native notification
    (reminder + focus timer); permission prompt via Settings only.
  - Desktop browser: granted/denied/unsupported paths; hidden-tab notification;
    sound only after first gesture; no sound before interaction.
  - Mobile browser: toasts within layout, Android vibration, no iOS vibration.
  - Installed PWA: periodic-sync reminder with real due count; badge set/clear.
  - Reduced motion: floating visuals absent, textual feedback intact.
  - Keyboard-only: toast action reachable (existing focus-visible styles), Escape
    behavior unchanged; screen reader announces toasts.
  - Quiet hours active: reminder suppressed, errors still audible/visible per spec.
  - Duplicate storm: 10 identical events ⇒ 1 delivery within cooldown.
  - Review speed: grading with sounds on shows no measurable input latency
    (sounds are fire-and-forget; verify no `await` in grade path).
  - Restart: settings + daily-reminder cooldown persist.
- [ ] 6.3 Cleanup: remove now-dead code paths superseded by the orchestrator
  (`sendDueCardsNotification`, `sendStudyCompletionNotification` if unused after
  4.x), add deprecation comments to unused Rust notification commands and the
  `notification_settings` table (do NOT delete Rust code in this change).
