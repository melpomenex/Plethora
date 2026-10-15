# Design — Unified notifications and sound feedback

All file paths and symbols below were verified against the repository on 2026-07-15.
Where behavior is described as "dead" or "broken", the verification method is noted.

## 1. Repository findings (verified)

### Delivery primitives that exist and work

| Concern | Location | Notes |
|---|---|---|
| Sound playback | `src/utils/soundService.ts` | Singleton `AudioContext` + gesture unlock listeners (`installAudioUnlockListeners`), buffer cache, HTMLAudio fallback (preferred under Tauri), `FeedbackType` union (`success/error/warning/complete/click/delete/review-complete/streak/milestone`), `NotificationSoundId` (`default/glass/bloom/pulse/ascend/softbell/sonar/none`), `vibrate()` + `VIBRATION_PATTERNS`, `supportsHaptics()`. Reads settings by parsing `localStorage["incrementum-settings"]` directly. |
| Sound assets | `public/sounds/*` | All 9 feedback sounds + 6 notification sounds already shipped as `.wav`/`.mp3`/`.ogg`. **No new assets needed.** Licensing/provenance is not documented — open question. |
| Toast system | `src/components/common/Toast.tsx` | Own Zustand store `useToastStore` (module-level, not persisted), `useToast()` hook (success/error/warning/info/promise/dismiss), max 4 stack, CSS-driven progress, pause-on-hover, `role="alert"` + `aria-live="polite"`, action button (used for Undo/Open/Restore patterns). `useToast.success/error/warning` already call `playFeedback`/`vibrate`. |
| OS notifications | `src/utils/notificationService.ts` | Permission check/request + send, branching `isTauri()` → `invokeCommand("send_notification" / "check_notification_permission" / "request_notification_permission")`, else Web Notification API (via SW `SHOW_NOTIFICATION` message when controlled). Quiet-hours gate (`isInQuietHours`) reading localStorage. In-memory `setTimeout` scheduling (not persistent). Badging API helpers `updateBadgeCount`/`clearBadge`. |
| Tauri native side | `src-tauri/src/commands/notifications.rs`, `src-tauri/src/notifications.rs` | `tauri-plugin-notification = "2"` in `Cargo.toml`; capabilities in `src-tauri/capabilities/default.json` (`notification:default`, `allow-is-permission-granted`, `allow-request-permission`, `allow-notify`). `send_via_plugin` works. |
| PWA background path | `public/sw.js` (lines ~595–700), `src/utils/pushSubscription.ts` | Periodic Background Sync (`check-due-cards`, minInterval 24h, Chromium + installed PWA only). SW reads prefs and `due-card-count` from IndexedDB `incrementum-sw`/`preferences`; `storePrefsForSW()` mirrors the notifications settings slice. SW also handles `push`, `notificationclick` (focus/open + `NOTIFICATION_CLICKED` postMessage), `SHOW_NOTIFICATION`. |
| Haptics/visual feedback | `src/hooks/useHapticFeedback.ts` | Sound+vibration+floating visual (confetti for milestone). Gated by `notifications.feedbackSoundsEnabled` and `appearance.visualFeedbackEnabled`. |
| Settings | `src/stores/settingsStore.ts` (`NotificationSettings` interface at line ~331, defaults at ~685) | Persisted slice `notifications`: `enabled, studyReminders, reminderTime, dueDateReminders, soundEnabled, notificationSound, soundVolume, quietHoursEnabled, quietHoursStart, quietHoursEnd, showBadge, feedbackSoundsEnabled, feedbackVolume`. Zustand `persist` name `incrementum-settings`, version 4, `migrate` + deep-merge `onRehydrateStorage`. `updateSettingsCategory("notifications", …)`, `resetCategory("notifications")` exist. |
| Settings UI | `src/components/settings/NotificationSettings.tsx` | Permission status + request UX, background-reminders (PWA periodic sync) enable/disable, notification sound picker with preview (`playFile`), quiet hours, feedback-sound toggles, test notification (`scheduleNotification`). i18n keys `notificationSettings.*` already exist (~55 usages). |
| Platform detection | `src/lib/tauri.ts` | `isTauri()` (:32), `isNativeMobile()` (:107), `isPWA()` (:184), `invokeCommand` (:250), `listen` (:504). |
| Offline state | `src/components/pwa/OfflineIndicator.tsx` | `navigator.onLine` + online/offline listeners hook. |
| i18n | `src/lib/i18n/locales/{en,de,es,fr,ja,zh}.ts` | Flat dot-keys (`"notificationSettings.title": …`), `useI18n().t(key, params)`. |
| Focus timer | `src/components/focus/FocusTimer.tsx`, `src-tauri/src/commands/focus_timer.rs`, `src/types/focus-timer.ts` | Own config (`sound_enabled`, `notifications_enabled`), `playTimerComplete()` tones, Rust emits `focus-timer-*` events. |

### Broken / dead wiring (each independently verified)

1. **Toast container never mounted.** `<Toast />` / `ToastProvider` appear in JSX only
   inside `Toast.tsx` itself and `__tests__`. `src/main.tsx` and
   `src/components/layout/MainLayout.tsx` render neither. `grep "toast-container"
   dist/assets/*.js` → no match. Every `toast.success(...)` in the app is currently a
   silent no-op (plus an orphaned sound, since `useToast` wrappers play sounds).
2. **`initializeNotifications()` has no callers** (grep across `src/`), so
   `scheduleStudyReminder()` never runs → no review reminders on any surface while
   the app is open.
3. **SW reminder counts always 0.** Only `pushSubscription.ts:storePrefsForSW()`
   writes to `incrementum-sw` (key `notifications`). Nothing writes `due-card-count`,
   which `sw.js:getDueCardCount()` reads. Installed-PWA background reminders
   therefore never fire even when enabled.
4. **Dead exports, frontend:** `sendDueCardsNotification`,
   `sendStudyCompletionNotification`, `updateBadgeCount`, `clearBadge`,
   `initializeNotifications` (all in `notificationService.ts`) — no callers.
5. **Dead commands, Rust:** `send_study_reminder`, `send_cards_due_notification`,
   `send_review_completed_notification`, `send_document_imported_notification`,
   `create_custom_notification`, `get_notification_settings`,
   `update_notification_settings`, `schedule_study_reminders` — no frontend callers.
   `NotificationManager::send` and `schedule_study_reminders` are `eprintln!` stubs.
   The Rust `notification_settings` DB table duplicates and diverges from the Zustand
   slice (different fields, different defaults, e.g. `study_reminders: true` vs
   frontend `studyReminders: false`).
6. **`FocusTimer.tsx` (line ~342)** calls `new Notification(...)` directly: works in
   browsers only, ignores Tauri, quiet hours, and the permission-recovery UX.
7. **Legacy toast state in `src/stores/uiStore.ts`** (`toasts`, `addToast`,
   `removeToast` + `Toast` type in `src/types/index.ts`): rendered nowhere, separate
   from `useToastStore`. Confusing duplicate for any implementer.
8. **`incrementum:sync-corruption`** is dispatched (`src/main.tsx:96`) but has no
   listener — critical sync-corruption state currently surfaces nowhere.
9. **Duplicate quiet-hours/settings parsing.** `soundService`, `notificationService`,
   `pushSubscription`, and `sw.js` each re-implement localStorage/IDB settings reads;
   `notificationService.isInQuietHours` and `sw.js:isInQuietHours` are parallel
   implementations.

### Existing in-app feedback call sites (event sources)

- Review: `src/components/review/ReviewSession.tsx` (grade/delete/suspend/edit
  toasts, `useHapticFeedback`), `src/components/review/ReviewComplete.tsx`
  (`playNotificationGatedFeedback("review-complete")`, `"milestone"` when
  `current_streak === longest_streak`), `src/components/review/queueActions.ts` (+
  `src/utils/reviewUx.ts`) — postpone/suspend/dismiss with toast + undo (currently
  being extended on this branch — do not restructure).
- Import: `src/stores/documentStore.ts` (import complete/none-found/error via
  `useToastStore.getState().addToast`), `MainLayout` shared-URL import flow
  (progress info toast → success-with-Open-action → error).
- Long tasks: `src/lib/videoTranscriptionQueue.ts` (queue complete/error/info
  toasts); Rust emits `transcription://*` progress events.
- Lifecycle/system: `MainLayout` — update available (`checkForUpdates` → info toast
  with View action), startup notices `consume_startup_notice` +
  `database-recovered` listener (persistent error toast + auto-backup restore flow).
- Trainable feed: `src/hooks/useTrainFeedback.ts` (like/dislike tones + vibrate).
- Focus timer: phase completion sound + browser notification.
- ~60 files total call `useToast()` for success/error confirmation.

## 2. Event inventory and channel policy

Channel legend: Inline = state already visible in the UI; Toast = `useToast`;
Sound = role from §3; OS = OS-level notification; Badge = PWA app badge.
"—" means the channel must not be used for that event.

| Event id | Source (verified) | Importance | Inline | Toast | Sound (default) | OS notification | Suppression / notes |
|---|---|---|---|---|---|---|---|
| `review.card-graded` | ReviewSession grade handlers | passive | existing UI transition | — | `acknowledge` (opt-in; `feedbackSoundsEnabled` default **false**) | never | Never toast per-card; max 1 sound per 150 ms (rapid grading). |
| `review.card-action` (delete/suspend/postpone + undo) | ReviewSession, `queueActions.ts` | actionable | list updates | yes, with Undo action (exists) | `confirm` on success, `error` on failure | never | Dedup identical action toasts within 2 s (bulk ops get one summary). |
| `review.session-completed` | `ReviewComplete.tsx` mount | informative | completion screen (exists) | — | `complete` (gated by `soundEnabled`) | opt-in; only if document hidden/window unfocused | Haptic `review-complete` pattern. Never OS when visible — completion screen IS the feedback. |
| `review.streak-milestone` | `ReviewComplete.tsx` `hitMilestone` | informative | confetti/visual (exists) | — | `celebrate` layered 200 ms after `complete` (exists) | never | Only when `current_streak === longest_streak && > 1`. |
| `reminder.reviews-due` | new scheduler (§6) + existing `sw.js` periodicsync | actionable | queue badge/counts | foreground: 1 info toast with "Start review" | `attention` (user-selected `notificationSound`) | **primary channel** when app hidden/closed; opt-in via `enabled && studyReminders` | Quiet hours; ≤1 per day per device (persisted cooldown key); suppressed entirely during an active review session; `tag: "due-cards"` replaces stale. |
| `import.completed` | `documentStore.importFromFiles` | informative | progress state (exists) | yes (exists) | `confirm` | deferred (only for >30 s imports while hidden — v2) | Single summary toast for multi-file batches (exists). |
| `import.failed` | `documentStore`, MainLayout share-target | warning | error state | yes (exists) | `error` | never | |
| `transcription.completed` / `.failed` | `videoTranscriptionQueue.ts` | informative / warning | queue panel state | yes (exists) | `confirm` / `error` | deferred (v2, hidden-window only) | Per-queue summary, not per-segment. |
| `backup.auto-backup-found` | MainLayout startup notice | actionable | — | persistent success toast + Restore action (exists) | never | app is foreground at startup by definition | |
| `db.recovered-after-quarantine` | MainLayout notice + `database-recovered` event | critical | — | persistent error toast (exists) | never | `warning` sound | Persistent until dismissed (exists). |
| `sync.corruption` | `main.tsx:96` CustomEvent (currently unheard) | critical | — | persistent error toast + "Open settings" | `warning` | never | v1 adds the missing listener. |
| `update.available` | MainLayout `checkForUpdates` | informative | Settings page state | yes, View action, 15 s (exists) | never | silent | Once per app run (exists via single startup check). |
| `focus.phase-completed` | `FocusTimer.tsx` | actionable | timer UI (exists) | — | `complete` (timer tones, exists) | yes when window hidden/unfocused, via notificationService (replaces raw `new Notification`) | Respect focus-timer's own `notifications_enabled` + global gates. |
| `queue.due-count-changed` | queue stats load / review completion | passive | counts in UI | — | — | never | Updates PWA badge (`showBadge`) + writes `due-card-count` to `incrementum-sw` IDB. |

**Explicitly silent (no toast, no sound, no OS):** navigation/tab switches, card
flip/reveal, scrolling, text selection/extract highlighting, per-item Yjs sync events
(`incrementum:synced-*`), TTS/media transport controls, settings saves (inline state
only), RSS article reads, per-segment transcription progress, autosaves.

## 3. Sound language (6 roles, all mapped to existing assets)

Global rules: one sound at a time (new sound of equal/higher priority replaces
current; lower priority is dropped); `celebrate` is the only role allowed to layer
(after `complete`); every sound has a simultaneous visual counterpart by policy —
sound is never the sole channel. Roles are gated by exactly one of the two existing
user toggles, noted per role. Errors interrupt; nothing else does.

| Role | Purpose / events | Character | Asset (exists) | Target ≤ | Rel. loudness | Cooldown | Gate |
|---|---|---|---|---|---|---|---|
| `acknowledge` | card graded, micro-interactions | dry, neutral tick | `/sounds/click.wav` | 80 ms | 0.5× | 150 ms self | `feedbackSoundsEnabled` (default off) |
| `confirm` | action succeeded (save, postpone, import done) | soft, warm, short | `/sounds/success.wav` | 250 ms | 0.8× | 500 ms self | `feedbackSoundsEnabled` |
| `complete` | session/timer completion | restrained, resolved, slightly celebratory | `/sounds/review-complete.wav` (timer keeps `playTimerComplete` tones) | 900 ms | 1.0× | once per session | `soundEnabled` |
| `celebrate` | streak milestone | brighter, layered over `complete` | `/sounds/milestone.wav` (+ `streak.wav` reserved) | 1.2 s | 1.0× | once per session | `soundEnabled` |
| `attention` | review reminder (foreground) | gentle, non-startling; user-selectable | `NOTIFICATION_SOUND_FILES[notificationSound]`, default synth tone | 1 s | 1.0× | ≥1 h per event id | `soundEnabled` |
| `warning` / `error` | recoverable issue / failed action | muted, low, brief; error slightly harder | `/sounds/warning.mp3` / `/sounds/error.wav` | 400 ms | 0.9× | 1 s dedup per event id | `feedbackSoundsEnabled` (error vibrates too) |

Volume: role loudness multiplies the user's `feedbackVolume` (0.3 default) or
`soundVolume` (0.5 default) per its gate. No new per-role volume settings.
Haptic fallback: existing `VIBRATION_PATTERNS` per `FeedbackType` via `vibrate()`;
`supportsHaptics()` already scopes to Android/Tauri correctly.
Accessibility fallback: the paired visual channel (toast/inline/OS) is mandatory;
`prefers-reduced-motion` disables the floating visual effects in `useHapticFeedback`
but never removes textual feedback.
Licensing: bundled sounds' provenance must be confirmed before release (open
question §11 of the plan); replacements must be original or properly licensed —
never platform-imitating (no Apple tri-tone lookalikes etc.).

## 4. Platform UX contract

### Tauri desktop (macOS/Windows/Linux)
- Permission: `check_notification_permission` / `request_notification_permission`
  commands (exist). Request only from the Settings toggle or first reminder opt-in —
  never at boot.
- Foreground (window focused): OS notifications suppressed → toast instead. Focus
  detection: `document.visibilityState` + window focus/blur listeners in the
  orchestrator (frontend-only is sufficient for v1).
- Background/minimized: reminder + focus-timer events go native via existing
  `send_notification` command; app plays no webview sound for OS notifications
  (avoid double audio; plugin notification is silent today → acceptable, note as
  platform constraint: per-notification system sound is OS-controlled).
- Click behavior: v1 = default focus behavior only. `incrementum://` deep-link
  actions exist in Rust structs but are not wired; deferred.
- App closed: no delivery (no background process). Documented UX copy in Settings.
- Verify on each OS: Windows requires the app identifier/shortcut for toasts;
  Linux depends on the notification daemon; macOS shows the permission prompt on
  first `request_permission`.

### Desktop browser (tab)
- Permission requested only from Settings ("Enable notifications" affordance,
  rationale text exists in `NotificationSettings.tsx`). Denied → downgrade path:
  toast-only + guidance ("re-enable in browser site settings"); never re-prompt.
- Tab visible: toasts only. Tab hidden: Web Notification (per policy) with
  `tag` dedup; clicking focuses the tab (`notification.onclick` exists).
- Sounds only after first user gesture — already handled by
  `installAudioUnlockListeners()`; orchestrator must treat `AudioContext` failure as
  a silent no-op (existing behavior).
- Tab closed: nothing (no push server). Stated in Settings copy.

### Mobile browser (not installed)
- No OS notifications assumed. In-app: toasts sized by existing mobile layout,
  max 2 visible (interruption budget), sounds per policy after gesture, haptics via
  existing `vibrate()` on Android only (`supportsHaptics()` excludes iOS).
- Settings shows "Install the app to enable background reminders" education
  (component exists: `BackgroundNotificationSettings` unsupported branch).

### Installed PWA
- Capability-detect, never UA-sniff: `isPeriodicSyncSupported()` (exists) gates the
  background-reminders card; `"setAppBadge" in navigator` gates badge.
- Background reminders via existing periodicsync path once `due-card-count` is
  actually written (v1 fix). Browser controls cadence (~daily, requires recent use,
  Chromium-only) — copy must set expectations honestly (already partially present).
- Foreground PWA behaves like desktop/mobile browser foreground.
- iOS PWA: no periodic sync, no vibration; toast + badge (iOS 16.4+ supports badge
  only with notification permission) — treat badge as best-effort.

### Cross-cutting states
- Quiet hours: single implementation in the orchestrator (replacing the 3 parallel
  copies), applied to `attention`/OS channels only — errors/toasts are never
  time-gated.
- Offline: all v1 events are local; offline changes nothing. Reminder scheduling is
  local-time based.
- Permission denied/unsupported: policy resolver returns the downgraded channel set
  (OS→toast) — call sites never branch on permissions themselves.
- Muted/system DND: OS-owned; app must not attempt detection or workaround. Focus
  Assist/DND swallowing native toasts is expected platform behavior.

## 5. Settings UX (no new matrix)

Keep the existing `notifications` slice shape — it already models master OS toggle
(`enabled`), reminders (`studyReminders`, `reminderTime`, `dueDateReminders`),
notification sound + volume, quiet hours, badge, and UI feedback sounds + volume.
v1 changes are UX-only:

- Grouping: "System notifications" (enabled, reminders, reminder time, quiet hours,
  badge, permission status + recovery) / "Sounds" (notification sound picker +
  preview + volume; UI feedback sounds toggle + volume; haptics note on supported
  devices).
- Permission truth table rendered distinctly: app preference (persisted slice) vs.
  browser/OS permission (`checkNotificationPermission`) vs. platform support
  (capability detection). Denied state links to recovery instructions per platform.
- "Reset to recommended defaults" → `resetCategory("notifications")` (exists in
  store, needs a button + confirm).
- Defaults stay as shipped: OS notifications off, notification sounds on at 0.5,
  UI feedback sounds off at 0.3, quiet hours off (22:00–08:00 when enabled), badge
  on. New users get calm-by-default; existing users see no change (deep-merge
  rehydration preserves their values; no version bump needed).
- Focus-timer keeps its local `sound_enabled`/`notifications_enabled` config but its
  delivery routes through the orchestrator (global gates AND local toggle).

## 6. Architecture

Decision/presentation/delivery separation; delivery stays in existing modules.

```
call site ──▶ emitFeedback(event, payload)          src/lib/feedback/orchestrator.ts
                    │
                    ▼
       FEEDBACK_POLICY_REGISTRY[event]              src/lib/feedback/policy.ts (data)
                    │  channels, sound role, priority, cooldown, quiet-hours flag
                    ▼
       gates: settings slice ▸ capability ▸ focus/visibility ▸ active-review ▸
              quiet hours ▸ dedup/cooldown map
                    │ resolved delivery set (possibly downgraded, e.g. os→toast)
        ┌───────────┼──────────────┬───────────────────┐
        ▼           ▼              ▼                   ▼
   toast (exists) sound (exists) haptic (exists)  os notification (exists)
   useToastStore  soundService   soundService     notificationService
                                                        │ isTauri? command : Web/SW
```

- **Types** (`src/lib/feedback/events.ts`): `FeedbackEventId` union +
  `FeedbackEventPayloads` map. Scaffolded with this change.
- **Policy registry** (`src/lib/feedback/policy.ts`): pure data
  `Record<FeedbackEventId, FeedbackPolicy>` per §2 + `SoundRole → FeedbackType/file`
  mapping. Scaffolded; contract-tested.
- **Capabilities** (`src/lib/feedback/capabilities.ts`): synchronous surface
  detection (`tauri-desktop | tauri-mobile | pwa | browser`) composed from existing
  `lib/tauri.ts` helpers + interface for async checks (notification permission,
  periodic sync, badge). Scaffolded interface; async impl is task 1.3.
- **Orchestrator** (`orchestrator.ts`, task 2.1): `emitFeedback`, module-level
  cooldown `Map<eventKey, timestamp>`, `document.visibilityState` listener, single
  quiet-hours implementation, active-review-session flag (set by ReviewSession
  mount/unmount). Settings read via `useSettingsStore.getState()` (typed) — not
  localStorage parsing.
- **Zustand ownership**: no new store. Policy/cooldowns are module state (reset on
  reload — acceptable; the only persisted cooldown is the daily reminder key, one
  localStorage entry `incrementum-feedback:last-reminder`). Settings stay in
  `settingsStore.notifications`. Toasts stay in `useToastStore`.
- **Reminder scheduler** (`reminderScheduler.ts`, task 4.1): boots from `main.tsx`
  after first paint (matches `runAfterFirstPaint` pattern), computes next
  `reminderTime`, `setTimeout` chain while running + re-check on
  `visibilitychange`; delivers through `emitFeedback("reminder.reviews-due")`.
  Replaces dead `initializeNotifications`.
- **Playback lifecycle**: unchanged (`soundService` cache + unlock). Preload the ≤4
  role files lazily on first idle after boot (existing `bufferCache` makes this a
  few fetches; skip on native mobile to protect boot memory).
- **Failure handling**: every delivery is fire-and-forget with internal try/catch
  (existing convention); orchestrator returns the resolved channel set for tests.
- **Observability**: `debugLog` guarded by `localStorage["incrementum-feedback:debug"]`
  printing event → resolved channels + suppression reason; no analytics.

## 7. Explicit non-goals / deferred

Deferred: transcription/import OS notifications for long hidden-window tasks;
`incrementum://` deep-link actions from notification clicks; native mobile
(Android/iOS Tauri) scheduled local notifications; Web Push with server; haptics
abstraction beyond existing `vibrate()`; per-category notification toggles; removal
of dead Rust commands + `notification_settings` table (deprecation comments only in
v1); notification history/inbox; per-role volume mixer.

Out of scope: new sound assets, audio libraries, notification frameworks, redesigns
of existing toast visuals, gamification expansion, email digests.
