## 1. Audit and implementation contract

- [x] 1.1 Refresh local HEAD, AGENTS.md, dependency pins and native Back rollout against design Context; complete when the recorded implementation revision and any changed paths/versions are added to the inventory without changing the selected architecture.
- [x] 1.2 Verify every direct vibration/legacy helper site and hook consumer in interaction-inventory.md, including aliases; complete when each site has one chosen replacement owner and an integration test location, and no unlisted bypass remains.
- [x] 1.3 Record operation IDs, success boundaries and silent behaviors for every inventory row; complete when review/reading/Queue/Library/media/search/navigation/settings rows are traceable to their normative scenarios and validation.md. Confirm no unresolved architectural questions before proceeding.

## 2. Rust/Tauri plugin foundation

- [x] 2.1 Add the first-party plethora-haptics crate, build script, shared validated camelCase models and three-command bridge contract from design Decisions 1–2; complete when Rust serialization/invalid-enum/ID/protocol tests pass against fixtures also consumed by Kotlin/Swift tests. Depends on 1.1–1.3.
- [ ] 2.2 Implement Android/iOS registration, lifecycle state and async nonblocking command wrappers with defensive desktop no-op branches; complete when shared Rust checks pass and a delayed native response does not block the application event loop. Depends on 2.1; platform linkage verified in 5.2.
- [ ] 2.3 Add mobile-only main-window capability and generated command/default permissions; complete when Android/iOS schema validation accepts canonical platform names and unauthorized/remote/secondary-webview invocation tests deny output. Depends on 2.1.

## 3. Native Android effects

- [ ] 3.1 Create SDK-36 Kotlin library/annotation integration using existing plugin conventions without new permission; complete when Gradle compiles with the application's pinned Kotlin/AGP and merged manifest comparison shows no added VIBRATE permission. Depends on 2.1.
- [ ] 3.2 Implement capability query, visible WebView delivery and API-26/30/34 mapping from design Decision 3; complete when parameterized native tests verify every effect/intensity/fallback and false/system/view-disabled result has no stronger retry. Depends on 3.1.
- [ ] 3.3 Implement main-thread delivery, session/config revision validation, bounded dedup/limits/expiry and pause/resume/destroy cleanup; complete when JUnit/instrumented tests prove duplicate, stale, expired, unsupported and inactive requests cannot output, and every command resolves once. Depends on 3.2.

## 4. Native iOS effects

- [ ] 4.1 Add matching SwiftPM package/product/target/static name, initializer and dependencies using folder-import precedent at iOS 14; complete when the plugin links without crate/library name mismatch and uses only availability-safe APIs. Depends on 2.1.
- [ ] 4.2 Implement public hardware query and cached selection/impact/notification generators on the main queue using design Decision 4; complete when native tests verify every effect/intensity style and unsupported/system-unknown responses, without creating a Core Haptics engine or browser/alert fallback. Depends on 4.1.
- [ ] 4.3 Implement configuration revisions, native dedup/limits/expiry, generator preparation and inactive teardown/resume; complete when Swift tests cover queued work, stale sessions, disabled output, fixed-intensity patterns and no busy warming/replay. Depends on 4.2.

## 5. Native application integration

- [ ] 5.1 Add Cargo path dependency/lock changes and mobile-only application registration; complete when desktop checks remain successful and generated Android/iOS projects resolve the plugin through build-script paths with no Activity/AppDelegate haptic hand edits. Depends on 2.2–2.3, 3.3, 4.3.
- [ ] 5.2 Build Android debug and release/R8 plus iOS simulator and device targets; complete when the three commands are callable from trusted main webview, permission checks pass, native class/Swift symbol survive release linking and missing-plugin behavior is verified. Depends on 5.1.

## 6. Persisted independent preferences

- [x] 6.1 Add top-level haptics category/defaults and next schema-version migration/partial merge, including wrapped/legacy settings formats; complete when fresh, legacy true/false/missing, valid explicit, malformed and same-version partial snapshots pass persistence tests without altering sound/visual settings. Depends on 1.1.
- [x] 6.2 Wire shared localized accessible enable/intensity controls into NotificationSettings and MobileSettingsPanel; complete when two-way synchronization, immediate hardware admission changes, unsupported/unknown status, keyboard/screen-reader labels, reload persistence and silent disabling are tested. Depends on 6.1.
- [x] 6.3 Update all six locale sound descriptions to sound-only copy and add intensity-style explanation/status labels; complete when locale-key coverage passes and no setting copy implies sound controls haptics or promises arbitrary motor strength. Depends on 6.2.

## 7. Frontend driver and capability service

- [ ] 7.1 Implement shared effect/types and native/browser/no-op drivers under src/lib/feedback/haptics; complete when fixture tests cover wire parity, short fallback patterns, desktop no-op, browser rejection and no native-to-browser fallback. Depends on 2.1.
- [ ] 7.2 Implement one cached startup/resume capability lifecycle and native configuration readiness, single store subscription/cleanup and one outstanding perform bound; complete when fake-driver tests cover hydration, configure races, StrictMode/remount, pause/resume and expired requests without queues or duplicated subscriptions. Depends on 7.1, 6.1–6.2.
- [ ] 7.3 Replace feedback capability's browser-only haptic detection with cached native-aware status; complete when native iOS without navigator.vibrate and wide native tablets remain capable, desktop spoofed UA stays no-op and micro events do not query notification capabilities. Depends on 7.2.

## 8. Central orchestration and sound decoupling

- [ ] 8.1 Extend existing typed events/payloads and policy contract with every eligible inventory event, independent semantic effect and priority; complete when registry coverage tests pin all events/effects, silent rows and independently allowed sound/visual/toast/OS channels. Depends on 1.3, 7.1, 6.1.
- [ ] 8.2 Add synchronous interaction admission in the existing orchestrator and route domain haptics through the same resolver before unrelated async capability work; complete when delayed notification/audio tests do not delay UI admission, null-sound-role events work and no second haptic fires after the await. Depends on 8.1, 7.3.
- [ ] 8.3 Implement stable phase/step IDs, synchronous reservations, bounded caches/session ledger and operation-result precedence; complete when concurrent duplicate tests, remount tests and final-grade/completion/streak coalescing prove at most one admitted effect for a combined outcome. Depends on 8.2.
- [ ] 8.4 Decouple haptic eligibility from both sound enable gates/volumes, visual feedback and soundHandledExternally, retaining existing attention/OS policy; complete when full settings truth-table tests prove every combination and independent background/quiet-hour behavior. Depends on 8.3.
- [ ] 8.5 Add explicit per-channel ownership/context to helper toasts and legacy hook adaptation, retaining existing audio assets/visual preference; complete when owned success/error toast plus domain action produces one haptic and unchanged permitted sound/visible action behavior, and raw toast rendering stays hardware-free. Depends on 8.4.

## 9. Migrate existing vibration delivery

- [ ] 9.1 Remove direct output from useLongPress/useSwipeGestures and carry accepted gesture identities through useSurfaceMenu/SwipeableItem; complete when moved/cancelled/protected long-press/swipe tests remain silent and trailing-click swallowing/scroll behavior is preserved. Depends on 8.5.
- [ ] 9.2 Replace useRatingJoystick legacy vibration with non-null transition events and 80 ms detent policy; complete when same-zone/null/cancel/rapid jitter/return-to-grade tests verify exact identities and request counts. Depends on 9.1.

## 10. Reviews and spaced repetition

- [ ] 10.1 Emit committed grading and explicit answer reveal from the successful owners for normal/Zen/scroll/quick mobile modes, including four/six-grade and keyboard/accessible inputs; complete when pending Arena/error returns do not claim success and scheduler arguments/results remain unchanged. Depends on 8.5, 9.2.
- [ ] 10.2 Wire actual changed Arena/MemoryHorizon choice selection, preserving silent typing/same-choice behavior; complete when child/parent ownership tests produce one eligible selection tick and accepted Arena commit uses the grading owner. Depends on 10.1.
- [ ] 10.3 Compute authoritative newly crossed session/streak/progress outcomes with stable session/day/count IDs and combined-result priority; complete when empty sessions, unchanged streak multiple, rehydration/remount and final-card-plus-milestone tests prove no replay or stacked effects. Depends on 10.1–10.2.
- [ ] 10.4 Remove competing ReviewSession/ReviewFeedback/ReviewComplete hardware emissions and delayed duplicate milestone; retain completion/celebration audio layering, inline visual UI and badges; complete when sound/visual regression tests and no-duplicate review tests pass across modes. Depends on 10.3.

## 11. Reading and annotation

- [ ] 11.1 Wire accepted explicit dictionary/context activation and changed reading-tool mode with shared selection/long-press IDs; complete when word-target refresh, native text menu, selection handle movement, scroll and cancelled gestures stay silent across PDF/EPUB/HTML/Markdown/RSS/transcript selection surfaces. Depends on 8.5, 9.1.
- [ ] 11.2 Integrate confirmed highlight/extract/cloze/vocabulary-card/annotation saves and bookmarks through existing owners with handled toast tokens; complete when one saved outcome is emitted across shared and viewer-specific paths, failed saves produce no success and edit/undo behavior remains intact. Depends on 11.1.
- [ ] 11.3 Integrate explicit significant source return and reading-mode changes while retaining silent ordinary page progression/copy/pronunciation/autosave; complete when owner tests verify no second tab/Back/context effect and existing position/selection/gesture regressions pass. Depends on 11.2; final navigation overlap is verified in 13.3.

## 12. Queue, Library and document management

- [ ] 12.1 Move Queue swipe/mark-done/postpone/suspend/undo feedback to committed queueActions/host outcomes and remove SwipeableItem pre-action pulse; complete when successful/error/cancel and parent/toast overlap tests pass with one outcome. Depends on 8.5, 9.1.
- [ ] 12.2 Integrate selection-mode/changed selection and one result for Queue/Documents bulk mutation; complete when programmatic select-all and per-item responses do not pulse, partial failure warns and total failure errors once. Depends on 12.1.
- [ ] 12.3 Add one-per-touch PullToRefresh threshold latch with end/cancel/disable/unmount reset and failure outcome; complete when many frames and retreat/re-cross request one threshold, a new gesture can rearm, success is silent and existing scroll detection remains unchanged. Depends on 8.5.
- [ ] 12.4 Add shared Library favorite/read/play-state/queue-add/subscription and document rename/move/delete/export success boundaries; complete when each relevant inventory row has a tested owner and cancellation/pending/duplicate toast feedback stays correct. Depends on 12.1–12.2.

## 13. Navigation, training and general feedback

- [ ] 13.1 Make useTrainFeedback sole committed training owner and integrate explicit foreground import/clip/download/transcription/conversion/task results; complete when RSS gesture/button parity, batch summaries, failure outcomes and silent playback/scrub/search/stream/background-progress tests pass. Depends on 8.5, 12.4.
- [ ] 13.2 Replace Back adapter's legacy sound gate with independent haptic policy while preserving complete/defer/suppress IDs, native ACK and rollout; complete when existing applicationBack/nativeBackBridge/settings navigation tests cover success once, dirty acceptance/cancel, root/blocked/pending, unsupported and delivery failure. Depends on 8.5.
- [ ] 13.3 Emit primary-tab change and meaningful sheet/destination transitions only at accepted ownership points; complete when same-tab/restore is silent and context/Back/save overlap plus tablet/fullscreen/selection/native-edge regressions pass with no recognizer or exclusion changes. Depends on 13.2, 11.1.
- [ ] 13.4 Route unowned important foreground success/warning/error/completion helper events and critical incidents through policy, preserving toast actions/live regions and silence for confirmation opening/info/progress; complete when disabled haptics, repeated incident, cross-layer duplicate and sound-on tests pass. Depends on 8.5, 13.1–13.3.

## 14. Delivery cleanup, performance and cross-platform gates

- [x] 14.1 Remove useTrainFeedback and RSSScrollMode direct/duplicate vibration, and remove hardware exports/patterns from soundService after consumers migrate; complete when alias-aware production scan leaves browser execution only in browserDriver and training sound paths remain independent. Depends on 11.2 and 13.1; do not remove compatibility exports before consumers compile.
- [ ] 14.2 Migrate every listed useHapticFeedback consumer and Toast.error legacy output; complete when no bypass remains in review, dictionary, confirmation/delete dialogs, Back or helper toasts and compatibility behavior is covered. Depends on 10–13 and 8.5.
- [ ] 14.3 Verify all global/event limits, expiry, one-native-perform bound and bounded state across every entry point; complete when deterministic mixed-event stress/race tests prove specified ceilings, no queued/replayed effects and zero bridge calls for disabled/unsupported/background/silent events. Depends on 9–13, 14.1–14.2.
- [ ] 14.4 Add seeded policy.bench.ts using seededRandom, a consumed module sink and void benchmark bodies; complete when JS admission p95 target is measured without IO/native runtime and baselines are added/updated with a reason for intentional performance change only. Depends on 14.3.
- [ ] 14.5 Run relevant frontend/native unit, component, integration and authorization tests against all 77 normative scenarios and every inventory row; complete when validation.md maps each row/scenario to a test/evidence ID and failures are resolved. Depends on 14.3–14.4.
- [ ] 14.6 Run local npm run test:run, npm run test:scripts, npm run lint, npm run build:check and npm run bench:check plus scoped Rust, Kotlin and Swift checks; complete when results are recorded, regressions resolved and any intentional performance/bundle baseline adjustment is justified per AGENTS.md. Depends on 14.5. GitHub Actions is not the acceptance gate.
- [ ] 14.7 Verify desktop Linux/macOS/Windows and mobile/desktop browser/PWA behavior using existing smoke harnesses and mocked absence/refusal/lifecycle cases; complete when existing sound/visual/UI behavior survives and no desktop/native-failed surface accidentally invokes browser haptics. Depends on 14.6.

## 15. Device validation, documentation and completion

- [ ] 15.1 Run Android physical matrix in validation.md with at least two devices/actuator classes, including SDK-30+ and SDK-34+ native mappings, settings, rapid gestures and lifecycle; supplement SDK-26–29 fallback with instrumented minimum-SDK coverage. Complete only when hardware output, suppression and independent control evidence records model/OS/WebView/build revision; missing devices leave task unchecked. Depends on 5.2, 14.6.
- [ ] 15.2 Run iPhone physical matrix including supported minimum/recent OS coverage, UIKit effect classes, fixed/style intensity, System Haptics/global vibration controls, restart/lifecycle and failure injection; verify unsupported iPad/simulator behavior separately. Complete only when physical evidence and honest system-setting limitations are recorded; simulator results alone do not pass this task. Depends on 5.2, 14.6.
- [ ] 15.3 Measure UI/haptic onset and JS overhead using validation.md procedure, and tune semantic mappings/limits only within design constraints; complete when no awaited UI dependency/noticeable lag or excessive rapid feedback remains and latency/load/method results are recorded for both platforms. Depends on 15.1–15.2.
- [ ] 15.4 Verify gesture/accessibility regressions on real devices, including native Back opt-in and existing fallback without changing its rollout, dirty confirmation, text selection, joystick, Queue/Library swipes, TalkBack/VoiceOver and fullscreen/tablet cases; complete when each mandatory matrix row has evidence and no duplicate navigation/feedback remains. Depends on 15.1–15.3.
- [ ] 15.5 Document native plugin regeneration/linking, preference migration, independent sound/haptic controls, device/system limitations and rollback in native-haptics/build guides; reconcile stale feedback/Back predecessor comments narrowly. Complete when a disposable regenerated native build resolves the plugin and docs validation plus openspec validate native-mobile-haptics --strict pass. Depends on 15.4.
- [ ] 15.6 Create an implementation verification report linking every requirement/scenario/inventory row to passing automated/device evidence and final production vibration scan; complete when all mandatory tasks pass with no deferred native iOS/Android/settings/integration gate and rollback preserves compatible stored preferences/audio/Back. Depends on 14.7, 15.5. Follow repository main-only workflow if a later user request authorizes committing/pushing; no feature branch or PR is required.
