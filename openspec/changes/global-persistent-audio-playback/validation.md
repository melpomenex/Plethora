# Validation and implementation acceptance

This is a plan, not a record of executed playback tests. Proposal validation is recorded in review.md. Implementation evidence must identify commit, build hash, OS/runtime/driver, device, fixtures, enabled theme/effects/zoom, command, result and limitations. Do not replace missing hardware checks with unit-test success.

## Commands supported by the repository

Run from repository root except the explicit working-directory examples. Existing script definitions were read in `package.json`; Playwright uses `src/visual` and Vite port 5199 via `playwright.config.ts`.

```bash
openspec validate global-persistent-audio-playback --type change --strict --no-interactive
npm run test:run -- src/components/viewer/__tests__/AudiobookViewer.test.tsx src/components/recording/__tests__/SessionPlayer.test.tsx src/hooks/__tests__/useRemoteMediaBridge.test.ts src/hooks/__tests__/useRemoteMediaBridge.android.test.ts
npm run test:run -- src/components/common/__tests__/ReaderTTSControls.pauseResume.test.tsx src/components/common/__tests__/ReaderTTSControls.race.test.tsx src/hooks/__tests__/useTTS.providerSwitch.test.tsx src/utils/__tests__/audioEditionPosition.test.ts src/utils/__tests__/audiobookMultipart.test.ts src/stores/__tests__/tabResidentCap.test.ts
npm run test:run
npm run lint
npm run build:check
npm run test:scripts
npm run bench:check
npm run bench:memory:check
npm run test:visual -- audiobooks-tab-layout
npm run tauri:build:android:apk
```

As new tests are authored, run `npm run test:run -- <actual-created-test-path>` and `npm run test:visual -- <actual-created-spec-filter>`; these placeholders are instructions, not existing test filenames. The proposed global navigation harness belongs under `src/visual` using the existing harness pattern, not a claimed existing E2E script. Add integration fixtures to exercise real shell/navigation, not only a standalone mini-player mock. `npm run build:check` includes typecheck/build/bundle budget and docs validation; no invented `typecheck` script is needed. Run `npm run docs:validate` explicitly when updating help/docs.

Native checks use existing Cargo/Gradle tooling (run on a host with target prerequisites):

```bash
# cwd: src-tauri
cargo test media_control
cargo test --lib

# cwd: src-tauri/gen/android
./gradlew :plethora-android-tts:testDebugUnitTest
./gradlew :plethora-android-tts:connectedDebugAndroidTest
```

The Android module name is verified in `src-tauri/gen/android/tauri.settings.gradle`; new instrumentation tests must be authored before claiming connected tests cover them. These are Gradle task invocations, not npm scripts. Plugin tests can run on configured build hosts; connected tests require emulator/device. Full Cargo/native packaging can be expensive; record actual failures and pre-existing failures without making unrelated source edits. The build command produces an APK, not evidence of install/device testing; invoke the existing android-build skill only when implementation reaches building/installing on a phone. Windows/macOS packaging scripts exist but their successful cross-platform behavior is not established by a Linux build.

## Automated acceptance matrix

| Area | Checks and observations | Environment |
| --- | --- | --- |
| Authority | One engine after duplicate initialize/StrictMode; source close/evict/queue replacement/split-pane resize retains session; paused/play commands idempotent | Vitest with injectable engine, real owner lifecycle |
| Source races | Deferred A/B/C resolves; late play promise/ended/seek and native snapshots; pause-ack failure prevents B start; rapid slider seeks; retry after stop | Vitest + Kotlin coordinator tests |
| Source mapping | Desktop local Range + m4b preparation; Android authorized file/content manifest; promoted episode ID vs document ID; recording media-path healing, transcript-only/missing/partial | Rust source-resolution fixtures + existing player/recording tests |
| Coordinates | Known/unknown durations, part boundaries/equality, >24h, seeking while paused, edition/current-section anchors, pre-cut segment coordinate mapping | Existing multipart/edition tests plus new controller tests |
| Persistence | Fake-clock 5s cadence; one writer/in-flight+latest; no paused writes; failed commit retry; crash before/after native journal import; stale epoch/sequence; transaction rollback of episode+document+journal | Vitest fake timers, Rust temporary SQLite, Kotlin AtomicFile/recovery tests |
| Reading separation | Audio Edition saves never mutate EPUB/PDF CFI/page/scroll/reading percent; reading updates never mutate edition time; active session ignores remote progress merges | Rust/TS integration fixtures |
| Focus | TTS generation revoke; reader unmount; native speech release; video/capture takeover; permanent/transient/duck/gain; user-pause/source-change before gain; noisy receiver | Vitest provider adapters + Kotlin state machine |
| OS commands | Standard command executes native once without JS; observed receipts never redispatch; distinct IDs retained; stale transport rejected; deferred study capture uses original source/part | Kotlin transport/journal + TS dispatcher integration |
| Queue | Source end once; sleep boundary before queue; missing item; current item deletion; Listen Later prefetch/auto-advance without open viewer; only prepared native continuation while JS absent | Controller and store integration tests |
| UI lifecycle | Full primary journey, podcast+EPUB/PDF, review isolation, notes/search; closing source view and resident-cap eviction; expanded player returns focus/back | Browser full-shell harness with real media fixture plus fake engine diagnostics |
| Geometry | 320/360/390/412 phones, portrait/landscape; 768/1024 tablets; 1280x720/1366x768/1440 desktop; 100/125/150% interface zoom; sidebar/split panes/nav/fullscreen/keyboard/assistant/capture strip | Playwright geometry and screenshots; Android screenshot/insets verification |
| Accessibility | Keyboard/slider semantics, no global shortcut theft, labels/focus restoration, reduced motion, text/control contrast, long title/localized labels | Testing Library + Playwright; manual NVDA/VoiceOver/TalkBack |
| Account/windows | Logout old namespace/OS clear before new account; no utility-window engine; stop failure safe; desktop close clears session | Controller tests + packaged desktop integration |
| Resource bounds | Player view dispose leaves no bridge/timer; no second decoder; 100 mount/expand cycles; bounded journal; checkpoint limits do not drop dirty records | Vitest/Kotlin counters and browser heap inspection |

## Required manual journeys

Use self-owned/generated short deterministic audio fixtures with audible markers and known positions: single MP3, AAC/m4b, supported WAV/OGG, two-part book, two-section Audio Edition with anchors, downloaded and remote podcast, consolidated recording, unknown-duration stream and corrupt/missing fixture. Keep a separate >24h metadata/coordinate fixture. Do not rely on remote public streams for continuity/performance measurements.

1. **Primary:** start audiobook -> RSS -> open article -> scroll -> highlight -> create flashcard -> EPUB/PDF -> navigate pages -> pause/resume mini player -> return to audiobook. Verify advancing original position, one decoder, no navigation-triggered source/load events and no audible route gap. Repeat with source tab closed and evicted, and with split panes.
2. **Podcast + EPUB/PDF:** play downloaded and streamed episode; annotate EPUB, chapter jump, PDF page/annotation; check reader saved position and episode position after return/relaunch.
3. **Audio + review:** play book, review/reveal/grade several cards, use player, leave review, reopen review; no card state reset or player keyboard interception.
4. **Competition:** podcast -> book -> recording -> podcast; overlap none; repeat rapid A/B/C while B's resolve is delayed; sleep at boundary wins over queue advance.
5. **TTS:** podcast -> article TTS through each available provider (generated chunk, system Web Speech, native Android); revoke during generation, navigate away, retry media. Podcast stays paused until explicit Play; no late speech chunk. Check existing text anchoring, highlights, exact resume and paid-provider consent.
6. **Errors:** delete active/queued media, revoke local permission, expire URL, disconnect network, pause during retry, go offline with a download, corrupt codec; no destructive progress reset or retry autoplay. Simulate DB failure and verify clear unsaved warning + journal recovery.

## Physical/platform matrix

| Platform | Required evidence |
| --- | --- |
| Android min-compatible API and API 33/34/35/36 as available | Unit/emulator API matrix plus physical API 35/36 release build on a normal and lower-power phone. Lock 30 minutes; switch apps; recreate activity; disconnect JS observer; seek/pause/play from notification, lock screen and wired/Bluetooth headset; switch Bluetooth outputs; call/transient/permanent focus; noisy disconnect; notification permission deny/allow; idle/task removal while playing vs paused; force-stop/relaunch paused; service reconnect without reload; native journal import; foreground start refusal. Record OEM/battery policy. No root/blanket battery exemption required. |
| Linux Wayland + X11 | Packaged WebKitGTK/GStreamer runtime, MPRIS/desktop buttons, local and streaming codecs, scrolling/selection/annotations at all zooms, minimized playback, suspend/resume paused; paint/compositor/GPU diagnostics with same graphics config. Do not modify pre-existing Linux config to make audio measurements pass. |
| Windows | Packaged WebView2 build, valid HWND/SMTC attach/detach and native-thread lifetime, media keys, seek, source switch; minimize, sleep/wake, local-file deletion locks, large-file playback and UI continuity. |
| macOS | Packaged WKWebView app, Now Playing/media keys, background/minimize, headphones, interruption/suspend/resume, rate/seek and utility windows. Validate native event-loop requirements; browser Chromium success is insufficient. |
| Browser/PWA / existing iOS | Existing browser playback, browser backend checkpoint compatibility, MediaSession feature detection, service-worker/offline paths; retain iOS compilation/provider routing. No new iOS background promise. |

Some OSes offer only a subset of system actions. Report unsupported capabilities explicitly; mandatory actions cannot be claimed complete using unsupported placeholders. Windows/macOS P1 native acceptance is a release gate for those native integrations, not evidence furnished by this proposal.

## Performance capture and thresholds

Collect measurements on baseline HEAD and implementation with identical fixture, runtime/build mode, device power/thermal state, theme/effects/zoom, window size and graphics settings. Warm up 30 seconds; take three 60-second navigation/scroll runs per condition; separately capture 10-minute idle-playing, paused and stopped states and 30-minute Android lock playback. Compare medians of repeated runs and p95 frame/interaction samples; keep raw traces/counters with device metadata. Control unrelated TTS generation/transcription/GPU workloads. Baseline may expose existing bugs; report them, never invent a passing value.

| Metric | Proposed acceptance gate / collection |
| --- | --- |
| Audible continuity | Deterministic local marker track + audio loopback/external recording and engine event log: zero duplicate output, zero unintended `load`/seek/reset and zero navigation-correlated gaps >=100ms; exclude explicitly requested pause, part transition fixture gaps and real network starvation. Logs alone cannot establish audible continuity. |
| Input/frame latency | Existing performance diagnostics + browser/native frame trace: p95 regression <= greater of 10% or 2ms of baseline, foreground command acknowledgment p95 <=100ms. Measure decoding-start latency separately; network/codec startup is not command ack. |
| Renders | React Profiler commit counters: zero RSS/reader/review/shell root renders attributable solely to playback position; mini progress <=1Hz and expanded time <=2Hz, excluding deliberate seek interaction. |
| Persistence | Instrumented commit counters: <=12 periodic checkpoint commits/minute playing plus explicit transitions; zero unchanged paused writes; transaction count, not each SQL statement, is the unit. Browser edition storage mirrors share that cadence. |
| CPU / battery | Whole process-tree CPU samples for ten-minute identical idle playback: no more than +1 percentage point on one reference CPU core desktop, +2 on Android against baseline; native background has no JS polling. Android 30-minute battery/thermal profile must show no extra persistent wake/timer beyond active playback/native checkpoint needs; compare matched runs, no fabricated precision from coarse battery percentage. |
| Memory | Same source decoder workload plus compact surface: <=20 MiB extra process-tree RSS desktop, <=32 MiB Android over baseline; after 100 view cycles retained JS heap <=5 MiB above settled post-warmup; one decoder and bounded listeners/journal. Use `npm run bench:memory:check` plus native/process samples; JS heap alone misses native Exo/WebKit buffers. |
| Layout / paint | Zero steady-playback cumulative layout shift; no transparent bleed, flicker, stale frame or full-reader repaint attributable to ticks. Allowed first dock insertion is compensated to preserve reading anchor; capture during themed/zoomed RSS/reader navigation on packaged Linux. |
| Bench/bundle | `npm run bench:check`, `npm run build:check`, `npm run test:scripts` pass; lazy expanded UI does not move into initial shell chunk. New `src/**/*.bench.ts` uses `seededRandom`, module sink, void body, no runtime/network/fs/clock-sized data. Change perf/bundle baseline only for an intentional justified change, with evidence and rationale in implementation review. |

Thresholds are proposed product acceptance gates, not measurements. A failing gate requires a scoped fix or an explicitly reviewed change to the proposal with evidence; do not silently loosen budgets. Gate scripts are local; GitHub Actions is not the repository's required performance gate.
