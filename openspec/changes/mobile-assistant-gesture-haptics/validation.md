## Scope and evidence status

This is the validation plan for `mobile-assistant-gesture-haptics`, authored 2026-10-16 against inspected working tree `e1076add`. No application implementation, prototype, native build, runtime test or physical acceptance is claimed by this proposal. Strict OpenSpec validation is a planning check. Implementation tasks remain unchecked until executed.

Required predecessor references: `openspec/changes/native-mobile-haptics/`, `fix-mobile-edge-swipe-back/`, `fix-native-mobile-back-navigation/`, and `docs/android-native-feedback-acceptance.md`. The latter explicitly gates release on physical acceptance. Native command success, simulator output and JavaScript mocks cannot prove motor output or native gesture coexistence.

## Deterministic automated matrix

Proposed new test names are implementation targets; existing suites are named where found in the inspected tree. Use injected monotonic clocks, fake rAF/animation, fixed viewport/nav/safe inset fixtures, fake pointer capture, fake speech/native transports and fake AI providers. No network, actual mic or motor is needed for these tests.

| ID | Cases and exact assertions | Boundary / evidence target |
| --- | --- | --- |
| G1 | Contact below slop→one tap open; rejected horizontal/downward/ambiguous drag→no tap/open; secondary button ignored | New `useAssistantSheetGesture` and pure reducer suites |
| G2 | Start outside owner then cross pill; start on reader/iframe/row/scroll→zero Assistant ownership, feedback and navigation | Hook/component integration, real browser Pointer Events |
| G3 | Threshold T−1/T/T+1 at heights yielding min/formula/max T; release current position; velocity cannot bypass | Pure geometry/reducer table |
| G4 | Cross→retreat→re-cross→release; cross→retreat→release short; repeated move/render→one threshold attempt | Pure reducer + feedback spy |
| G5 | Pointercancel, lost capture, second contact, hidden owner, background, tab switch, geometry change, unmount→terminal cancel; late up/click ignored | Hook tests with deterministic lifecycle |
| G6 | Partial↔expanded, partial→closed, one-step rule, single detent, insufficient travel/no change, overscroll; content scroll/selection never resizes | Handle/controller suite |
| A1 | Drag updates transform at most once per rAF; Panel render/extraction count unchanged on moves; interrupted animation starts from current sample | Motion integration/performance instrumentation |
| A2 | Old animation completion after close/Back/reset cannot reopen; reduced motion/E-Ink immediate settle | Host/controller suite |
| V1 | Nav actual-height measurement; 48px hit areas, ≥32px edge separation, safe insets, transparent surrounding area | Geometry + browser layout test |
| V2 | Visual viewport height/offset and keyboard focus; composer visible, no duplicate padding; passive changes have no haptic | Host viewport tests |
| V3 | Phone landscape, wide-tablet transition, 200% text/localization; single detent if needed; mobile state restored | Presentation/layout suite |
| B1 | Existing eligible left-edge inward 60px and 24px start; original exclusions; body/horizontal/vertical/wrong-direction/cancel no Back | Existing `src/hooks/__tests__/useEdgeSwipeBack.test.tsx` unchanged plus host regression |
| B2 | Native Android wrapper installs no JS edge recognizer; one native attach/claim/dispatch/ACK; duplicate ACK/request no replay | Existing `nativeBackBridge.test.ts`, wrapper integration |
| B3 | Open/preview Assistant consumes one overlay Back; history untouched; repeats during exit swallowed; higher modal/menu consumes first | Existing `applicationBack.test.ts`, `overlayStack.test.ts`, new host integration |
| B4 | Every Assistant success/cancel/handle path dispatches zero navigation actions; existing native root handling unaffected | Navigation spies + existing native tests |
| H1 | Exactly one attempt per qualifying crossing; tap one activation; drag opening no activation/detent; detent only changed nonclosed user settle | New Assistant feedback integration |
| H2 | Duplicate phase IDs admitted once; 250ms threshold/tap and 120ms detent cooldown boundaries; mixed eight/sec and 60ms shared spacing | Existing `feedback/__tests__/admission.test.ts`, policy/orchestrator tests with fake time |
| H3 | Disabled/config pending/busy/unknown/unsupported/background/stale→zero perform or skipped; zero replay after recovery | Existing haptic service/native-driver fakes |
| H4 | Haptics independent of sound and quiet hours; existing intensity config passed unchanged; no toast/audio/OS event | Policy/orchestrator tests |
| H5 | Native wire unchanged, IDs opaque ≤128 chars; browser calls only in driver; no new native bypass/direct vibration | Existing bridge fixtures/native contracts + source audit |
| C1 | Two turns→close→reopen preserves draft/messages/scope; first session Chat; new reset affects only mobile key | Panel/host fake-provider tests |
| C2 | Old keys/optional fields/malformed/quota fixtures; max 200 messages; no mobile key sync publish; desktop defaults unchanged | Persistence/provider compatibility suite |
| C3 | Active pane/tab and Queue parent registration precedence; stale cleanup cannot erase a newer source; removed chip stays removed | Context registration suite |
| C4 | PDF/EPUB visible section/selection, RSS article/extract parent, canonical video status/time, missing source/general Chat | Existing resolver/Queue tests plus context adapter |
| C5 | Change source A→B in flight; response remains A; reset invalidates pending callback; hidden completion cannot reopen | Deferred fake AI executor |
| C6 | Historical local-only/excluded/deleted/unknown source, cloud switch, summaries; zero forbidden request/transmission; visible history retained | Shared privacy gate + session integration |
| C7 | Global→selection Ask→global preserves independent state; existing docked cards and actions retained | Existing `AskSheet.test.tsx` plus handoff integration |
| S1 | Native platform chooses native adapter; web secure constructor/disclosure fallback; no native failure fallback; status has no prompt/download/capture | Shared speech adapter suite |
| S2 | Draft/caret insert once, interim/final dedupe, no auto-send, no start-on-open, disabled mic recovery; typing/IME normal | Composer hook/component tests |
| S3 | Cancel/close/collapse/Back/edit/background/clear invalidates late result; 10s start/60s capture/5s finalization boundaries | Fake time/transport lifecycle tests |
| S4 | Android no service/API guard/on-device/system/locale/permission/errors, main-thread create/destroy, one owner, legacy file preference | Android JVM tests + Rust/TS wire fixtures |
| S5 | iOS mic/Speech permissions/locale/local mode, final-after-stop not stale cache, timeout/error/double stop, resource teardown and legacy purpose | Swift native tests + Rust/TS fixtures |
| X1 | Named dialog/focus trap/focus restoration, Enter/Space, controls names/targets, inert background, no forced keyboard, no frame announcements | Component accessibility + browser tests |
| X2 | Existing selection handles, refresh, list swipe, grading, PDF page/pinch and EPUB iframe interactions do not invoke | Browser integration, supplemented by mandatory devices |

For all gesture-cancel tests assert unchanged active tab/document/page/scroll offset and zero AI/mic starts. Synthetic DOM input cannot establish actual system gesture or WebView scrolling behavior; keep physical rows below mandatory.

## Expected Assistant event trace

These counts describe **attempts**, before central suppression. Admitted native output can be zero. Use one fresh opaque root ID per user sequence, phase suffixes as in design, and inspect attempts separately from orchestrator/driver results.

| Sequence | Assistant events | Final presentation |
| --- | --- | --- |
| Tap/accessible activation | `assistant.opened` once after accepted opening | Initial usable open detent |
| Contact, no activation | None | Closed |
| Short recognized drag | None | Closed |
| Cross and release above T | `assistant.invoke-armed` once, no opening/detent event | Initial usable open detent |
| Cross, reverse short, release | `assistant.invoke-armed` once, no cancel event | Closed |
| Cross, reverse, re-cross | `assistant.invoke-armed` once total | Depends on current release displacement |
| Cancel before/after crossing | Zero/one threshold respectively, no additional event | Prior stable detent |
| Handle partial→expanded or expanded→partial | `assistant.detent-settled` once on changed user settlement | Target open detent |
| Handle no change / handle close / explicit close | None | Unchanged/closed |
| Keyboard/rotation/restore | None | Adapted existing state |
| Committed Back | No Assistant event; existing `navigation.back-completed` owns feedback | Closed or preview cancelled |
| Cancelled predictive Back | None, including no Back completion | Unchanged |
| Rapid repeats/busy/unready | Normal attempt trace with suppressed admissions, no replay | Same UI semantics |

## Local implementation commands and gates

Run focused new suites and existing Back/overlay/Ask/Panel/context/feedback suites first, then `npx tsc --noEmit`, targeted ESLint, `npm run test:run`, `npm run test:scripts`, relevant native/Rust tests and native platform builds. Use the actual package/build scripts and plugin fixture tests; record any host toolchain limitation instead of declaring a pass. Check generated command permissions and nonmobile stubs. Verify native Back rollout flags and predictive manifest routing remain unchanged by this implementation.

Run `npm run bench:check` locally, including bundle budget, after implementation. New pure benchmarks use seeded inputs (`seededRandom`), void bodies and consumed results. Native IPC and frame timing require runtime traces, not fs/network/Tauri inside Vitest benchmark bodies. Baseline changes require an intentional performance rationale; do not weaken limits for a failing result. GitHub Actions is not a gate.

Compare new failures against recorded pre-feature results on the same checkout/environment. Keep the original edge tests intact; do not relax a regression test to make Assistant pass. Proposal-only validation does not require app benchmark/build execution.

## Physical-device matrix — all pending

Record for every run: date/tester, model/OEM, OS/API, WebView/app version, locale/recognizer, source revision and uncommitted diff, artifact SHA-256, build variant/R8, navigation mode and native Back flags, haptics app/system settings, intensity, sound and motion settings. For haptics record policy event/ID/admission, native constant/result/accepted, **human felt or not felt**, perceived timing and quality separately. No selected text, questions or audio in diagnostic logs.

Required classes: Android gesture-navigation phone from two distinct OEMs, one predictive-Back-capable Android version; Android three-button mode; physical haptic-capable iPhone; unavailable/unsupported motor/tablet path. Emulator/simulator tests can supplement unsupported layout/capability coverage but never replace felt haptic checks. Run permission/network speech variants where the selected recognizer actually supports them and record unsupported locale/service explicitly.

| ID | Required physical action and acceptance | Required device class | Status |
| --- | --- | --- | --- |
| D1 | Existing left/right Android Back commit once; predictive cancel causes no view/sheet/feedback change; repeat after restart | Both Android OEMs, predictive device | Pending |
| D2 | Three-button Back, IME first, OS picker/fullscreen ownership, overlay nested ordering, root background/ACK behavior unchanged | Android | Pending |
| D3 | Existing iOS left-edge fallback/exclusions and Home indicator remain usable; pill never claims either edge | iPhone | Pending |
| D4 | PDF vertical scroll/page/pinch, EPUB iframe navigation/text selection/handles, RSS scroll, Library horizontal scroll/swipe actions, refresh, flashcard/joystick | Android + iPhone | Pending |
| D5 | Pill contact/short/cross/reverse/re-cross and pointer interruptions produce exact trace; no accidental open/navigation or click after cancel | Both Android OEMs + iPhone | Pending |
| D6 | Feel one crisp threshold aligned with visible arm; successful drag opening has no redundant buzz; tap has one activation; changed open detent one cue | Both Android OEMs + iPhone | Pending |
| D7 | Subtle/standard/strong, sound-off/haptic-on, reverse settings, app haptic-off, Android system touch feedback-off, iOS OS suppression | Both Android OEMs + iPhone | Pending |
| D8 | Rapid gestures/mixed joystick/refresh activity; busy driver, background/resume/restart/rotation; no vibration backlog or stuck initialization | Both Android OEMs + iPhone | Pending |
| D9 | Keyboard show/hide, landscape/small height, safe inset, auto-hidden reader controls, explicit fullscreen exit-and-open; position unchanged | Android + iPhone | Pending |
| D10 | Native fullscreen video retains controls/Home; sheet/pill absent there; no lost playback context on return | Android + iPhone | Pending |
| D11 | Mic permission grant/deny/permanent deny, native locale installed/missing, offline local mode and system service disclosure/decline | Android + iPhone | Pending |
| D12 | Stop produces final editable transcription once at caret, no auto-send; silent/no-speech, timeout, 60s limit, cancel/Back/edit/call/background/busy | Android + iPhone | Pending |
| D13 | Gboard/iOS/installed keyboard dictation writes ordinary composer text without starting competing app recording | Android + iPhone | Pending |
| D14 | Two global turns + draft + scope survive collapse/reopen/view change; selection Ask remains isolated with working cards/actions | Android + iPhone | Pending |
| D15 | TalkBack/VoiceOver exploration/activate/focus return; tap-only, keyboard/switch, 200% text, RTL, reduced motion, haptics-off | Android + iPhone | Pending |
| D16 | No-motor/unsupported capability remains fully usable and silent, with correct status, including wide-tablet presentation | Unsupported hardware/tablet | Pending |
| D17 | Sustained drag/settle under large PDF paint, long EPUB and active video; no reader remount or main-thread AI work in movement | Both Android OEMs + iPhone | Pending |
| D18 | Installed Android release/R8 and iPhone device build exercise real speech/haptics commands and permission strings, not only debug transport mocks | Android + iPhone | Pending |

## Performance acceptance

Capture ten qualifying gestures per workload after warmup with haptics on and off, using the same device/content/build. Retain frame traces and bounded aggregate metrics without document text. Initial budgets at 60Hz: p95 gesture-related JS work ≤4ms/frame, p95 movement-to-painted transform ≤33ms, fewer than 5% frames above 33ms during gesture/settle, and no gesture-attributable main-thread task ≥50ms. Compare reader-only baseline to distinguish existing rendering stalls from new gesture work. Higher-refresh devices also get their native-rate traces recorded; do not assume 60Hz proves 120Hz fluidity.

Record threshold event-to-native submission latency (target p95 ≤50ms on tested hardware) and human judgment of arm/cue alignment. The bridge's existing TTL is an admission bound, not end-to-end physical latency proof. If repeated late/no tactile feedback or redundant buzz is observed, acceptance fails even when every request says submitted; diagnose against existing feedback acceptance tooling instead of inventing a vibration bypass. Initial constants can be tuned within the design/spec contract with updated deterministic fixtures and documented device evidence.

## Completion criteria and result ledger

All deterministic scenarios must pass or have a documented preexisting unrelated failure; new regressions block completion. Required device rows must record artifact-linked observations. No mandatory row may be marked passed through inference, a simulator or an API success code. Outstanding predecessor native Back/haptic acceptance also blocks release. If hardware/toolchains are unavailable, retain pending rows and report the specific gap; do not mark feature validation complete.

| Evidence item | Current result |
| --- | --- |
| Proposal package / strict schema validation | Passed 2026-10-16: `openspec validate mobile-assistant-gesture-haptics --strict`; status reports 4/4 planning artifacts complete. Additional authoring checks verified 6 matching capability paths, 21 requirements, 71 scenarios, 50 unchecked tasks and resolving local Markdown links. |
| Implementation and automated tests | In progress. Focused regression run: 32 files / 226 tests passed; latest host, request-epoch and feedback integration run: 3 files / 40 tests passed. TypeScript and strict OpenSpec checks pass. Full suite: 7117 passed, 9 failed, 1 skipped; all 9 failures and 3 unhandled mock errors reproduced on unchanged HEAD `8432442f`. |
| Android/iPhone builds and physical rows D1–D18 | Android native plugin tests/AAR, Rust shims and Swift compilation checked below. Full APK build in progress on external drive. Signed iPhone artifact and all physical rows remain pending. |
| Reader-load traces, bundle/benchmark gate | Vite production build and bundle budget pass (entry 5 KB, one PDF worker, total 24.5 MB). `bench:check` fails the existing command-palette recent-selection benchmark; unchanged HEAD reproduces an over-budget result. New gesture benchmark has no recorded baseline yet. Physical reader-load traces remain pending. |

## Apply run — 2026-10-16, baseline `8432442f`

Before feature edits, `npx vitest run` over `useEdgeSwipeBack`, `applicationBack`, `overlayStack`, `nativeBackBridge`, all Assistant component, shared AI Assistant, feedback and haptic suites passed **33 files / 208 tests**. Additional wrapper Back, gesture exclusions, Queue context and context utility suites passed **4 files / 20 tests**. Commands use the corresponding `src/**/__tests__` paths; logs: `/tmp/mobile-assistant-baseline.log` and `/tmp/mobile-assistant-baseline-extra.log`. Existing React act warnings were present; no failing test. Strict OpenSpec validation passed. Wrapper native-Android gating and fallback 24px origin / 60px travel were inspected unchanged. These results provide no physical acceptance.

### Mac build evidence and external-drive blocker

The user authorized the Mac Mini build host and requested building on its external drive. SSH authentication works as `mini` through the verified LAN endpoint `192.168.1.230`, using the host-key alias `100.126.62.20`. The isolated source/build copy is currently `/tmp/plethora-assistant.IgmAFN`; the user's existing checkout was not modified. Native evidence logs were copied to `/tmp/mobile-assistant-native-evidence/` on the Linux workspace host.

- Android speech plugin: isolated Gradle `testDebugUnitTest` and `assembleRelease` succeeded (13 JVM tests and release AAR). The standalone Rust shim compiled using the application's pinned dependency lock.
- Apple plugin: Rust tests passed (3 tests). Composer speech files typechecked against the actual iOS 13 SDK and Tauri module. The complete Swift package built at the application's existing iOS 14 deployment floor. The package's preexisting iOS 13 NaturalLanguage/Spotlight availability errors were not resolved by changing the repository deployment floor.
- Full Android debug APK build did **not** finish: internal storage was exhausted during Rust compilation. Only this run's disposable standalone plugin Rust target directory was removed to recover approximately 2 GiB; no installed application or user data was removed.
- `/Volumes/external` reports 432 GiB available and is owned by `mini`, but the SSH session receives `Operation not permitted` both listing it and creating `/Volumes/external/plethora-assistant-IgmAFN`. No external build directory was created and no build was restarted on internal storage after the user's external-drive request. The user was asked to enable macOS Remote Login's documented remote-user disk access setting, or provide an accessible external folder.

No APK, signed iPhone artifact, install, physical motor observation or device acceptance is claimed from these checks. Task 11.1 and rows D1–D18 remain pending.

The user enabled remote disk access and the external workspace copy completed successfully. The old isolated `/tmp` copy was removed only after a clean rsync verification and replaced by a compatibility symlink to the external directory. Android debug compilation resumed at `/Volumes/external/plethora-assistant-IgmAFN` with explicit external Cargo target/cache, Rustup, Gradle, npm and temporary directories. The build log is `build-android-debug.log` in that directory. Internal available storage increased from approximately 2 GiB to 8.1 GiB. This supersedes the access blocker above; it is not yet an APK success claim.

### Automated regression details

The nine full-suite failures reproduced on unchanged HEAD are in `src/api/__tests__/ocrCommands.test.ts`, `src/components/__tests__/Toolbar.test.tsx`, `useShareTargetDedupe.test.ts`, `iosCapabilitiesDoc.test.ts`, `audioEditionIntegration.test.ts`, and `src/components/review/__tests__/ReviewQueueView.test.tsx`; logs are `/tmp/mobile-assistant-all-tests.log` and `/tmp/mobile-assistant-failures-at-head.log`. The Share Target mock also produces the same three unhandled errors at HEAD. Script tests report 222 passes and three failures involving unavailable Linux `plutil`, marketing screenshot freshness, and the platform-dependent macOS memory fixture; these script failures are not claimed resolved.

The benchmark gate reports `commandPalette/recent-selection-3000-docs` cost 0.1975 against a 0.1924 limit. An isolated unchanged-HEAD run measured approximately 0.26935, also over the same limit. No existing baseline or budget was weakened. The new seeded pure gesture benchmark measured cost 0.1177 and currently emits a missing-baseline warning. Bundle-budget verification was run separately because the failed benchmark command short-circuits its bundled check.

### Searchable Commands mode

The user selected a searchable Commands mode alongside Chat. `MobileAssistantCommands` uses the existing `buildCommandRegistry`, `matchCommands` and `executeCommand`, including the registry's platform, source-title, saved-queue and theme inputs. Three command-mode tests pass for shared matching/execution, contextual registry inputs, no automatic search focus, keyboard execution and empty results. The host integration test confirms the mounted Chat draft survives mode changes and the command closes the sheet before action. Chat visibility is passed through the existing dictation cancellation contract, so changing mode cancels composer capture. Existing keyboard-palette code is unchanged. Tasks 12.1–12.2 are complete; physical accessibility acceptance remains pending.

### Additional deterministic evidence

The session persistence suite passes seven cases covering legacy scope records, mobile messages/draft/scope across source and hidden-presentation changes, isolated New conversation, remote/selection hydration isolation, explicit identity switches, and corrupt/quota-limited storage. The request-epoch suite passes four cases including late-result rejection, hidden completion with frozen attribution, protected historical-source blocking and provider snapshot preservation. Task 2.2 is complete; broader source/privacy integration requirements remain tracked separately.

The gesture binding suite passes 15 cases covering below-slop activation, many-frame threshold/re-cross latching, current release displacement, outside origins, rejected directions, secondary buttons/pointers, cancellation and capture loss before/after ownership, blur/pagehide/second contact, owner/geometry/availability changes, StrictMode activation, handle-only movement and unmount cleanup. Four motion cases cover rAF coalescing, bounded settlement, sampled interruption, stale completion and immediate reduced motion; host tests verify movement does not rerender Panel. The gesture, motion, registry, provenance and contract run passes 6 files / 65 tests (`/tmp/mobile-assistant-gesture.log`). Host tests additionally verify exactly one changed-detent cue and no extra opening cue after drag. This evidence completes tasks 4.2, 4.3, 5.3 and 6.2, without claiming physical timing or tactile acceptance.

A later verification found and fixed a pending-lecture permission race: a second rejected start must not release the first attempt's audio-capture lease. The new UI regression verifies a busy second start, preserved ownership, discard, a new owner and cleanup of late permission results. It passes together with nine coordinator cases; targeted ESLint and TypeScript pass. The release build was restarted with this fix, retaining compiled dependencies. The earlier installed debug APK predates this final source change. Ripwire reports the component's cumulative cyclomatic complexity rising from 12 to 16 versus HEAD; its public contract is unchanged. This structural review finding remains recorded rather than claiming a clean quality gate.

### Android release artifact handed to physical acceptance (2026-10-16)

- Source: commit `9293c66d` on `origin/main`; tracked diff sha256 `c22899a5…` and untracked-source archive match the final snapshot below byte-for-byte, so the artifact corresponds exactly to the pushed revision.
- Build: `npm run tauri -- android build --ci --target aarch64 --apk` on the Mac mini external workspace `/Volumes/external/plethora-assistant-IgmAFN`; release/R8 variant, versionName 3.3.0 / versionCode 3003000, minSdk 26 / targetSdk 36, arm64-v8a, native Back override enabled, signed with the existing Mac release configuration. Log: `build-android-release.log` in that workspace.
- Artifact: `app-universal-release.apk`, 68,901,327 bytes, sha256 `0a345bc4b10c56da61278c851bef7f2d4fd45f4e4130399d6057dfdb47c7b248` (local copy at `.test-artifacts/mobile-assistant-20261016/`, hash verified identical).
- Install: wireless `adb install -r` from the Mac succeeded over the existing install on the Pixel 9 Pro XL (data preserved; installed `lastUpdateTime` recorded on the device). The earlier debug APK is superseded by this artifact for testing.
- Device/WebView rows and physical acceptance D1–D18 remain pending observation by the user; this entry is artifact provenance only and claims no tactile, latency or accessibility result.
