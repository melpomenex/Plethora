# Implementation validation and acceptance matrix

This file prescribes checks for the future implementation. No row is marked passed by this proposal. The evidence actually obtained is in verification.md. A browser touch simulation cannot substitute for a real Android dispatcher/gesture test.

## Scenario matrix

| ID | Scenario/setup and input | Required observable result | Automated coverage | Native/platform evidence |
|---|---|---|---|---|
| B01 | Dashboard→Queue→Document→Settings; section then menu Back | Section→menu first; then Document→Queue→Dashboard, one step per settled input | store + Settings/coordinator integration | Android both modes; iOS/PWA app controls |
| B02 | Repeated Back over 4+ destinations, including A→B→A→C | Position advances; nonadjacent visits retained, no stall/loop | store model/property tests | Android both modes |
| B03 | Back after dialog opens; nested menu/popover/modal | Top visible layer only; underlying tab/history unchanged; next input during closing does not fall through | overlay + Modal UI tests | Android gesture/button + TalkBack |
| B04 | Compact Settings subsection Back | Shows Settings menu, preserving workspace stack | Settings component | Android/iOS/PWA |
| B05 | Settings dirty hierarchy/app-return/system Back | One existing discard prompt; no early history mutation/haptic | Settings + bridge | Android both modes |
| B06 | Cancel prompt through button or Back | Remains in same section; drafts/history unchanged; no pending second navigation | Settings + registry effect-gap | Android/iOS/PWA |
| B07 | Settings cached but hidden, then another view Back | Hidden handler does not consume/open prompt | TabContent + owner registry | Android including wide tablet |
| B08 | Document viewer Back | Actual prior workspace view; existing reading position retained on return | store/viewer integration | PDF/EPUB native + PWA |
| B09 | Close historical tab, close current, move/split/reopen | Prunes/skips invalid entries, replacement matches current, fresh reopen visit | store fixtures/property | native split/wide tablet |
| B10 | Back→Forward repeatedly; Back→new activation | Forward retraces in order; new branch clears only owning Forward | store | browser/desktop/native controls where exposed |
| B11 | Rapid Back, duplicate ID, dual native/touch input | At most one transition per ID/gesture; overlapping inputs dropped; later settled inputs work | coordinator + bridge fake transport | Android rapid edge/button |
| B12 | Android gesture Back from both supported edges | OS dispatch once; no JS edge listener or tab-cycling conflict | platform wrapper + native dispatcher | real gesture-mode device |
| B13 | Android three-button Back | Same policy/destinations as edge OS Back | native dispatcher instrumentation | real three-button-mode device |
| B14 | Predictive start/progress/cancel then commit | Cancel changes nothing; commit once; root-preview limitation recorded | native callback state tests | APIs 33/34 and 35/36 |
| B15 | Back before WebView/ready session | No crash/early exit/deadlock; no replay; 5s prolonged startup recovery | native fake clock + bootstrap tests | delayed-start debug build |
| B16 | Native Back while guard/dialog pending, before React registration | Cancel/block top pending layer; never second navigation or stacked prompts | coordinator + Settings UI | real Android |
| B17 | Missing listener, dispatch error, delay/lost ACK, late root | <=1500ms transaction expiry; no automatic background/replay; Retry/Stay/explicit Background usable | fake transport/native clock | debug fault injection |
| B18 | Horizontal EPUB/PDF page swipe | Content paging still works outside OS-owned edge; position not corrupted | hook/viewer UI | real readers in both Android modes + iOS |
| B19 | Queue-row horizontal swipe | Row action retained; no unintended navigation | queue UI gesture tests | Android/iOS/PWA |
| B20 | Flashcard grading swipe | Grade once; no global Back/tab cycling | review gesture tests | Android/iOS/PWA |
| B21 | Root without history (Dashboard or initial non-Dashboard) | Non-Dashboard→Dashboard without loop; exhausted Dashboard backgrounds Android task once; browser/iOS app root no-op | store/coordinator + native root | real Android resume/external launch |
| B22 | Browser/PWA/iOS navigation | Existing URL/hash behavior and protected fallback edge remain functional | Playwright/component + URL tests | installed PWA and real iOS |
| B23 | Library horizontal scroll, text selection/annotation | Retains local interactions; unsaved annotation protections remain | gesture exclusions + selection UI | Android/iOS/PWA |
| B24 | Native fullscreen, keyboard open, picker/permission Activity | Native owners retain priority; fullscreen context before workspace; main callback remains available after resume | native lifecycle + wrapper | actual Android OS surfaces |
| B25 | Background/foreground, configuration/Activity recreation, process restore | Fresh epoch; no stale action; reader/draft/prompt restoration follows existing policy | serialized history + lifecycle tests | Android device recreation/process tests |
| B26 | Cold/warm deep link/share, repeated shared document | Cold safe fallback, warm one actual visit; no import/reuse duplicate history | share/route/store tests | real incoming ACTION_VIEW/SEND |
| B27 | Root ACK races new tab/share/external intent | Obsolete root cannot background new destination | fake transport + root reservation/native intent | Android race injection |
| B28 | Haptic disabled/unsupported/throw, completed versus cancelled | Navigation unaffected; <=1 subtle completion effect; no cancel/pending/root effect | completion adapter + Settings | supported Android/iOS service if present |
| B29 | Keyboard/assistive-tech controls, overlay focus return | Localized semantic controls, visible focus, no hidden-tab focus; recovery reachable | Testing Library accessibility | TalkBack, iOS VoiceOver |
| B30 | Invalid protocol, stale epoch/ID, remote/screenshot invoke | No root authorization, replay or unsafe default exit | IPC validation/ACL + native state | release capability check |

| B31 | Podcast player→feed→feed list Back with modal/hidden tab | Shared coordinator handles local hierarchy first after overlays; hidden Podcasts cannot consume; one native producer only | Podcast owner + bridge component tests | Android gesture/button and fallback platforms |

## Automated local commands

Baseline/iteration scope:

```sh
npx vitest run src/lib/__tests__/applicationBack.test.ts src/lib/__tests__/contextualBack.test.ts src/lib/__tests__/overlayStack.test.ts src/stores/__tests__/tabsStore.test.ts src/hooks/__tests__/useEdgeSwipeBack.test.tsx src/components/settings/__tests__/SettingsPage.navigation.test.tsx src/components/mobile/__tests__/MobileLayoutWrapper.back.test.tsx
```

Broaden after implementation to owner, native adapter, feedback, registry, viewer, share-target, tab deferred-mount/render-invariant/resident-cap and saved-workspace suites. Add meaningful model-based tests with deterministic seeded operation sequences (including history bounds), not tests that merely duplicate reducer lines.

Release/local gate commands:

```sh
npm run test:run
npm run test:scripts
npm run lint
npm run build:check
npm run bench:check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/plugins/plethora-navigation/Cargo.toml
```

Use the Android-build skill/environment for actual native builds. Existing generated build scripts are materialized by Tauri build; a missing `tauri.build.gradle.kts` in a source checkout is not proof of a runtime defect. From `src-tauri/gen/android`, after generation/setup:

```sh
./gradlew :app:dependencyInsight --dependency androidx.activity --configuration debugRuntimeClasspath
./gradlew :app:dependencyInsight --dependency androidx.appcompat --configuration debugRuntimeClasspath
./gradlew :app:processDebugMainManifest
./gradlew :app:testDebugUnitTest
./gradlew :app:connectedDebugAndroidTest
```

The generated app uses flavor-specific task/configuration names on some Tauri runs; use `./gradlew :app:tasks --all` and the actual generated flavor equivalents rather than guessing successful task names. Run the plugin's matching unit/instrumented tasks if tests reside in the plugin module. Build a release/R8 APK via the existing Android packaging script, verify installation and transport reflection/permissions survive optimization. Never change production pins merely to make a test dependency install. OpenSpec checks:

```sh
openspec validate fix-native-mobile-back-navigation --strict
openspec validate fix-mobile-edge-swipe-back --strict
```

`npm run test:scripts` currently runs `scripts/__tests__/*.test.mjs` per package.json (AGENTS.md's textual `.test.ts` example is stale). Use the actual npm command. Bench gate includes noise-anchor ratio and bundle check; missing baselines are warnings, regressions fail. Existing baselines/budgets can change only for a documented intentional performance change, with the rationale recorded in the reviewable implementation record (repository commits directly to main; no PR is required). No benchmark gate is waived for the future production feature.

## Real-device requirements and evidence

Required Android coverage: at least one physical device tested in gesture and three-button modes (switching modes on the same device is acceptable), API 33/34 cancellation/commit coverage and API 35/36 coverage, plus a native wide-tablet layout. Older minSdk behavior (API 26–32) can use instrumented emulator coverage, but does not replace physical gesture/button validation. API 36 may use an emulator as additional diagnostics; if no physical API-36 device is available, label that check unverified and do not claim release acceptance for it. Capture device model, OS/API, WebView provider/version, navigation mode, APK revision/debug or release, steps and result/video/log evidence per row. Predictive previews vary by OEM; correct cancel/commit and documented preview limitation are acceptance, not a claim of platform-style screen previews.

Required non-Android evidence: actual iOS smoke/regression run with reader/Settings/gesture/draft checks, installed Android PWA and browser UI/URL regression. Existing `npm run test:ios:smoke`/`test:ios:e2e` require the repository's macOS/Xcode environment; unavailable host/hardware remains explicitly outstanding. Accessibility device tests use TalkBack/VoiceOver, large text and keyboard controls.

Fault injection must be debug-only: delay/drop request/claim/ACK, attach before/after bootstrap, call Back while Settings prompt commits, replace WebView/session, background/recreate, and inject a new external intent before root ACK. For lost ACK, account for the possible already-completed action; require no replay or automatic root exit. Do not interpret successful synthetic DOM events as OS Back verification.

## Release acceptance

All B01–B31 applicable automated rows and mandatory device/platform rows pass; no stale root actions, duplicate transitions, draft loss or gesture regressions. Required quality gates pass. Record predictive-preview limitation and rollback behavior; regenerate a disposable native project and confirm documented host edits restore behavior. Enable production switch only after evidence is reviewed. Missing device infrastructure is a release blocker, not a reason to mark tasks complete. No production implementation or deployment is authorized by completion of this proposal alone.

## Repair implementation evidence (2026-10-09)

Automated evidence collected for the repair:

- Android integration preflight and generated manifest/build checks pass.
- Haptics and navigation plugin release AAR compilation passes in the local Gradle harness.
- Haptics Robolectric controller tests pass after the visibility/lifecycle correction; focused frontend haptics, queue, and scroll suites pass (18 tests).
- The full Android debug APK build was started with the local SDK/JDK and remains subject to the final cargo/build result; no phone or emulator is connected (`adb devices -l` is empty).
- Script tests retain four unrelated pre-existing failures in iOS override/freshness/environment/updater-key fixtures; they were not changed to hide baseline noise. Typecheck and quality-delta results remain recorded as non-green baseline gates until rerun against the final diff.

The physical rows above are intentionally still unchecked. No synthetic DOM event, Robolectric result, or local APK compile is presented as proof of OS Back, haptic feel, OEM gesture behavior, or accessibility acceptance.
