# Proposal: Fix Mobile Layout Overflow and Android Media-Session Reliability

## Why

Physical-device testing surfaced three production regressions: (1) in the mobile Documents view, a long tag enlarges the document row until the primary **Open / Read** action is pushed off-screen; (2) the Create Extract dialog renders below the mobile bottom navigation (`z-[100]` vs the nav's `z-index: 1000`) and squeezes five footer actions into a single non-wrapping row that clips on a phone; and (3) Android lock-screen/notification media controls never appear during playback or TTS, despite `native-media-lock-screen-controls` being otherwise implemented — its physical-device verification tasks (3.5, 7.3) remain unchecked, and this failure is exactly in that unverified area.

## Current repository audit (2026-08-21)

Verified against the latest code; suspected causes were confirmed, corrected, or extended as follows.

### Issue 1 — Documents row overflow (confirmed)

- `src/components/documents/DocumentsView.tsx:3249–3261` (CompactLibraryView mobile row, `lg:hidden`): a plain `flex items-center justify-between gap-2` row containing `<CompactTagEditor ... previewLimit={3} />` and an explicit `shrink-0` **Open / Read** button. Neither side has flex-shrink ownership.
- `src/components/common/CompactTagEditor.tsx:83` root is `relative inline-flex` with no width constraint; per-chip truncation exists (`max-w-[8rem] truncate`, line 101) but there is **no aggregate cap** — 3 chips ≈ 24rem+ intrinsic width. As a flex item with default `min-width: auto`, it refuses to shrink, so the `shrink-0` button leaves the viewport on a 390px phone.
- The desktop grid branch (`DocumentsView.tsx:3268`) uses plain truncated text, not CompactTagEditor, so desktop is unaffected. The legacy list-mode row (`:1803`) wraps tags in a `flex-wrap` metadata row, degrading more gracefully but still able to overflow horizontally.
- Precedent for the fix already exists: `DeckManagerCardRow.tsx:230–239` wraps CompactTagEditor in `flex-1 min-w-0 … overflow-hidden`.
- Intentional horizontal-scroll rails that must NOT be touched: `DocumentsView.tsx:2953` (compact filter chips), `:3569` (funnel chips), `:3704` (card rails).
- `tagEditingIntegration` inventory tests require surfaces to keep using `CompactTagEditor` — the fix must stay within it, not replace it with raw markup.

### Issue 2 — Create Extract dialog (confirmed, with corrected detail)

- `src/components/extracts/CreateExtractDialog.tsx:588`: overlay is `fixed inset-0 z-[100] …`, **not portaled** (rendered inline from `DocumentViewer.tsx`). `.mobile-bottom-nav` (`src/styles/mobile.css:285`) is `position: fixed; z-index: 1000` — deterministically above the dialog.
- Centralized overlay tokens already exist: `--overlay-backdrop-z: 1050` / `--overlay-sheet-z: 1051` (`mobile.css:19–20`), consumed by `.adaptive-dialog-layer`/`.adaptive-dialog-panel` (`src/index.css:393,418`) and the nav's own More sheet. The dialog simply does not use them.
- Footer (`CreateExtractDialog.tsx:961–1032`): one non-wrapping `flex items-center justify-end gap-3` row with Cancel + Create Extract + Create & Generate Cards + Create & Cloze + Create & Q&A (all unconditional in create mode). No `flex-wrap`, no safe-area padding; panel uses `max-h-[90vh]` (not dvh/app viewport tokens).
- A shared primitive that solves all of this already exists: `src/components/adaptive/ResponsiveDialogSheet.tsx` — portals to `document.body`, uses the 1050/1051 tokens, presents as a bottom sheet on phone/tablet, handles dvh height via `--app-viewport-height`, safe-area padding, focus trap/restore, and overlay dismissal. Several dialogs already portal to `document.body`; CreateExtractDialog is in the ad-hoc minority.
- Recent commit `3d3127f3` ("unified extract editor for create and edit", 2026-08-18) is when the five-button footer took shape.

### Issue 3 — Android media controls (root causes verified; two suspected causes corrected)

Plugin state: Media3 **1.8.0** (`media3-common`, `media3-session`), compileSdk 36, minSdk 24, app targetSdk 36. Verified findings:

1. **Missing `POST_NOTIFICATIONS` permission (highest-confidence root cause).** A repo-wide grep finds zero occurrences of `POST_NOTIFICATIONS` — not in the plugin manifest, not in the generated app manifest, no runtime request anywhere. On Android 13+ (targetSdk 36), every notification — including the MediaStyle media notification that drives lock-screen/notification controls — is silently dropped without the grant. The foreground service still runs, so nothing crashes; the controls simply never appear. This matches the reported symptom exactly and was **not** among the original suspects.
2. **Missing `androidx.media3.session.MediaSessionService` intent filter (confirmed).** `AndroidManifest.xml:36–39` declares the service with `exported="false"` and `foregroundServiceType="mediaPlayback"` but no intent filter. Per the Media3 contract, the `androidx.media3.session.MediaSessionService` intent action is required for media-button routing and service restart after process death (API 31+ media resume). While the process lives, buttons route through the session callback, so this explains broken controls after task removal rather than their total absence. The legacy `android.media.browse.MediaBrowserService` compatibility action should be evaluated for Android Auto/browser-client compatibility but is not required for lock-screen controls.
3. **Fragile state plumbing (refines suspect "forwarding player never reports ready").** The forwarding player *does* report `STATE_READY`/`playWhenReady` correctly (`RemoteMediaSessionService.kt:290–306`), so the original suspicion as stated is incorrect. However, every link in the JS→native snapshot chain swallows errors silently: `updateMediaMetadata` has `catch (_: Throwable)` (`AndroidTtsPlugin.kt:395`) and the bridge has `catch { return null }` (`useRemoteMediaBridge.ts:124–126`). Any failed push leaves Media3 seeing idle/paused forever — indistinguishable from "no controls" from outside. There are no logs and no tests over `WebViewBridgePlayer.getState()`.
4. **Service started too early (confirmed behavior, amplifier not blocker).** `useTTS.ts:474` enables the bridge during `activeTtsIsGenerating`; `AudiobookViewer.tsx:2164` passes no `enabled` prop at all (service starts on viewer mount). `startMediaSession` starts the service before any snapshot push, and `onCreate` calls `enterForegroundImmediately()` posting a minimal notification while the player is idle — generating is mapped to `"paused"`, never `"buffering"` (`useRemoteMediaBridge.ts:99`).
5. **Duplicate `TtsPlaybackService` conflict (ruled out).** The class was deleted; only a stale manifest comment references it (`AndroidManifest.xml:13`).

The single-adapter rule holds: `useMediaSession.ts` intentionally disables the browser adapter inside Tauri, so when the native path fails there is no fallback — which is why fixing the native integration properly is mandatory, and why physical-device verification must become a release gate.

## What Changes

- Fix the mobile document row flex hierarchy so optional metadata (tags) can never push the **Open / Read** action out of the viewport: give the tag region `min-w-0` flex ownership, make `CompactTagEditor` shrink-safe internally (`min-w-0 max-w-full` trigger, responsive chip caps), and use a responsive preview limit on phones. Preserve intentional horizontal-scroll chip/filter rails and desktop layouts unchanged.
- Re-home the Create Extract dialog onto the application's shared overlay system (`ResponsiveDialogSheet` or equivalent portal + `--overlay-backdrop-z`/`--overlay-sheet-z` tokens) so it always sits above the mobile bottom navigation, respects bottom safe areas and dynamic viewport height, keeps its body scrollable, and never clips actions horizontally.
- Restructure the Create Extract footer into a responsive mobile action hierarchy (primary actions prominent; specialized Create & Cloze / Create & Q&A behind wrapping/grid layout or a compact overflow menu on phones) instead of one non-wrapping horizontal row. Desktop layout stays efficient.
- Codify reusable mobile layout invariants (row, modal stacking, mobile action, safe-area) as specs so future surfaces inherit them.
- Fix the Android native media integration:
  - Declare the `POST_NOTIFICATIONS` permission and request it at runtime at the appropriate moment (first playback), since without it Android 13+ drops the media notification entirely.
  - Add the required `androidx.media3.session.MediaSessionService` intent filter to `RemoteMediaSessionService`'s manifest declaration (and evaluate the `android.media.browse.MediaBrowserService` compatibility action against Media3 1.8.0 requirements).
  - Gate service start on a meaningful playback/paused session rather than mount/generating; publish the complete snapshot before/at service start; map generating to an honest buffering/idle state; let Media3's playback lifecycle own foreground promotion instead of an unconditional `enterForegroundImmediately()` on `onCreate`.
  - Make the JS→native metadata chain observable (non-spammy logs for start, session creation, metadata publication, state changes, foreground promotion/failure, teardown, command reception, exceptions) and stop swallowing update failures silently.
  - Keep the existing forwarding-player architecture, durable command queue, dispatcher, and single-native-adapter rule intact; no ExoPlayer migration, no second media-session pathway, browser MediaSession stays disabled inside Tauri.
- Make physical-device verification a mandatory completion criterion of this change, with a concrete adb/dumpsys verification matrix covering TTS, audiobooks, pause/resume, lock screen, notification shade, background/screen-off, Bluetooth/wired headsets, seek/next/previous where supported, audio focus interruptions, noisy unplug, and teardown.

## Capabilities

### New Capabilities

- `responsive-mobile-document-rows`: document/list rows keep primary actions visible; flexible metadata (tags/categories/authors/labels) shrinks and truncates instead of overflowing the container.
- `responsive-extract-dialog`: the Create Extract dialog is fully usable on phones — above app chrome, safe-area aware, scrollable body, responsive action hierarchy with no clipped or unreachable actions.
- `application-overlay-stacking`: top-level modal surfaces use the centralized overlay tokens/portal layer and always render above application navigation chrome; ad-hoc z-index values are prohibited for new overlays.
- `android-media-session-reliability`: the Android Media3 session registers correctly (manifest contract incl. POST_NOTIFICATIONS and the MediaSessionService intent action), starts only for real playback sessions, publishes honest state/metadata observably, tears down cleanly, and is validated by a mandatory physical-device matrix.

### Modified Capabilities

None. The existing `native-media-lock-screen-controls` change remains active and unarchived; this change is a focused follow-up that corrects its production Android integration and hardens its verification gate without replacing its architecture or specs. Its unchecked tasks 3.5/7.3 are superseded by the mandatory matrix in `android-media-session-reliability`.

## Impact

- **Frontend:** `src/components/documents/DocumentsView.tsx` (compact mobile row), `src/components/common/CompactTagEditor.tsx` (shrink-safety, responsive preview), `src/components/extracts/CreateExtractDialog.tsx` (overlay migration, footer hierarchy), possibly `ExtractsList.tsx` (same latent pattern, hardening only).
- **Styles/system:** reuse of `src/styles/mobile.css` overlay tokens and `src/index.css` adaptive-dialog/safe-area utilities; no new magic z-index values; intentional `overflow-x-auto` rails untouched.
- **Android plugin:** `src-tauri/plugins/plethora-android-tts/android/src/main/AndroidManifest.xml` (permissions + service intent filter), `AndroidTtsPlugin.kt` (start gating, logging), `RemoteMediaSessionService.kt` (foreground promotion policy, logging), plus Kotlin tests for player state, lifecycle idempotence, and snapshot handling.
- **Frontend hooks:** `src/hooks/useRemoteMediaBridge.ts` (enabled semantics, buffering state, error surfacing), call sites `useTTS.ts`, `ReaderTTSControls.tsx`, `AudiobookViewer.tsx`.
- **Tests:** Vitest component tests (document rows, CompactTagEditor, CreateExtractDialog mobile contract), Kotlin unit tests, optional Playwright visual spec at the existing 390×844 default viewport; mandatory manual physical-device matrix recorded in tasks.
- **Constraints preserved:** themes, desktop UI, tablet layouts, desktop native controls, web MediaSession outside Tauri, normalized command dispatcher, durable pending-command queue, listening/read-position persistence, Study Mode mappings, all TTS providers, audiobook playback.
