# Proposal verification record

Date: 2026-10-09 UTC. Investigated repository: `/home/ubuntu/Code/Plethora`, local main at `00a3831d3b2a92806f92e2144e9242f510398a00`. Initial working tree was clean. This record describes planning verification only.

## Investigation performed

Read AGENTS.md, OpenSpec config/CLI artifact instructions, actual capability inventory, prior edge/Settings/responsive/overlay/tab-focus/feedback proposals, app Back/context/overlay registries, tabs activation/history/persistence/residency, Settings local hierarchy/async Modal, cached tab visibility context, mobile shell/gesture exclusions, route/startup/share entry paths, platform/haptic service and feedback infrastructure. Followed the Android chain through MainActivity, pinned Tauri registry source, Cargo.lock, exact Wry upstream tag, Android manifest/Gradle declarations, local plugin patterns and plugin listener ACL examples.

Confirmed the feature-local Podcast first-party native listener during broader final call-site audit; design/tasks require its migration into contextual Back, preserving local hierarchy. Shared ContextMenu/mobile menu sheet have Escape/click handlers but no overlay Back registration; tasks explicitly require their integration. No native producer of DOM `plethora:system-back` was found. Full device behavior remains unverified.

Primary-source references are linked in design §2. Installed JS API supports first-party Back; locked Rust has built-in AppPlugin Back. Declared AndroidX versions and build API levels were read locally; the resolved Gradle graph and generated merged manifest have not been produced in this planning task.

## Checks actually run

- Targeted existing Vitest baseline: **7 files / 33 tests passed**, exit 0. Suites: `applicationBack`, `contextualBack`, `overlayStack`, `tabsStore`, `useEdgeSwipeBack`, `SettingsPage.navigation`, `MobileLayoutWrapper.back` (exact paths/command in validation.md).
- Baseline emitted pre-existing mocked-Tauri listener warnings (`transformCallback` unavailable) and jsdom canvas-not-implemented messages; these did not fail tests. No new application tests or code were written.
- `openspec validate fix-native-mobile-back-navigation --strict`: **passed**.
- `openspec validate fix-mobile-edge-swipe-back --strict`: **passed** after its delta was reconciled for Android OS ownership.
- `openspec status --change fix-native-mobile-back-navigation`: **4/4 planning artifacts complete** (proposal, design, specs, tasks). Implementation checkboxes remain unchecked.
- `git diff --check`: **passed**; final artifact structure/capability/scenario/task consistency also checked separately.
- `adb devices -l`: **no devices attached**. No Android native build, gesture/button reproduction, predictive preview/cancellation, or iOS device run is claimed.

Full lint/build/benchmark/Rust/native/device gates are prescribed for the implementation in validation.md, not reported as passing here. This documentation-only task did not alter executable source, dependencies, release settings or performance budgets, so those production checks were not run for the proposal.

## Artifact and change scope

Created `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, three normative capability specs, `validation.md` and this record under `openspec/changes/fix-native-mobile-back-navigation/`.

Amended the still-unarchived predecessor delta `openspec/changes/fix-mobile-edge-swipe-back/specs/mobile-edge-back-gesture/spec.md` in place to scope JavaScript edge rules to fallback platforms and distinguish Android OS Back from right-edge forward gestures. This avoids a duplicate/conflicting capability. Prior task completion claims, including its unchecked device verification, were not changed. The new design explicitly supersedes the old MRU return-source decision while retaining the existing Settings behavior contract.

Production implementation has not begun. No commit, push, branch, PR, APK build or deployment was performed. Real Android callback ordering/API-36 behavior, release IPC/R8 permissions, iOS/PWA regression and mandatory device evidence are implementation/release obligations, not proposal validation blockers. Always-on interception's full OS root-preview limitation is a deliberate documented trade-off.

## Implementation baseline

Date: 2026-10-09 UTC. Baseline revision: `00a3831d3b2a92806f92e2144e9242f510398a00` (`main`). Installed runtimes: Node.js `v26.8.1`, npm `11.19.0`, rustc `1.89.0 (29483883e 2025-08-04)`, Cargo `1.89.0 (c24e10642 2025-06-23)`. Installed `@tauri-apps/api`: `2.11.1`; locked Rust Tauri: `2.11.5`, `tauri-runtime-wry`: `2.11.4`, vendored Wry: `0.55.1`.

Ran the exact seven-suite baseline command from validation.md on this revision. Result: **7 files / 33 tests passed**, exit 0. The suites were `applicationBack`, `contextualBack`, `overlayStack`, `tabsStore`, `useEdgeSwipeBack`, `SettingsPage.navigation`, and `MobileLayoutWrapper.back`. Existing mocked-Tauri `transformCallback` warnings and jsdom canvas-not-implemented messages appeared; they did not fail tests. No new regressions were present at baseline. Android Gradle resolution/device evidence is tracked separately and has not been run as part of this frontend baseline.

Android baseline environment check: `src-tauri/gen/android` exists, but `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and `NDK_HOME` are unset; no Android SDK/platforms or Gradle installation is available on this host. `adb devices -l` reports no attached devices. Therefore the prescribed Gradle `dependencyInsight`, merged-manifest task, debug build instrumentation, gesture/button observation, and API-36 entry route could not be run. The pinned Tauri/AppPlugin and Wry callback chain is documented in design §1 from local source/lockfile evidence; resolved AndroidX versions and device evidence remain outstanding. Task 1.4 stays unchecked.

## Implementation progress

Implementation began on 2026-10-09 UTC. The change now includes bounded per-pane chronological Back/Forward state and versioned persistence; bootstrap activation; Settings owner and pending-confirmation guards; shared contextual/overlay dispatch; ContextMenu submenu dismissal; Podcast hierarchy migration; browser reader-fullscreen Back; the Android-only frontend listener/claim/ACK bridge; an in-repo Tauri plugin shim and AndroidX Activity callback; and a default-off internal Android rollout flag. The predecessor edge-swipe spec remains reconciled.

Android rollout stays disabled by default. An internal acceptance build opts in with `-PplethoraNativeBackEnabled=true`; no production release is accepted until the device matrix passes. The generated `MainActivity.kt` and `app/build.gradle.kts` edits are documented in `docs/android-build-notes.md` because `tauri android init` overwrites them.

### Implementation checks actually run

- Seven focused UI/store/bridge files: **50 tests passed**. An additional startup/residency/render set passed **55 tests**; the new native-bridge/wrapper/store set passed **29 tests**. The existing mocked-Tauri `transformCallback`, jsdom canvas, and a Settings `act(...)` warning remain non-failing test-environment output.
- `npx tsc --noEmit`: reports only the baseline repository error `src/stores/__tests__/queueAdaptiveLoad.test.ts(65,32): TS2493` (tuple type `[]` has no element at index `0`). No changed-file type errors remain.
- `npx eslint` on the changed integration files: **0 errors**; warnings are existing unused symbols in the large viewer/media/store files. The new unused Settings hook binding found in the final pass was removed.
- `cargo check --manifest-path src-tauri/Cargo.toml -p plethora-navigation` and `cargo check --manifest-path src-tauri/Cargo.toml --lib`: **passed** on the desktop host.
- `rustfmt --edition 2021` on the two new Rust plugin source files: **passed**. `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` reports pre-existing formatting differences across existing Rust files; no unrelated sources were reformatted.
- `openspec validate fix-native-mobile-back-navigation --strict`: **passed**. `openspec validate fix-mobile-edge-swipe-back --strict`: **passed**.
- `ripwire src --quality-delta`: **gating=0** after extracting the Settings Back hook and resolving measured high-materiality deltas. Remaining reported rows are minor or new-symbol observations; the bridge's catch paths intentionally prevent uncertain ACKs from replaying navigation.
- `git diff --check`: **passed** after implementation edits.
- Android Gradle/Kotlin compilation, resolved Activity/AppCompat dependency graph, merged manifest, emulator/device testing, release/R8, actual fullscreen observation, iOS/PWA acceptance, full npm gates, root-ACK race fencing, and native JUnit/instrumentation evidence remain outstanding. Tasks depending on these checks remain unchecked.

### Current overlay/context registration inventory

| Surface or context | Registration and ordering | Current note |
| --- | --- | --- |
| Modal, ConfirmDialog, MD3 Dialog, ResponsiveDialogSheet | `useDialogFocus`, priority 100, owning view or global portal | Restores focus to a visible invoker, then active pane/main fallback |
| Settings discard guard | Modal overlay priority 100; Settings context priority 20 | Duplicate inputs coalesce while confirmation is pending; stale owner/section confirmation is discarded |
| More menu, Create Extract, ContextMenu | Shared dismissal; priorities 100, 100, and 80 | ContextMenu pops a submenu before closing the surface |
| Adaptive inspector and content-header overflow | Shared dismissal; priorities 30 and 40 | View-scoped eligibility |
| Reader selection action and Dictionary peek | Shared dismissal; default priority 0 | View-scoped eligibility; broader transient-reader surface audit remains open |
| Podcast player/feed hierarchy | Context priority 30 | Podcast-local player → selected feed → feed list steps; no first-party native listener |
| Browser reader fullscreen | Context priority 10 | Browser Fullscreen API and reader-focus fallback only; native-mobile fullscreen remains OS-owned; observed device exit is outstanding |

This is an implementation inventory, not proof of full surface coverage; phase 3.6 and its representative UI/device audit remain unchecked.
