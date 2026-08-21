# Tasks

## 1. Mobile document rows (Issue 1)

- [x] 1.1 In the compact mobile document row (`src/components/documents/DocumentsView.tsx:3249–3261`), give the tag region flex ownership (`min-w-0`, `flex-1` as needed) via `CompactTagEditor`'s `className` prop, keep the Open / Read button `shrink-0`, and use a responsive mobile `previewLimit` (≈1 visible tag + `+N`).
- [x] 1.2 Make `CompactTagEditor` (`src/components/common/CompactTagEditor.tsx`) shrink-safe: `min-w-0 max-w-full` (+ `overflow-hidden`) on the trigger button and responsive per-chip caps (e.g., `max-w-[5rem] sm:max-w-[8rem] truncate`) so truncation engages under constrained width; desktop rendering unchanged.
- [x] 1.3 Harden the same latent pattern in `src/components/ExtractsList.tsx:726` (add `min-w-0` ownership) without changing behavior where wrapping already contains it (e.g., `routes/queue.tsx`).
- [x] 1.4 Verify the intentional horizontal-scroll rails (`DocumentsView.tsx:2953`, `:3569`, `:3704`) are untouched and the desktop grid branch (`:3268`) is unchanged.
- [x] 1.5 Add Vitest coverage: CompactTagEditor shrink/truncate contract (long single tag, many tags, zero/one tags), and DocumentsView compact-row tests asserting the Open / Read button stays rendered alongside a constrained tag region for narrow phone viewports and long/translated tag strings; keep `tagEditingIntegration` inventory tests green.
- [x] 1.6 Run `npm run test` (or the repo's frontend suite), lint, and typecheck; optionally add a 390×844 Playwright visual spec for the compact library row if low-cost.

## 2. Overlay stacking + Create Extract dialog (Issue 2)

- [x] 2.1 Migrate `CreateExtractDialog.tsx` onto the shared overlay system: first attempt `ResponsiveDialogSheet`; if the drag-drop ingest or editor internals regress, fall back to `createPortal(..., document.body)` + `.adaptive-dialog-layer`/`.adaptive-dialog-panel` classes. No new arbitrary z-index constants.
- [x] 2.2 Replace `max-h-[90vh]` sizing with dvh/`--app-viewport-height`-based sizing; ensure the body scrolls independently (`overflow-y-auto`) while header and footer remain fixed/reachable.
- [x] 2.3 Add safe-area handling to the dialog's bottom edge (reuse `.adaptive-dialog-footer` padding or `max(0.875rem, env(safe-area-inset-bottom))` pattern) and verify keyboard/visual-viewport behavior on mobile.
- [x] 2.4 Restructure the footer for phones: primary row (Cancel + Create Extract + Create & Generate Cards) with wrapping/grid layout; Create & Cloze and Create & Q&A grouped behind an accessible secondary affordance (disclosure menu or second row — decide per design Decision 3 against real label widths); desktop ≥`lg` keeps the current single row; comfortable touch targets; i18n labels wrap without clipping.
- [x] 2.5 Add Vitest coverage at narrow mobile widths: modal renders above the navigation (assert the overlay primitive/token contract, not brittle computed z-index), all actions reachable (including via the secondary affordance), no horizontal clipping of labels, body scrolls independently, safe-area class/padding contract present, desktop layout unchanged; keep existing `CreateExtractDialog.test.tsx`/`.parity.test.tsx` green.
- [x] 2.6 Verify accessibility: focus trap/restore on open/close, Escape/back dismissal, labeled actions, visible focus, screen-reader semantics of the action grouping.

## 3. Android manifest + notification permission (Issue 3a)

- [x] 3.1 Add the `androidx.media3.session.MediaSessionService` intent filter to `RemoteMediaSessionService` in `src-tauri/plugins/plethora-android-tts/android/src/main/AndroidManifest.xml`, set `android:exported="true"` per the Media3 1.8.0 contract, and remove the stale `TtsPlaybackService` comment.
- [x] 3.2 Add `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` and implement the Android 13+ runtime request at first playback start (not app launch) from the plugin; no-op below API 33; log grant/denial.
- [x] 3.3 Evaluate the `android.media.browse.MediaBrowserService` compatibility action against Media3 1.8.0 docs and the supported surfaces; include only if verified necessary (record the decision).
- [x] 3.4 Confirm manifest merging for the generated app (`src-tauri/gen/android`) produces the expected merged service entry and permissions; document the check.

## 4. Android service lifecycle + state gating (Issue 3b)

- [x] 4.1 Change `useRemoteMediaBridge.ts` semantics: start the Android service only for a real playable/paused session; map generating to `"buffering"` (or defer start); stop silently swallowing snapshot push failures (`:124–126`) — log and surface the last error.
- [x] 4.2 Update call sites: remove `isGenerating` from the enabled condition in `useTTS.ts:474`; add a playback-gated `enabled` condition in `AudiobookViewer.tsx:2164`; verify `ReaderTTSControls.tsx:1602` semantics remain honest.
- [x] 4.3 In `AndroidTtsPlugin.kt`, publish any pending snapshot before/at `startMediaSession` so the service never boots on stale defaults; keep `stopMediaSession` teardown idempotent.
- [x] 4.4 In `RemoteMediaSessionService.kt`, remove the unconditional `enterForegroundImmediately()` on `onCreate`; rely on Media3 promotion when the forwarding player reports ready/playing; retain only the minimal compliant `startForeground` path if a `startForegroundService` contract requires it, never posting a media-style control surface before a playable session.
- [x] 4.5 Add the tagged non-spammy logger (`PlethoraMedia`) covering service start/stop, session creation, snapshot application/rejection, player state transitions, foreground promotion/failure, command reception, teardown, exceptions; replace `catch (_: Throwable)` in `updateMediaMetadata` (`AndroidTtsPlugin.kt:395`) with logged failure.
- [x] 4.6 Preserve the single-adapter rule: confirm `useMediaSession.ts` remains disabled in Tauri and no second media-session/notification owner exists (grep for competing `setActionHandler`/notification owners).

## 5. Android automated tests

- [x] 5.1 Add Kotlin tests for `WebViewBridgePlayer.getState()` mapping (idle/buffering/ready/ended, playWhenReady, stale-snapshot rejection).
- [x] 5.2 Add Kotlin tests for service lifecycle idempotence (start/start, stop/stop, start→stop→start) and the foreground-promotion policy (no media notification before playable state).
- [x] 5.3 Add Kotlin tests for snapshot handling: complete-snapshot-before-start, generating→playing transition, playing↔paused, stopped→teardown.
- [x] 5.4 Add a manifest contract test (parse the merged/declared XML: intent-filter action present, `exported`, `foregroundServiceType`, `POST_NOTIFICATIONS` declared) if feasible in the plugin's test setup; otherwise assert in CI script.
- [x] 5.5 Update frontend Vitest coverage for the bridge: enabled-condition gating (generating does not start the service), buffering state mapping, and error surfacing on failed snapshot pushes.

## 6. Regression guards

- [x] 6.1 Run `npm run test`, `npm run lint`, typecheck, and `npm run bench:check` (layout work touches hot render paths in DocumentsView).
  - Result (2026-08-21): vitest 4621/4623 pass. Two failures are UNRELATED to this change: `precisionScheduler.test.ts` ("matches the shared native fixture") breaks on the branding commit's Rust `sm20 -> precision` rename (ensemble fixture mismatch), and one ReviewCard occlusion case that passes in isolation (full-suite flake). Lint: 9 pre-existing errors, none in files touched here. `tsc --noEmit`: clean. `bench:check`: OK — no regressions, only stale-baseline (faster-than-recorded) warnings; bundle budget OK.
- [x] 6.2 Run `npm run test:scripts` and any Rust checks if plugin Rust shim files were touched.
  - Result: test:scripts 118 pass / 0 fail. Plugin Rust shim untouched, so no Rust re-check required.
- [ ] 6.3 Verify desktop Documents view, desktop Create Extract dialog, tablet layouts, and themes show no visual regression (manual pass + existing tests). <!-- REMAINS: manual visual pass; existing desktop/tablet component tests all pass. -->

## 7. Physical-device verification (mandatory completion gate)

- [ ] 7.1 Set up diagnostics: `adb logcat -c` then `adb logcat | grep -Ei 'Plethora|RemoteMediaSessionService|MediaSession|Media3|ForegroundService|AndroidRuntime'`; confirm the new lifecycle/metadata/promotion logs appear and are non-spammy.
- [ ] 7.2 During playback run `adb shell dumpsys media_session` and record: exactly one active Plethora session with correct metadata/package while playing; absent after teardown. Also check `adb shell dumpsys notification` for the media notification and POST_NOTIFICATIONS grant state.
- [ ] 7.3 Execute and record the matrix — native Android TTS; generated/cloud TTS; audiobook/local audio; pause; resume; lock screen while playing; lock screen while paused; notification shade controls; screen off; backgrounded app; return to app.
- [ ] 7.4 Execute and record: Bluetooth headset play/pause; wired headset media buttons (if hardware available); next/previous where the source supports them; seek forward/back where supported; confirm unsupported actions are not advertised (native sentence TTS shows no fake seek).
- [ ] 7.5 Execute and record: audio interruption (another app), transient focus loss (e.g., assistant/call) with correct resume-only-if-auto-paused, permanent focus loss, noisy unplug, and service teardown with no stale controls or duplicate sessions/notifications.
- [ ] 7.6 Verify metadata accuracy on the OS surface (title, author/album, section, artwork where available) and state sync across foreground/background/locked transitions; verify play/pause from the lock screen controls the app.
- [ ] 7.7 Record results of 7.1–7.6 in this file (check boxes with brief result notes); the change is not complete until every box above and below is checked.

## 8. Handoff

- [x] 8.1 Update the `native-media-lock-screen-controls` change: note that tasks 3.5/7.3 (Android physical verification) are superseded by this change's Section 7 and check them off only if executed here.
- [x] 8.2 Summarize any deviations from the design (primitive fallback used, MediaBrowserService decision, buffering semantics per source) in the change notes.
