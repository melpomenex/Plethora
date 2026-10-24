# Implementation evidence

Started 2026-10-23 at HEAD `71d598594` (version 3.4.0). Implementation is ongoing; unchecked tasks and unexecuted acceptance remain pending. The internal rollout gate in `src/services/audio/audioPlaybackRollout.ts` is disabled.

## Authorized dependency amendment

The user chose “Revise dependencies; keep rollout disabled” on 2026-10-23 after the baseline preflight reported no connected Android device. Task 1.1 remains a prerequisite. Tasks 1.2–1.3 and all hardware/runtime acceptance still gate rollout, but no longer prevent implementation. P1 implementation may proceed alongside P0; its acceptance obligations remain unchanged.

## Audit and worktree reconciliation (task 1.1)

Read proposal, audit, design, all six delta specifications, validation and review. Current HEAD equals the audited revision. At task start the tracked diff contained only the existing podcast-spec header normalization and `tauri.linux.conf.json` transparency change. The proposed change and `fix-reader-scroll-save-overhead` were untracked directories. No application playback implementation existed in that initial diff; review.md also records proposal-only work. These pre-existing edits are preserved.

Rechecked source anchors:

- `AudiobookViewer.tsx:3507` still creates the audio element; `:2384` owns its periodic save timer; `:2675` mounts its media bridge.
- `SessionPlayer.tsx:49` owns a separate audio element and `:75` resolves recording media in the component.
- `longFormPlaybackSession.ts:48` replaces the registry entry without pausing the previous host.
- `RemoteMediaSessionService.kt:243,540` constructs a forwarding `WebViewBridgePlayer`, without ExoPlayer decoding.
- `main.tsx:556` mounts routing above the current source viewers.

`openspec list --json` overlap snapshot: `native-media-lock-screen-controls` 27/30, `fix-mobile-layout-and-android-media-controls` 32/39, `podcast-subscription-playback` 0/15, `unified-recording-ingestion-and-learning-studio` 48/48, `eliminate-long-running-memory-growth` 32/44, `fix-linux-appimage-runtime-and-rendering` 11/15, `preserve-tab-state-on-switch` 12/13, and `fix-reader-scroll-save-overhead` 0/24. These are planning statuses, not runtime evidence.

## Available baseline (tasks 1.2–1.3 remain incomplete)

Host: Linux Wayland, `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-1`. PipeWire 1.6.9 exposes PulseAudio protocol 35 at `/run/user/1000/pulse/native`. A 3.4.0 AppImage exists under `src-tauri/target/release/bundle/appimage/`; its source/build hash was not established, so it is not a matched packaged-runtime baseline. No native UI automation surface is available in this session. `adb devices -l` returned an empty device list. No existing full-shell real-media continuity harness was found; the audiobook shelf harness is a layout test with empty section audio URLs.

Before refactoring the production owner paths:

- Playback baseline: the ten existing suites named in validation.md passed, **94/94 tests**, 6.11 seconds. Existing `act(...)` warnings and mocked failures appear in the raw log. This verifies the automated baseline only; audible output, DSP/learning parity and hardware lifecycle are unmeasured.
- `npm run bench:check`: **67 benchmark comparisons passed**, bundle check passed (entry 4 KB, one PDF worker, total 26.7 MB). Stale-baseline warnings for faster benchmarks were retained; no budgets or baselines were modified.
- Strict OpenSpec validation passed.

Raw local baseline artifacts are `.bench/global-audio-baseline/playback-tests.log`, `.bench/global-audio-baseline/bench-check.log`, and the raw benchmark counters in the gate log (the shared results JSON is overwritten by later runs). These logs are ignored local artifacts, not portable hardware evidence. The initial playback log also exists at `/tmp/plethora-global-audio-baseline/playback-tests.log`.

No matched frame/paint/audio-loopback/CPU/RSS traces, ten-minute playback samples, or physical platform results have been collected. Product thresholds in validation.md remain acceptance criteria and are not measured results.

## Foundation verification

Controller, coordinate, source-resolver and persistence tests initially passed 15/15 cases. Source resolution retains Range streaming, desktop-only m4b preparation, contiguous ready edition sections, and the canonical recording media command. The new code is not yet a production playback replacement. Native service, source-view migration, focus arbitration, mini/expanded UI, and complete feature parity remain required.

## Foundation checkpoint at 22:40 UTC

10/45 tasks are checked: 1.1, 2.1, 2.2, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.6. This is not completion of global playback. Source viewers, TTS/video/capture entry points, OS bridge ownership, native ExoPlayer/service commands, queue policy and mini/expanded UI still require migration before rollout. Main-window host/projection scaffolding exists; 2.6 remains unchecked pending full-shell lifecycle coverage. Source resolution is partly extracted; 2.3 remains unchecked pending full native/source acceptance. Session storage contracts exist; 3.5 remains unchecked pending queue/account/live-native recovery integration.

- New frontend tests: 34/34 across eight files, including focus handover, cancellation, retry, selector isolation, StrictMode/window gating and HTML-element listener disposal. The prior combined run passed 119/119 tests before the last focused additions.
- Rust temporary SQLite: 5/5 passed, including nullable global positions and no overwrite of existing legacy time when preceding part durations are unknown. A final formatted-source rerun is pending.
- Browser: real IndexedDB transaction and reload/shared-facade integration passed. No real media/visual continuity claim follows from this test.
- Android journal: five Robolectric tests passed; a sixth deferred-capture test was subsequently added. The journal is isolated preparation and is not wired to the service or a native decoder; task 4.3 remains unchecked.
- Android baseline command used command-local `MISE_JAVA_VERSION=17.0.14+7`, `ANDROID_HOME=/home/ubuntu/Android/Sdk`, `ANDROID_SDK_ROOT=/home/ubuntu/Android/Sdk`. No global toolchain configuration changed. Existing unit suite: 35 passed, one failure at `WordPositionOffsetsTest.kt:34` (`charOffsetResolvesToItsSentence`). Neither that test nor implementation was edited. Raw log: `/tmp/plethora-global-audio-gradle-baseline.log`.
- `npm run build:check` passed docs validation, typecheck, production build and bundle budgets (entry 5 KB, one PDF worker, total 26.8 MB). Build warnings about sql.js Node-module externals and large existing chunks remain.
- Full lint reported 1641 errors/10807 warnings. Lint over all changed frontend files reported zero errors and seven warnings at unchanged declarations in browser-backend/database/main. New-only lint is checked separately.
- `npm run test:scripts`: 235 passed, four failed: missing macOS `plutil`; dist target assertion expects Tauri while build:check produced PWA; existing marketing screenshot attribution; macOS RAM probe executed on Linux. `git diff --name-only -- scripts` is empty. These failures were recorded without changing unrelated scripts/assets.
- One benchmark rerun during concurrent checks failed eight comparisons. The repeat after that load settled passed all 67 comparisons and bundle budgets. No perf/bundle baseline was changed. Raw logs: `/tmp/plethora-global-audio-bench-final.log`, `/tmp/plethora-global-audio-bench-idle.log`.

Rollout remains disabled. No commit, push, PR, installation, release, or production owner replacement has occurred.


## Implementation checkpoint at 23:55 UTC

Production rollout is still hardcoded false. The enabled development path now includes service-owned ExoPlayer and source authorization, the native adapter, a dock and lazy essential expansion, and initial source presentation/focus migrations. These are implementation progress, not completion of the full change. Queue, advanced transcript/learning/DSP parity, deletion policy, desktop lifecycle/SMTC repair, full-shell performance/paint/memory verification, and physical platform matrices remain outstanding.

- Rust source resolution reads stored source identities, shares existing Range-path authorization, uses canonical recording lookup, and mints bounded one-use profile capabilities. Capabilities and decoder URIs are transient. Five plugin Rust tests passed, including profile binding, one-use consumption and expiration. Root resolver coordinate test passed.
- Android ordinary decoding lives in the existing service via one ExoPlayer, not an Activity/WebView. AtomicFile journal is wired to native transitions and periodic changed playback. Eight SQLite handover/import tests passed. Twelve journal/player Robolectric tests passed; the subsequent focus-inclusive run also passed. Native system transport applies directly and records receipts atomically; no JS transport replay is emitted for ordinary media.
- Native adapter subscribes before attachment, reads live state without load/seek, rejects stale owner/generation/revision observations, reserves source generations before resolution and cancels pending loads on Stop. Root reconciliation commits SQLite before acknowledging exact native cursors. Direct frontend journal ACK is excluded from default ACL. Later account-isolation tests passed, including foreign Stop failure without projecting prior-profile titles.
- Gated source controls preserve passive browsing and reattachment without an old initial seek. Audiobook/recording legacy branches remain intact while rollout is off. Current source presentations do not yet preserve every transcript, queue, learning and DSP feature; their migration tasks remain unchecked.
- Gated app output leases now cover ReaderTTSControls, useTTS/useNativeAndroidTTS, local/custom video, YouTube and captureController. Capture refuses competing output until finish. Native Stop now cancels its producer and acknowledges after teardown. The new native path delegates TTS AudioManager requests to the media service, reuses MediaFocusStateMachine, and applies real decoder ducking while preserving user volume. Android system-TTS fallback cannot retain a sample-accurate pause; its new path stops rather than falsely claiming resumable PCM. Physical focus and fallback parity are still pending.
- Desktop/browser remote bridge is anchored beside the application owner in the enabled path, with explicit Play/Pause dispatch and legacy toggle compatibility. The remote/controller regression run passed 88 tests.
- Combined regression run passed 180 tests across 27 suites. New account/video pause tests passed 10 cases afterward. A focused TTS/recording regression passed 37 tests. Existing act/Tauri-mock warnings remain in logs.
- Real local 120-second WAV browser fixture passed at 1280x720 and 320x740: close source view, navigate Reader/Notes/Review, preserve revealed review answer, expand/collapse, save bookmark, and retain generation 1/play intent. This is a synthetic navigation shell, not the required complete application journey or audible-loopback acceptance. Initial React fixture was moved out of public/ so Vite supplies its refresh preamble; two final fixture runs passed. Captures live under .impeccable/review/global-audio-*.png (ignored local evidence).
- A fresh Impeccable reviewer returned fix for mobile full-screen composition, full source identity accessible naming, and non-color error indication. The three fixes were implemented together; recapture/verdict is in progress. Detector returned an empty finding list once for the dock/expansion files.
- Latest changed-code lint returned zero errors and seven warnings in pre-existing declarations. Typecheck passed before the last small additions; integrated build and final Rust reruns are in progress. Earlier script/full-lint and hardware limitations above remain applicable. No performance or bundle budget was weakened.

Recent logs: /tmp/plethora-global-audio-combined-tests.log, /tmp/plethora-global-audio-privacy-focus-tests.log, /tmp/plethora-global-audio-video-capture.log, /tmp/plethora-global-audio-visual-review-fixes.log, /tmp/plethora-global-audio-gradle-focus2.log, /tmp/plethora-global-audio-plugin-capability-tests.log, /tmp/plethora-global-audio-build-integrated.log, /tmp/plethora-global-audio-rust-final.log.

## UI documentation and evidence review

This is an ordinary extension of the incumbent Material 3 system, assessed against `DESIGN.md`, `.impeccable/design.json`, `docs/design-system.md`, design section 7 and the persistent-mini-player spec. No product brief or design-system rewrite was needed; those system files remain unchanged. Checked `MiniAudioPlayer.tsx`, `ExpandedAudioPlayer.tsx`, `audio-player.css`, `MobileLayoutWrapper.tsx` and `BottomControlsGeometry.tsx`. The opaque semantic surface, outline divider, primary transport, static thin progress, Phosphor icons and MD3 IconButton/Dialog reuse follow the incumbent tonal grammar. The 4rem dock, 40px/32px artwork, 48px mobile transport, measured shell reservation and shared occupied-bottom boundary are feature geometry, not new global tokens. Expansion uses a bounded desktop dialog and a viewport-height, independently scrolling mobile surface.

Visually inspected all six local captures: `.impeccable/review/global-audio-{desktop,mobile,expanded-desktop,expanded-mobile,error-desktop,error-mobile}.png`. They show the reserved bottom row, mobile navigation below it, desktop modal, full-screen mobile expansion and a recognizable warning icon alongside retained source identity. Source inspection confirms full title/section accessible naming on the dock identity action and an associated attention description; these semantics cannot be proved by screenshots alone. The fresh review's three-fix disposition was reported as ship for that fix list only, not approval of the whole feature.

The browser log `/tmp/plethora-global-audio-visual-review-fixes.log` records two passing fixture cases at 1280x720 and 320x740. `src/visual/audio-player.visual.spec.ts` covers source-view close, Reader/Notes/Review navigation, retained revealed answer, expansion/collapse, bookmark save, transport containment, generation/play intent and the error description. This synthetic shell and its captured typography do not establish complete-app styling, all-theme contrast, device behavior, zoom/keyboard/overlay/annotation matrices or audible continuity. Queue, transcript/learning/DSP parity and physical acceptance remain pending; `GLOBAL_AUDIO_PLAYBACK_ENABLED` remains false.

Not canonized or repaired: the pre-existing marketing-site kicker recorded at `DESIGN.md:293` is outside this audio extension and does not become a new chrome pattern. Fixture serif typography and local one-off geometry likewise do not replace the incumbent chrome type ramp, semantic shape or z-order contracts. No unrelated visual drift was changed.

## Dock/expansion/error verification checkpoint (2026-10-24 ~05:00 UTC)

Tasks 6.1–6.5 are implemented and were re-verified after fixing the defects below. Rollout stays disabled; packaged/hardware and full-journey acceptance remain in 7.2/7.3.

Fixes made while verifying:

- `MiniAudioPlayer.tsx`: focus restoration after collapsing the expansion no longer aborts when the overlay stack is still draining, and `[inert]` ancestors count as non-focusable. This makes Android Back/Escape collapse-then-restore deterministic instead of leaving focus on `body`.
- `ExpandedAudioPlayer.tsx`: transport `onChange` handlers captured `event.target.value` inside the deferred controller action, after React had restored the controlled select/slider; rate, volume and chapter actions therefore sent the previous value. Values are now read synchronously before the async action.
- `globalAudioController.ts`: a successful network retry left the stale `error` on the recovered snapshot. Part load/resume now clears it.
- Audio locale keys were inserted before the `...en` spread in de/es/fr/ja/zh and were silently overridden by English. They now follow the spread; `audio.playingElsewhere` was added to all six locales.

Evidence from this checkpoint:

- `npx vitest run src/components/audio/__tests__/AudioDockAndExpansion.test.tsx` — 5/5: measured desktop reservation and removal, `-30/+30` vs recording `-10/+30`, source fallback art and broken-artwork degradation, lazy expansion (no `getItem` before open), mobile keyboard suppression with retained reservation, modal inertness, selected-reading-anchor compensation, fullscreen suppression with the session intact, Back/Escape collapse before review grading, invoker focus restoration, localized German landmark/labels, unknown-duration slider value text, tick-free live region, and typing/arrow-key isolation.
- `npx vitest run src/services/audio/__tests__/audioRecoveryAndDeletion.test.ts` — 5/5: expired-URL re-resolution at the same coordinate, mismatched media-revision rejection, bounded 1/2/4/8/15 s network retry with pause cancellation, exhaustion into a recoverable error, and deletion before file release with queue pruning and “Audio removed”.
- `npx playwright test audio-player` — 17/17 in the browser harness: source close/navigation/expansion with generation 1 and retained play intent; desktop containment and reserved height at 1280x720 and 1366x768 for 100/125/150% interface-zoom layout viewports; tablet widths 768/1024; mobile 320/360/390/412 dock-above-navigation, 48 px transport targets, rotation without reload or re-seek; light/dark AA contrast for title and primary transport; lazy `ExpandedAudioPlayer` module request only after expansion; reduced motion disables dock animation; queue skip distinct from transport with paused intent.
- `npm run build:check` passed (docs validation, typecheck, production build, bundle budgets: entry 5 KB, one PDF worker, total 26.9 MB), so the expanded player is not in the initial shell chunk.
- `npm run bench:check` passed all 67 comparisons and bundle budgets on the settled repeat. The first run, started immediately after the production build, reported six unrelated regressions (command palette, precision scheduler, knowledge timeline, tabs DOM); the repeat after load subsided passed, matching the previously recorded load-sensitivity. No baseline was edited.
- `npm run test:scripts` — 4 failures, all in unrelated platform/build tooling: iOS share-extension overrides, `dist` target after the PWA build, frontend-build freshness placeholders, and the macOS RAM probe on Linux (`collectEnvironment(darwin)`). No `scripts/` file was changed by this work.
- `cargo test --lib media_control` — 3/3: canonical event mapping, stale same-session update rejection and unique event ids. The desktop bridge uses a dedicated worker, explicit detach (no silence timeout), Windows HWND/COM apartment configuration and a mutable identity for late callbacks.
- ESLint over all changed/new frontend files — 0 errors; remaining warnings are at unchanged declarations. `src/lib/i18n/__tests__` 28/28 including the literal-key coverage test.
- `npm run bench:memory:check` did **not** complete: the harness app launched, applied `132_global_audio_checkpoints`, then stopped acknowledging steps (`phase "one-doc": app did not pick up step 5 within 120000ms`) on two consecutive runs. This is recorded as an unresolved harness/environment failure, not a measured memory result. The release binary was not rebuilt from this worktree for that run; no memory baseline or budget was changed.

Not verified here: audible continuity/paint/CPU/RSS on packaged Linux, the complete primary journey, physical Android/Windows/macOS matrices, and the manual screen-reader/TalkBack checks. Those remain in tasks 7.2, 7.3 and 8.6.


## P1 parity checkpoint 2026-10-24

Rollout remains disabled (`GLOBAL_AUDIO_PLAYBACK_ENABLED = false`). The following implementation tasks were completed and verified with local automated checks; hardware/runtime acceptance is still outstanding.

- **8.1 Listening queue projection.** `src/services/audio/listeningQueueProjection.ts` projects the controller queue into the persisted `ListeningQueueItem` shape, projects Listen Later current index/playing state without per-tick serialization, and forwards synthesized/prefetched edition order back through `updateQueue`. Ready Listen Later items play through the owner with their ordered queue; unsynthesized items keep the existing synthesis view. The legacy viewer Listen Later auto-advance is gated to `!controllerBacked`. Five new projection tests plus the controller end-once/paused-advance/missing-item/restore tests passed.
- **8.2 Native Study Mode capture.** Native `load_audio` now carries a versioned Study Mode configuration (Rust `resolve_native_audio_source` -> `studyConfig`). `PlaybackCoordinator.transport` keeps Play/Pause/SeekTo as transport, executes replay/skip/chapter mappings once, and journals capture mappings with press-time source/session/generation/part/position and the mapped action before publishing a receipt. Duplicate request IDs are rejected; a later source switch never rebinds a pending capture. `get_audio_snapshot` exposes the journal captures; `NativeAudioAdapter` executes them through `src/services/audio/deferredStudyCapture.ts`, which persists an existing listening-session bookmark with the original anchor and empty text, and acknowledges only after persistence. A new Kotlin coordinator test and adapter/deferred-capture tests passed (15 coordinator Robolectric tests, 11 adapter tests, 4 deferred tests, 34 dispatcher tests).
- **8.3 Owner-lifetime processing.** `HtmlAudioEngine` owns one optional WebAudio processing chain (MediaElementSource -> analyser -> gain) for volume boost and amplitude sampling; no second decoder/element is created. `GlobalAudioController` exposes `setVolumeBoost`, `setSilenceSkip` (100 ms monitor, 500 ms silence threshold, paused playback stops skipping) and `setPolicyIntervals`; sponsor intervals are enforced in global media coordinates and publish a `policySkip` once. `AudiobookViewer` disables unsupported controls instead of hiding/silently dropping them, supplies SponsorBlock intervals to the owner, and shows the owner-published skip notification. Controller tests covered interval-once, source reset, truthful capability reporting and paused-monitor stop.
- **8.4 Expanded study and queue editing.** `ExpandedAudioStudy` lazily loads the existing recording transcript/extracts/flashcards components with the existing 200-segment bound; recording sources only, in-memory reading position passed to seek. The expanded player adds bounded queue editing (up/down/remove via `updateQueue`, active item not removable) using projected titles, plus localized labels in all six locales. Three component tests passed (lazy study wiring/seek, queue editing, recording-only affordance).
- **6.1-6.5 and 8.5 verification.** `src/components/audio/__tests__/AudioDockAndExpansion.test.tsx` (4 tests) covers measured dock height/fallback art/skip variants/lazy expansion, mobile keyboard/modal/anchor compensation, Back/Escape collapse/focus restore, and localization/slider semantics/tick suppression. `src/visual/audio-player.visual.spec.ts` passed 17/17 in a rerun except one cold-start timeout at 412 px that passed immediately when rerun alone; geometry covers 1280x720 and 1366x768 at 100/125/150%, 768/1024 tablets and 320/360/390/412 phones, contrast, reduced motion, lazy module and queue. `cargo test media_control` passed 3/3 (already present). The one intermittent visual timeout is recorded rather than presented as a product pass.
- **Current gates.** Focused audio suites: 168/168 tests across 28 files. Full `tsc --noEmit` passed. `cargo check` passed with pre-existing dead-code warnings. Android `:plethora-android-tts:testDebugUnitTest --tests PlaybackCoordinatorTest` passed 15/15. These are local automated results; no packaged desktop, audible-continuity, physical Android, Windows/macOS or performance baseline claim follows.

Remaining unchecked tasks: 1.2/1.3 baseline/runtime capture, 4.7 device/emulator reconnect acceptance, 7.1 full-shell journeys, 7.2 packaged Linux continuity/performance, 7.3 physical Android matrix, 8.6 physical Windows/macOS/Linux adapter matrix, 8.7 documentation/final acceptance gates. Native DSP (ExoPlayer silence/gain processing) is reported unsupported by the Android capability flags, so those controls stay disabled there until device parity is accepted.

## Local gate run 2026-10-24 (task 7.4 evidence, partial)

Run after the P1 parity work on Linux Wayland:

- `npm run build:check` — PASS: docs validation, typecheck, production build, bundle budget (entry 5 KB, one PDF worker, total 26.9 MB). Existing large-chunk warnings remain.
- `npm run bench:check` — PASS: 67 benchmark comparisons and bundle budget. Six stale-baseline warnings are unchanged; no perf/bundle baseline was edited.
- `npm run test:scripts` — 235/239 passed. The same four platform-specific failures as the 2026-10-23 baseline (missing macOS `plutil`, dist target assertion, marketing screenshot attribution, macOS RAM probe on Linux). `git diff --name-only -- scripts` is empty.
- `npm run bench:memory:check` — FAILED in this environment: `memory benchmark failed: phase "one-doc": app did not pick up step 5 within 120000ms`. This is an automation/environment failure, not a measured budget failure; it is recorded as unresolved and is not presented as a pass. Raw log: `/tmp/plethora-memory-gate.log`.
- `openspec validate ... --strict --no-interactive` — PASS.
- Focused tests, `tsc --noEmit`, `cargo check`, and the Android coordinator test are recorded in the P1 checkpoint above.

Task 7.4 is therefore **not** marked complete. Tasks 1.2/1.3, 4.7, 7.1-7.3, 8.6 and 8.7 remain unchecked for hardware, packaged-runtime, full-shell-journey, memory-automation and final-acceptance reasons.
