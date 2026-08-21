# Design: Fix Mobile Layout Overflow and Android Media-Session Reliability

## Context

Three physical-device failures were investigated against the latest code. All suspected causes were verified, corrected, or extended:

**Issue 1 (Documents rows).** The CompactLibraryView mobile row (`DocumentsView.tsx:3249–3261`) is `flex items-center justify-between gap-2` with a `shrink-0` Open/Read button and a bare `<CompactTagEditor previewLimit={3} />`. `CompactTagEditor`'s root is `relative inline-flex` (`CompactTagEditor.tsx:83`); chips truncate individually at `max-w-[8rem]` but there is no aggregate cap, and as a flex item with default `min-width: auto` the editor refuses to shrink — so a long tag ("Science Fiction Space Exploration Novel") pushes the action off a 390px viewport. The desktop grid branch (`:3268`) uses plain truncated text and is unaffected. The repo already contains the correct pattern (`DeckManagerCardRow.tsx:230–239` wraps the editor in `flex-1 min-w-0 … overflow-hidden`), and `tagEditingIntegration` inventory tests require surfaces to keep using `CompactTagEditor`.

**Issue 2 (Create Extract dialog).** The overlay is `fixed inset-0 z-[100]`, not portaled, rendered inline from `DocumentViewer.tsx`. `.mobile-bottom-nav` is `z-index: 1000` (`mobile.css:285`), so the nav deterministically paints above the dialog. The codebase already has the fix infrastructure: `--overlay-backdrop-z: 1050` / `--overlay-sheet-z: 1051` tokens (`mobile.css:19–20`) consumed by `.adaptive-dialog-layer`/`.adaptive-dialog-panel`, and a full shared primitive `ResponsiveDialogSheet` (portal to `document.body`, bottom-sheet presentation on phone/tablet, dvh sizing via `--app-viewport-height`, safe-area padding, focus trap/restore, overlay dismissal). The footer is one non-wrapping `flex items-center justify-end gap-3` row with five unconditional buttons (Cancel, Create Extract, Create & Generate Cards, Create & Cloze, Create & Q&A — i18n keys `extracts.*`). Commit `3d3127f3` (2026-08-18, unified extract editor) introduced the five-button shape.

**Issue 3 (Android media controls).** Plugin: Media3 **1.8.0**, compileSdk 36, minSdk 24, targetSdk 36. Verified findings, ranked:

1. **`POST_NOTIFICATIONS` is absent repo-wide** (no manifest declaration, no runtime request). On Android 13+ the OS silently drops the MediaStyle media notification that carries lock-screen/notification controls; the FGS keeps running so nothing crashes. This is the highest-confidence root cause and was not among the original suspects.
2. **The service lacks the `androidx.media3.session.MediaSessionService` intent filter** (`AndroidManifest.xml:36–39`: `exported="false"`, `foregroundServiceType="mediaPlayback"`, no intent filters). Required by the Media3 contract for media-button routing and restart-after-process-death; explains broken controls after task removal but not total absence during live playback.
3. **The forwarding player is NOT the suspected problem** — `WebViewBridgePlayer.getState()` (`RemoteMediaSessionService.kt:290–306`) does report `STATE_READY` and `playWhenReady` from `MediaBridge`. The real fragility is that every link in the JS→native snapshot chain swallows errors: `catch (_: Throwable)` in `updateMediaMetadata` (`AndroidTtsPlugin.kt:395`) and `catch { return null }` in the bridge (`useRemoteMediaBridge.ts:124–126`), with zero logging — a broken push is indistinguishable from "no controls."
4. **The service starts too early**: `useTTS.ts:474` enables the bridge during `activeTtsIsGenerating`; `AudiobookViewer.tsx:2164` passes no `enabled` prop (service starts on mount); `startMediaSession` (`AndroidTtsPlugin.kt:376–381`) starts the service before any snapshot exists; `onCreate` unconditionally calls `enterForegroundImmediately()` posting a minimal notification; generating maps to `"paused"`, never `"buffering"` (`useRemoteMediaBridge.ts:99`).
5. **Duplicate `TtsPlaybackService` is ruled out** — the class was deleted; only a stale manifest comment remains.

The single-adapter rule holds (`useMediaSession.ts` disables the browser adapter inside Tauri), so a native failure leaves zero controls — there is no fallback to lean on.

## Goals / Non-Goals

**Goals:**

- Open/Read (and any primary row action) can never be pushed off-screen by metadata on phones.
- Create Extract is fully usable on phones: above the nav, safe-area aware, scrollable body, responsive action hierarchy.
- Codify the row/modal/action/safe-area invariants as reusable capabilities.
- Android shows real lock-screen/notification media controls during playback, driven by a correctly registered, correctly lifecycle-managed Media3 session.
- Make the native media chain observable and make physical-device verification a release gate.

**Non-Goals:**

- Rewriting `RemoteMediaSessionService`'s forwarding player or migrating playback to ExoPlayer.
- A second media-session pathway; re-enabling browser MediaSession inside Tauri.
- Changing desktop/tablet documents layouts, desktop dialog behavior, themes, or intentional `overflow-x-auto` rails.
- Replacing `CompactTagEditor` with raw markup (breaks tag-editing inventory tests).
- Fixing every legacy ad-hoc modal (`ConfirmDialog`, `ItemStatsModal`, etc.) — only Create Extract migrates now; the stacking capability sets the rule for future work.
- New arbitrary z-index constants (e.g., 99999).

## Decisions

### 1. Fix Issue 1 at both layers, using the existing `min-w-0` precedent

- **Call site** (`DocumentsView.tsx:3250`): pass `className="min-w-0"` (plus `flex-1` ownership if needed by the row) to `CompactTagEditor` and use a responsive `previewLimit` (e.g., `previewLimit={1}` on the compact mobile row) so the collapsed preview is roughly one chip + `+N`. The button keeps `shrink-0`; `justify-between` then pins it inside the row. Mirrors `DeckManagerCardRow.tsx:230–239`.
- **Component** (`CompactTagEditor.tsx`): make the trigger shrink-safe — `min-w-0 max-w-full` (and `overflow-hidden`) on the trigger button, and tighten per-chip caps responsively (e.g., `max-w-[5rem] sm:max-w-[8rem]`) so a single long tag leaves room for the icon and sibling action at 390px. `truncate` only engages under a width constraint, which is why the component-level fix is required in addition to the call-site fix.
- **Why both:** the call-site fix alone leaves the component dangerous in every other constrained context (e.g., the same latent pattern in `ExtractsList.tsx:726`, which gets the one-line `min-w-0` hardening); the component fix alone can't assign flex ownership in the row.
- **Alternative rejected:** making the row `overflow-x-auto` (converts a bug into ambiguous scrolling), or replacing the editor with a static tag display (breaks inventory tests and editing UX).
- **Explicitly untouched:** `overflow-x-auto` rails at `DocumentsView.tsx:2953/3569/3704`, the desktop grid branch, and global `previewLimit` defaults.

### 2. Migrate Create Extract onto the shared overlay primitive, not a bespoke patch

Re-home the dialog onto `ResponsiveDialogSheet` (or, if its sheet form factor conflicts with the dialog's drag-drop/complex body, portal the existing JSX to `document.body` and adopt `.adaptive-dialog-layer`/`.adaptive-dialog-panel` classes). Either path yields: z above the nav via the existing 1050/1051 tokens, dvh sizing against `--app-viewport-height`, safe-area padding (`.adaptive-dialog-footer` already pads with `env(safe-area-inset-bottom)`), focus trap/restore, and dismissal contract.

- **Why `ResponsiveDialogSheet` first:** it is the convention other migrated surfaces already use; it deletes the entire class of stacking/safe-area bugs structurally instead of patching this instance.
- **Fallback decision rule:** if the migration risks regressing the dialog's drag-drop ingest or editor internals, use the portal + token classes path — same stacking/safe-area outcome, smaller diff. The implementation agent should attempt the primitive first and fall back only on concrete regression.
- **Alternative rejected:** bumping `z-[100]` to `z-[1100]` — fixes paint order but leaves no portal (transform-ancestor trap), `90vh` sizing, missing safe areas, and the unwrappable footer.

### 3. Footer: primary pair + grouped secondary actions on phones

On phone widths, render a two-row hierarchy: row 1 = Cancel + **Create Extract** + **Create & Generate Cards** (primary, full-width-weighted grid, `flex-wrap` as the floor); row 2 (or a compact "More" menu when vertical space is tight) = **Create & Cloze** and **Create & Q&A**. Desktop (≥`lg`) keeps the current single row. All five actions stay reachable; the grouping uses an accessible disclosure (aria-expanded/aria-controls, labeled trigger) consistent with existing mobile menu patterns (`MobileContextMenuSheet` is a reference for form factor, not necessarily the implementation). Buttons keep `min-h` comfortable touch targets; labels use existing i18n keys so longer locales wrap rather than clip.

- **Why hierarchy over uniform wrap:** five equal-weight buttons force sub-label-width buttons on 390px; the primary actions are the high-frequency paths and deserve prominence.
- **Alternative rejected:** horizontal scroll of footer actions (hidden affordances in a modal footer), icon-only compression (loses labeled clarity, i18n-fragile).

### 4. Android: fix registration, lifecycle gating, and observability — keep the forwarding player

- **Manifest:** add the intent filter to the existing service declaration:
  ```xml
  <service
      android:name=".RemoteMediaSessionService"
      android:exported="true"
      android:foregroundServiceType="mediaPlayback">
      <intent-filter>
          <action android:name="androidx.media3.session.MediaSessionService" />
      </intent-filter>
  </service>
  ```
  (`exported="true"` is required for the system/media controller binding to the intent-filtered service; Media3's `MediaSessionService` internally enforces caller verification.) Add `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />` and request the runtime permission at the moment playback first starts (not app launch), using the standard Android 13+ request flow from the plugin. Evaluate the `android.media.browse.MediaBrowserService` compatibility action against Media3 1.8.0 docs: include it only if Android Auto/library-client support is in scope; it is not needed for lock-screen/notification controls. Remove the stale `TtsPlaybackService` comment.
- **Lifecycle gating:** the frontend bridge starts the service only when a real playable/paused session exists. Concretely: `useTTS.ts` stops including `isGenerating` in `enabled`; `AudiobookViewer.tsx` passes an `enabled` condition tied to actual playback state; `snapshotFor` maps generating to `"buffering"` (or the service stays unstarted until playing/paused). `startMediaSession` publishes any pending snapshot before/at start so the service never boots on stale defaults.
- **Foreground promotion:** remove the unconditional `enterForegroundImmediately()` on `onCreate`. Rely on Media3's promotion when the forwarding player reports ready/playing. Keep a minimal compliant path only if a `startForegroundService` call requires immediate `startForeground` (Android ANR contract) — in that case post a silent/minimal notification that Media3 replaces, and never a media-style control surface before a playable session exists. Start/stop remains idempotent.
- **Observability:** add a small tagged logger (`PlethoraMedia`) with non-spammy logs at service start/stop, session creation, snapshot application (including rejected-stale), player state transitions, foreground promotion/failure, command reception, teardown, and exceptions. Replace both silent catches (`AndroidTtsPlugin.kt:395`, `useRemoteMediaBridge.ts:124–126`) with logged failures; the bridge surfaces the last error in dev diagnostics.
- **Preserved:** `MediaBridge`, `WebViewBridgePlayer`, durable command queue, focus state machine, dispatcher, ack contract — all unchanged. No ExoPlayer migration; no second session owner; `useMediaSession.ts` stays disabled in Tauri.

### 5. Verification as a gate, not a handoff

Tasks include the adb/logcat recipe (`adb logcat -c`, filter on `Plethora|RemoteMediaSessionService|MediaSession|Media3|ForegroundService|AndroidRuntime`), the `adb shell dumpsys media_session` expectation (single Plethora session while active, absent after teardown), `adb shell dumpsys notification` to confirm grant/notification presence, and the full physical matrix (TTS native/generated, audiobook, pause/resume, lock playing/paused, shade, screen off, background, return, BT/wired, next/prev/seek where supported, transient/permanent focus loss, noisy unplug, teardown). Each item must be checked off in tasks.md for the change to be complete; this supersedes the unchecked 3.5/7.3 in `native-media-lock-screen-controls`, which stays open for its desktop items (5.4).

## Risks / Trade-offs

- [Component-level chip-cap change could alter existing layouts that rely on 8rem chips] → Responsive caps only engage below `sm`; desktop rendering unchanged; existing CompactTagEditor tests + a new shrink-contract test guard it.
- [`ResponsiveDialogSheet` migration may conflict with the dialog's drag-drop ingest or editor internals] → Decision rule in Decision 2: fall back to portal + token classes; the spec requires the outcome (stacking, safe areas, scrollable body), not a specific primitive.
- [`exported="true"` widens the service's attack surface] → Media3 `MediaSessionService` verifies callers against the session; only known controller signatures reach callbacks; matches the documented Media3 contract for intent-filtered services.
- [POST_NOTIFICATIONS prompt timing could annoy users] → Request once, at first playback start, with a graceful no-prompt degradation on Android <13; denial keeps playback working in-app, and the diagnostics log records the denial.
- [Removing `enterForegroundImmediately` could violate the `startForegroundService` ANR contract if any path still calls it] → Audit all start paths; if `startForegroundService` is retained anywhere, keep the minimal compliant notification exactly for that contract and let Media3 replace it.
- [Gating service start on playback could regress "resume from lock screen before app opens" flows] → Media3 restart-after-death path (now enabled by the intent filter) plus the durable command queue cover media-button resume; verify explicitly in the physical matrix.
- [Footer grouping hides Cloze/Q&A behind an extra tap on phones] → Acceptable: they are specialized flows; primary create/generate remain one tap; desktop unchanged.

## Migration Plan

1. Ship Issue 1 + Issue 2 frontend fixes with component tests (independently revertible, no data migration).
2. Ship Android manifest + permission + lifecycle + logging changes together (they are one behavioral unit); bump nothing in Media3.
3. Execute the physical-device matrix; record results in tasks.md; only then mark the change complete.
4. Rollback: frontend changes revert cleanly; the Android changes revert by restoring the previous manifest/service behavior — no persisted state, queue files, or schema changes are involved.

## Open Questions

- Does any OEM skin on the tester's device require the `MediaBrowserService` compatibility action for lock-screen controls? (Resolve during physical verification; default is to omit unless proven necessary.)
- Should the "More" secondary-actions affordance be a menu sheet or a persistent second row? (Decide during implementation against real label widths in en + longest locale; spec permits either.)
- Whether `ReaderTTSControls`/`useTTS` need distinct buffering semantics for cloud-TTS chunk gaps or whether `"buffering"` maps uniformly. (Implementation agent to verify against adapter states; must remain honest, never fake-playing.)

## Implementation Deviations (recorded 2026-08-21)

- **Overlay primitive fallback used (Decision 2's sanctioned path).** `CreateExtractDialog` keeps its own JSX but is portaled via `createPortal(..., document.body)` into `.adaptive-dialog-layer` / `.adaptive-dialog-panel` / `.adaptive-dialog-backdrop` classes. Reason: the dialog hosts overlay-level paste-capture and file drag-drop ingest plus a document-context strip that `ResponsiveDialogSheet`'s fixed header/body/footer structure cannot host without regressing ingest. Stacking, dvh sizing, and safe-area outcomes are identical. Panel width preserved at `42rem` via inline style (the shared class caps at `38rem`).
- **Footer uses one DOM set of buttons reflowed with order utilities** (grid on phones, `lg:flex` row on desktop) instead of duplicated mobile/desktop markup — keeps handlers/state/labels single-sourced and existing `getByText`-based tests unambiguous.
- **MediaBrowserService compatibility action: omitted** (Decision 3.3). Verified against the Media3 1.8.0 contract and the supported surface matrix; it is only required for `MediaBrowserCompat` clients (Android Auto/library browsing), which are out of scope, and not needed for lock-screen/notification controls. Recorded in the manifest comment.
- **Foreground promotion (Decision 4):** normal path now uses plain `startService` (no startForeground obligation; Media3 promotes when the forwarding player reports ready/playing). `startForegroundService` + the minimal compliant notification are retained ONLY as the backgrounded-start fallback (`IllegalStateException` from `startService`), gated by `needsCompliantStartForeground`.
- **Buffering semantics:** the bridge gained a `playbackState` option. Audio-player default remains `playing`/`paused`; TTS adapters pass explicit `buffering` while generating/loading. `useTTS` no longer enables the bridge during generation; `ReaderTTSControls` stays enabled during auto-play but reports honest `buffering`; `AudiobookViewer` gates on `isPlaying || currentTime > 0`; native Android TTS starts the service only once speaking/paused (removed the pre-generation `startMediaSession` call in `useNativeAndroidTTS.speak`).
- **Snapshot observability:** `MediaBridge.updateSnapshot` now returns `false` when a stale snapshot is rejected; both the plugin and the JS bridge log failures instead of swallowing them (`PlethoraMedia` log prefix, `console.warn("[media] …")` on the JS side).
- **Pre-existing, out-of-scope failures observed at verification time:** `precisionScheduler.test.ts` native-fixture mismatch (caused by the branding commit's Rust `sm20 -> precision` rename) and one flaky `ReviewCard` occlusion case that passes in isolation; 9 pre-existing lint errors in untouched files.

## Physical-device root cause addendum (2026-08-21, verified on Pixel 9 Pro XL)

The first on-device reproduction (release build) showed no lock-screen controls and zero diagnostics. Two compounding causes, both fixed:

1. **`app.tauri.Logger` is `BuildConfig.DEBUG`-gated** — every diagnostic (new and pre-existing) was compiled out of release builds. Media diagnostics now use direct `android.util.Log` with the stable tag `PlethoraMedia`.
2. **Release-only Jackson deserialization failure** — the visible logs immediately showed every `update_media_metadata` push failing with "Cannot construct instance of `t3.B` (no Creators)". `UpdateMediaMetadataArgs`, `AckMediaCommandsArgs`, and `DiscardMediaCommandsArgs` lacked `@InvokeArg`; the consumer ProGuard rules keep only `@InvokeArg`-annotated classes, so release R8 renamed/stripped them (`t3.B`) while debug builds worked. With the annotation added, snapshots apply and Media3 promotes: `dumpsys media_session` shows one active `com.plethora.app` session as the media-button session, tracking playing/paused state. Also repaired the stale pre-rebrand `-keep class com.incrementum.androidtts.**` rule (it protected nothing).
