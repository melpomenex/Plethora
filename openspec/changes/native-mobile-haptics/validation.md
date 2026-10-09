# Native mobile haptics implementation validation

This is the required implementation acceptance plan. It records completed automated checks and explicitly leaves unavailable native builds and physical-device evidence outstanding.

## Evidence format and completion rule

For each run record test ID, implementation commit, build variant/debug or release, date, phone/tablet model, OS/API level, WebView/browser version where relevant, navigation mode, app haptic enabled/intensity, sound/visual settings, applicable OS controls, expected/observed output, request-count evidence and result. Preserve logs/screenshots/traces or a concise observer report for tactile feel; video alone does not prove motor output. Automated tests use deterministic IDs and fake monotonic clocks; no selected text/document content is logged.

All normative scenarios in the four spec files (77 at proposal creation), every eligible inventory row, and all mandatory matrix rows need test/evidence references in the final implementation verification report. Grouped rows may share a parameterized test but cannot hide missing platform cases. Android and iPhone physical output are mandatory. Unavailable equipment stays outstanding; do not replace it with mocked success or check off the task. Native Back's production enablement remains a separate predecessor gate.

## Automated matrix

| ID | Contract / coverage | Pass condition |
| --- | --- | --- |
| A01 | Settings all independent combinations: haptic on/off × UI sound on/off × notification sound on/off; visual/reduced-motion cases | Hardware eligibility follows only its own preference/support; sounds retain their own gates and visible outcomes remain. |
| A02 | Migration version 14→next, older wrapped/root snapshots, true/false/missing legacy sound gate, explicit/partial/malformed new values | One-time legacy opt-out preserved; defaults enabled/Subtle; no continuing coupling; same-version merge safe. |
| A03 | Both mobile settings surfaces, reset, remount/restart and accessible labels/status | Same persisted controls change admission immediately; intensity copy honest; disabling/unsupported preview silent. |
| A04 | Native classification vs viewport, iOS without browser API, desktop spoof UA | Native chosen only on authoritative mobile runtime; browser/desktop/native error fallbacks correct. |
| A05 | Cached capability query, pending/failed initialization, startup/resume, StrictMode and cleanup | No per-event notification/capability query, no duplicate subscriptions/listeners, no startup/resume replay. |
| A06 | Native model parity/protocol/ID/enum checks and trusted-window ACL | Kotlin/Swift/Rust fixtures agree; unknown/remote/secondary/desktop requests cannot output. |
| A07 | Android SDK 26/29/30/33/34/36 effect/intensity mapping and view/system refusal | Correct guarded constants, no added vibration permission, no forced or raw fallback. |
| A08 | Swift generator class/style/main-queue/cache/preparation/hardware probe | iOS-14-compatible native delivery; fixed pattern levels honest; no custom engine, alert vibration or private setting read. |
| A09 | Session/config revision races, old driver session, disabling, pause/destroy and one outstanding perform | Old/expired/pending-config/inactive requests skipped; bounded state and no replay/unhandled rejection. |
| A10 | Concurrent duplicate domain events plus helper/child/parent overlap | At most one request per operation phase; dedup reserved before awaits and shared across aliases. |
| A11 | Mixed-event stress, dedup expiry/eviction, native defensive ceilings | ≤8 effects/rolling second, ≤4 outcomes, 60/120 ms spacing plus event cooldowns; no delayed queue. |
| A12 | All review modes, four/six grades, reveal, keyboard/accessible activation and pending/failed Arena | Success only on actual commit, explicit reveal once; scheduler payload/behavior unchanged. |
| A13 | Final grade, completion, personal best/streak/progress crossing, repeated divisible streak and result remount | One prioritized effect, stable session/day/count ledger; no empty/mount/repeated milestone output; original sound layering retained. |
| A14 | Joystick many frames/same grade/dead-zone/re-entry/rapid boundary/return/cancel | Only new non-null semantic detents with ≥80 ms spacing; no stale grade commit. |
| A15 | Long-press custom context/dictionary, target refresh/native menu, movement/selection/scroll cancellation | Once after explicit accepted activation; all nonintent/duplicate surfaces silent. |
| A16 | Highlight/extract/cloze/vocabulary/annotation/bookmark on each supported viewer path | After persistence once; handled toast preserves edit/undo/live region; failure gives no success. |
| A17 | Swipe commit/error/cancel/protected target, batch/partial/total results, selection-mode/selection | One owner per accepted phase/batch, no wrapper pulse or per-item storm. |
| A18 | Refresh first crossing, thousands of moves, retreat/re-cross, cancel/disable/new gesture and failure | One threshold per lifecycle, next gesture rearmed, success silent and failure distinct once. |
| A19 | Existing applicationBack completion/defer/suppress/native ACK and primary-tab/destination/sheet overlap | Complete once only; root/pending/block/cancel/same tab/restore silent; haptic failure cannot block ACK. |
| A20 | Content training button/swipe, Library/document mutations, import/task batches and incident/helper toasts | Success at accepted boundary; one operation summary; playback/search/typing/stream/background/progress silent. |
| A21 | Mobile browser API missing/false/throwing, existing Firefox Android PWA restriction, iOS Safari, desktop | Bounded short fallback only on eligible mobile browser; never native failure fallback or desktop output. |
| A22 | Driver rejected promise, native delay, missing permission/plugin, unsupported/unknown support | Action succeeds, no feedback loops/unhandled rejection, no hardware retry; deadline drops >150 ms work. |

## Native build and authorization checks

Use existing repository build wrappers and prerequisite instructions; do not overwrite generated source or install unsolicited dependencies merely to mark a test complete. Scope mobile code checks to the new plugin initially, then build the app. Verify Kotlin JUnit/instrumented tests and release R8, Swift test target plus simulator/device builds and native main-queue confinement, Rust serialization/command tests and desktop compilation. SwiftPM tests needing Tauri's generated package must run through the generated Apple project/harness rather than assume standalone `swift test` will find `.tauri/tauri-api`.

Inspect release merged Android manifest for permission delta, generated mobile links and iOS static library/initializer symbol. Regenerate native scaffolding only in a disposable copy to prove plugin sources/permissions survive. A missing device signing setup is a recorded blocker for physical iOS acceptance, not a reason to weaken native iOS scope.

## Real-device matrix

Minimum physical coverage: two Android phones with meaningfully different hardware/OEM feedback, including one API 30–33 and one API 34+; minimum-SDK fallback also gets emulator/instrumentation coverage. At least one haptic-capable iPhone is mandatory; cover iOS 14-compatible APIs and a recent supported iOS through device testing where available and minimum-target compilation otherwise. Record which older OS cases lack physical evidence instead of implying that compilation proves feel. Validate unsupported iPad physically when available, plus deterministic hardware-unavailable and simulator tests.

| ID | Required exercise | Expected evidence |
| --- | --- | --- |
| D01 | Both Android phones: every semantic effect and all three intensity values in debug and release | Physical native output with mapped styles/fixed equivalences; native calls logged by identity/effect without raw patterns. |
| D02 | Android app toggle off/on, OS touch haptics off/on and view-disabled injection | App-off outputs zero requests; OS/view suppression has no louder fallback; saved preference remains separate. |
| D03 | iPhone: selection, impact and success/warning/error classes at all levels | Physically felt native UIKit feedback despite absent browser API; impact styles differ where supported, selection/outcome fixed. |
| D04 | iPhone System Haptics and accessibility global Vibration controls, silent/ringer mode separately | Record actual OS suppression behavior and unknown preference reporting; no claim silent mode equals app haptics-off, no private override. |
| D05 | Both platforms: haptics-on/sounds-off and haptics-off/sounds-on; restart app | Independently heard/felt behavior; preference restored before any effect; compact/full controls agree. |
| D06 | Reveal/grade normal, Zen, scroll, quick and Arena mobile review; slow persistence, error and final card | Valid transition feedback, no premature success, once-only completion/celebration and preserved scheduler/visual/audio outcomes. |
| D07 | Joystick 60–120 Hz movement, jitter at boundaries, return to dead zone, cancelled gesture | Detents only on meaningful transitions; bounded request log and comfortable feel, no cancellation grade. |
| D08 | Streak/count milestone crossings then repeated grades/remount/restart result | One newly crossed result; no repeated modulo-based vibration or replay. |
| D09 | Dictionary/custom long-press and saved highlight/extract/cloze/bookmark in PDF/EPUB/HTML/Markdown/RSS/transcript-supported paths | One activation/save owner; text selection/native handles/ordinary scroll do not gain app pulses; edit/undo intact. |
| D10 | Queue/Library swipe below threshold/cancel/commit/error, selection/bulk operations | Committed outcome once, failed/cancelled no success; partial batch warning once. |
| D11 | Pull threshold hover/retreat/re-cross/release/cancel, immediate repeat/new gesture and refresh failure | One threshold per gesture; success no second pulse, failure error once. |
| D12 | Primary tab active/same/More, source return and context sheet overlaps | One accepted navigation effect; no duplicate view/sheet/tab output. |
| D13 | Back overlays/context/history/dirty settings, native Android opt-in build and existing fallback; root, predictive cancel, IME/native picker | One effect only on completed app transition, native ACK/root/rollout behavior preserved; no new recognizer/exclusion. |
| D14 | Content training swipe/button, favorite/import batch, manual transcription/conversion/clip/download; task failure | One meaningful committed result; automatic/background/progress/playback/search/stream updates silent. |
| D15 | Disable or background during queued native work; resume/restart/device rotation/fullscreen/wide tablet | Stale/inactive work discarded, no replay, one driver subscription, native classification survives size changes. |
| D16 | TalkBack/VoiceOver/keyboard controls with animations off/reduced motion | Labels/results accessible; haptic optional and independent; focus traversal/typing silent. |
| D17 | Continuous rapid mixed actions, injected missing plugin/native refusal/delay | Shared limits, no excessive/late output, UI remains responsive and no error/toast recursion. |
| D18 | Unsupported iPad/simulator/Android no-motor capability, mobile browser/PWA and desktop | No-op/correct short fallback and truthful status; independently allowed audio/visual behavior unchanged. |

## Latency and performance measurement

Instrument test builds with compact operation ID, UI commit/threshold marker, JS admission duration, bridge dispatch, native receipt/main-thread submit and result. Compare durations within a clock domain; use an explicitly calibrated clock offset only if comparing cross-process timestamps. Use a high-speed video with an accelerometer/contact microphone or equivalent synchronized instrument for physical motor onset; a manual observer report establishes feel but cannot justify a precise p95 onset claim. Capture at least 100 interaction samples/device for a p95, specifying device load and warm/cold conditions. Avoid recording private app content.

Pass targets: synchronous JS admission p95 <1 ms, no awaited native dependency in action handlers, unloaded physical onset target p95 ≤50 ms. Investigate >100 ms onset; no >150 ms queued effect is permitted. Stress measurements confirm global/per-event ceilings and no accumulating delayed output. If precision instrumentation is unavailable, record timing evidence as limited and leave the quantitative device-measurement task open rather than invent measurements.

Add a policy-only seeded benchmark (no native API/network/FS/Tauri runtime), consume results in a module sink and return void. Run `npm run bench:check`, not just `bench`; add new baseline cost with documented reason and change existing tolerance/bundle budget only for an intentional measured change per AGENTS.md. A noise-related regression must be investigated, not solved by silently loosening baselines.

## Final local acceptance

Run `npm run test:run`, `npm run test:scripts`, `npm run lint`, `npm run build:check`, `npm run bench:check`, appropriate Rust/Kotlin/Swift checks and mobile release builds. Report unrelated existing failures with evidence; they are not passing results. Audit production `navigator.vibrate` and imported helper aliases: only the browser driver can execute browser hardware output. Run `openspec validate native-mobile-haptics --strict`. Final verification report links all automated/device cases, documents OS limitations and rollback, and leaves no mandatory feature/device gate deferred.

## Implementation validation record

On 2026-10-09, focused Vitest runs passed settingsStore, HapticsSettingsControl, feedback capabilities/orchestrator/policy (67 tests), haptics drivers (4 tests), and reviewStore (22 tests). `cargo test --manifest-path src-tauri/Cargo.toml -p plethora-haptics` passed 4 tests. `cargo check --manifest-path src-tauri/Cargo.toml` passed with existing vendored dependency warnings. `openspec validate native-mobile-haptics --strict` and `git diff --check` passed. TypeScript checking reports only the existing `src/stores/__tests__/queueAdaptiveLoad.test.ts:65` tuple error. Android Gradle tests cannot start because Java/JAVA_HOME is unavailable; Swift/Xcode tools are absent; `adb devices -l` reports no attached devices. Android/iOS native compilation, release linking, physical hardware and full normative/inventory coverage remain outstanding. Passing desktop/Rust/OpenSpec checks does not claim mobile native output is verified.
