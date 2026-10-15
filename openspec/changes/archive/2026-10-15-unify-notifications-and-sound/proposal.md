# Unify notifications and sound feedback

## Why

Incrementum already owns every low-level primitive for user feedback — a Web-Audio
sound service with bundled assets, a cross-platform notification service (Tauri
plugin + Web Notifications + service-worker periodic sync), a toast system, haptics,
quiet hours, and a persisted `notifications` settings slice. But the layer that
should connect them does not exist, and several wires are provably cut:

- The `<Toast />` container is never mounted in the production tree, so the ~60 call
  sites using `useToast()` and the stores dispatching `useToastStore.addToast()`
  update state that nothing renders. (Verified: no `<Toast/>`/`ToastProvider` JSX
  outside `src/components/common/Toast.tsx` and its tests; `toast-container` absent
  from built assets.)
- `initializeNotifications()` in `src/utils/notificationService.ts` — the only thing
  that schedules the daily study reminder — has zero callers. Review reminders never
  fire in-app on any platform.
- The installed-PWA background reminder path (`public/sw.js` `periodicsync` →
  `checkDueCardsAndNotify()`) reads `due-card-count` from the `incrementum-sw`
  IndexedDB, but no app code ever writes that key, so the reminder always sees 0 due
  cards and never notifies.
- `sendDueCardsNotification`, `sendStudyCompletionNotification`, `updateBadgeCount`
  (frontend) and `send_study_reminder`, `send_cards_due_notification`,
  `send_review_completed_notification`, `send_document_imported_notification`,
  `create_custom_notification`, `get/update_notification_settings` (Rust) have no
  callers. The Rust `notification_settings` table is a second, divergent source of
  truth vs. the Zustand slice.
- `FocusTimer.tsx` bypasses the notification service with raw `new Notification(...)`
  (no Tauri path, no quiet hours, no permission recovery).
- Every call site decides sound/toast/notification independently, reading
  `localStorage` directly; there is no deduplication, cooldown, focus-suppression, or
  priority policy anywhere.

## What Changes

- Mount the existing toast container once at the app root so in-app toasts render
  again on every surface (desktop, browser, mobile, PWA).
- Add a small decision layer (`src/lib/feedback/`) — typed app events, a per-event
  channel/sound policy registry, and an `emitFeedback()` orchestrator that applies
  user preferences, quiet hours, window focus, deduplication, and cooldowns before
  delegating to the existing delivery services (`soundService`, `notificationService`,
  `Toast`). No new dependencies; no new sound assets (all 9 bundled sounds are reused
  as the 6-role sound palette).
- Migrate the highest-value call sites to the orchestrator: review session completion
  (+ streak milestone), destructive card/queue actions with undo, document import
  completion/failure, focus-timer phase completion (replacing raw `new Notification`),
  update-available, and database-recovery notices.
- Make review reminders real with one policy per surface: an in-app scheduler while
  the app is open (all platforms; delivers an OS notification only when the window is
  hidden/unfocused, otherwise an inline toast), plus repairing the existing
  installed-PWA periodic-sync path by actually writing `due-card-count` when queue
  stats load.
- Wire the existing-but-dead PWA app-badge (`updateBadgeCount`) to due counts, gated
  by the existing `showBadge` setting.
- Settings polish only (no new matrix): a "Reset to recommended defaults" action using
  the existing `resetCategory("notifications")`, permission-state recovery guidance,
  and the existing sound preview. No settings-store migration is required for v1.

## Capabilities

### New Capabilities

- `feedback-orchestration`: One policy-driven pathway from app events to inline UI,
  toasts, sounds, haptics, badge, and OS notifications, with per-event channel
  defaults, suppression rules, deduplication, and quiet hours honored on Tauri
  desktop, desktop browser, mobile browser, and installed PWA.

### Modified Capabilities

- None (existing toast/sound/notification behavior is preserved where it already
  works; call sites are migrated mechanically).

## Impact

- App shell: `src/main.tsx` (mount toast container, boot reminder scheduler).
- New: `src/lib/feedback/` (events, policy registry, orchestrator, capability
  detection, tests) — scaffolded with this change.
- Migrated call sites: `src/components/review/ReviewComplete.tsx`,
  `src/components/review/queueActions.ts`, `src/stores/documentStore.ts`,
  `src/components/focus/FocusTimer.tsx`, `src/components/layout/MainLayout.tsx`.
- Repaired delivery plumbing: `src/utils/pushSubscription.ts` (+ one new write path
  for `due-card-count`), `src/utils/notificationService.ts` (reminder scheduling,
  badge), `src/components/settings/NotificationSettings.tsx` (reset + status UX).
- Localization: new keys in `src/lib/i18n/locales/*.ts` (6 locales, flat dot-keys).
- No database migration, no new external dependency, no new sound assets.
- Rust notification commands stay as-is in v1; dead per-category Rust settings
  (`notification_settings` table) are documented as deprecated, removal deferred.
