## Why

Plethora's mobile interactions currently use browser vibration rather than a native haptic driver, leaving iOS without reliable tactile feedback and Android with inconsistent pulses. Sound-gated haptics, a disconnected mobile toggle, and overlapping review feedback owners prevent users from controlling feedback consistently across the application.

## What Changes

- Make native Android and iOS haptics a mandatory application-wide capability through a first-party Tauri plugin, using semantic platform effects and safe unsupported-device behavior.
- Extend the existing feedback orchestrator with independent haptic policy and a synchronous interaction entry point; keep sound, visual, toast, OS notification, and haptic decisions independent.
- Add persisted `haptics.enabled` and `haptics.intensity` (`subtle`, `standard`, `strong`), safe migration, and connected mobile settings controls. Remove haptic claims from sound-setting descriptions.
- Replace every direct vibration call and legacy helper delivery with the centralized system. Define one feedback owner per interaction, gesture latches, bounded deduplication, and rate limits.
- Integrate grading, joystick detents, answer reveal, review/session/milestone completion, dictionary/context activation, saved highlights/extracts/bookmarks, Queue/Library mutations, refresh thresholds, primary navigation, committed Back, content training, significant task outcomes, and important errors.
- Require Android and iOS device validation, automated policy/bridge/integration tests, browser/PWA and desktop regression checks, and local performance gates before completion.

## Capabilities

### New Capabilities

- `native-haptic-delivery`: Native Android/iOS effects, scoped Tauri bridge, capability detection, browser fallback, lifecycle and failure behavior.
- `haptic-preferences`: Independent persisted enable/intensity controls, safe migration, system-setting behavior, accessible settings.
- `haptic-feedback-policy`: Central event ownership, independent channel resolution, synchronous interaction dispatch, deduplication, cooldowns and performance safeguards.
- `mobile-interaction-haptics`: Required tactile behavior across reviews, reading, annotation, Queue/Library, navigation, media/training and significant feedback.

### Modified Capabilities

None. These specifications add a tactile channel without changing existing review scheduling, extract/toast semantics, or context-menu action contracts. `feedback-orchestration` and the native Back specifications currently exist in active changes, not in `openspec/specs/`; implementation must reconcile their comments/tests with these new independent-channel requirements rather than create duplicate coordinators or duplicate base capabilities.

## Impact

- Affected platforms: native Android and iOS are required; mobile browser/PWA gets best-effort fallback; desktop haptic delivery is a no-op with existing audio/visual behavior preserved.
- Affected code: `src/lib/feedback/`, `settingsStore`, `soundService`, `useHapticFeedback`, gesture hooks, toast helpers, review modes, reading/selection/extraction, bookmarks, Queue/Library, mobile settings/navigation and the existing Back completion adapter. See [interaction inventory](interaction-inventory.md) and [design](design.md) for exact paths and ownership.
- Native additions: `src-tauri/plugins/plethora-haptics/`, path dependency and registration, mobile-only main-window capability. Reuse the pinned Tauri 2.11.5 ecosystem, Android SDK 36/minimum 26, Kotlin 2.2.21 and iOS 14 deployment target. No paid service, new Android vibration permission, application-wide redesign, or audio architecture replacement is needed.
- Risks: OEM effect differences, unsupported motors/iPads, iOS system suppression without a public preference getter, asynchronous delivery races, duplicate feedback during migration, and native Back's currently opt-in rollout. These require explicit fallbacks, one owner per operation and real-device evidence.

## Goals and Non-goals

Deliver subtle, meaningful native feedback with independent controls and no perceptible UI delay. Native haptics, persisted settings, migration of legacy delivery, comprehensive interaction integration and device validation are required in this change.

Do not rebuild Back navigation, introduce another edge gesture, change scheduling algorithms, vibrate during ordinary scrolling/typing/text-handle movement, replace existing sound assets, add background vibration alerts, or perform unrelated mobile UI refactors.

## Definition of Success

Both supported Android phones and iPhones physically deliver native haptics. Sound-off/haptics-on and sound-on/haptics-off work independently; preferences survive restart; all mobile haptic controls operate the same setting. Grading and joystick boundaries, session/milestone outcomes, saved reading actions, committed swipes, one refresh threshold and successful Back/tab transitions match the inventory without duplicate output. Unsupported hardware, system suppression, bridge failure, rapid gestures and desktop/web environments remain safe. Automated tests and recorded Android/iOS device evidence satisfy [validation](validation.md); browser mocks alone cannot establish hardware success.
