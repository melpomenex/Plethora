## Why

Android system Back currently reaches Tauri's WebView/default Activity handling instead of Plethora's workspace coordinator, so a user can leave the app with valid in-app destinations remaining. Repeated application Back also stalls because its unique tab-residency history does not advance, and a mounted, hidden Settings tab can consume another screen's Back.

## What Changes

- Connect gesture-navigation and three-button Back to one lifecycle-owned AndroidX callback and a minimal local Tauri plugin with request identity, explicit consumption acknowledgments, bounded failure recovery, and intentional task backgrounding at root.
- Keep `requestApplicationBack` authoritative: visible overlays → active contextual hierarchy/unsaved guard → chronological workspace history → Dashboard fallback → root result. Native code owns transport and root backgrounding, never tab policy.
- Separate chronological per-pane Back/Forward stacks from `activeTabHistory`, which remains the unique MRU/residency ledger. Repair activation, singleton reuse, Settings return, close/reopen, pane mutations, and restoration together.
- Make contextual and view-owned overlay registrations eligible only for the visible owning tab; protect asynchronous discard continuations against stale ownership and duplicate requests.
- Disable JavaScript edge Back on native Android, including fullscreen and wide tablets. Preserve browser/PWA/iOS fallback gestures, protected targets, reader state, accessibility, and explicit controls.
- Provide an optional, nonblocking, exactly-once navigation haptic completion hook using existing best-effort vibration until a native haptic service exists. No navigation sound, toast, or visual animation is added through the feedback orchestrator.

## Capabilities

### New Capabilities

- `native-mobile-back-navigation`: Android dispatch/acknowledgment, startup/lifecycle recovery, root policy, predictive cancellation, and modality parity.
- `workspace-back-history`: chronological per-pane traversal independent of residency, mutations, restoration, deep links, and external intents.
- `application-back-coordination`: overlay/context/workspace priority, ownership, guarded continuations, accessibility, cross-platform behavior, and optional haptics.

### Modified Capabilities

None of the affected capabilities is currently archived in `openspec/specs/`. The existing unarchived `mobile-edge-back-gesture` delta is amended in place to distinguish native Android OS gestures from fallback JavaScript gestures, avoiding a conflicting duplicate delta. `settings-return-navigation` already specifies the compatible hierarchy/guard behavior; this change adds history and ownership contracts without copying that requirement set. See design §12 for exact precedence and archive sequencing.

## Impact

**Existing architecture:** React 19/Zustand tabs and local Settings state inside Tauri 2.11.5; AndroidX Activity 1.10.1/AppCompat 1.7.1; Android minSdk 26 and compile/targetSdk 36. Tauri already intercepts Back but defaults to WebView URL history when its first-party listener is absent. Current DOM cancellation cannot cancel that native decision.

**Affected modules:** `tabsStore`, `applicationBack`, `contextualBack`, `overlayStack`, `TabContent`, Settings, shared modal primitives, `MobileLayoutWrapper`, `MainLayout` initialization/navigation, platform detection, optional feedback adapter; new `plethora-navigation` Rust/Kotlin plugin, native Activity wiring, scoped capabilities, Android build notes, tests. No heavyweight dependency or Tauri/AndroidX version upgrade is required by design; resolved Gradle versions and API-36 behavior must be verified during implementation.

**Goals and stories:** Dashboard → Queue → Document → Settings returns through Settings menu, Document, Queue, Dashboard; dialogs close first; cancelling a discard prompt preserves drafts and history; rapid inputs cannot mutate twice for one gesture; reading positions survive activation. Native Android phones/tablets are affected; browser/PWA/iOS retain their current URL and fallback-gesture behavior; desktop gains correct shared history/ownership only.

**Non-goals:** feature implementation in this planning task, custom predictive screen-preview animation, changing browser `popstate` policy, iOS native navigation redesign, reader page-history redesign, universal unsaved-form refactoring, native-haptics overhaul, new forward gestures, process termination.

**Risks:** built-in callback ordering, delayed IPC, asynchronous prompts, generated Activity regeneration, residency/restore regressions, and pending predecessor specs. Native device and lifecycle checks are release gates, not claims established by browser tests.

**Rollout/rollback:** land history/ownership first; ship callback plus frontend handshake atomically in an internal Android build; enable production only after the device matrix passes. A native internal switch can restore the previous host path if required, with the original Android defect explicitly acknowledged. New history serialization is additive/versioned and ignored by old binaries; no database migration. Roll back plugin/frontend wiring together; retain independently tested history and ownership fixes.

**Success:** all normative scenarios and automated gates pass, real Android edge/three-button Back performs at most one correct action, no valid destination causes automatic backgrounding, root intentionally backgrounds without killing the process, and iOS/PWA/reader interactions remain intact. Production implementation begins only in the follow-up implementation task.

## Repair addendum — reported Android APK regression (2026-10-09)

The first implementation exposed a broken Android APK path. The repair scope records the concrete causes and the corrected contract while preserving the historical planning text above:

- the generated Android build defaulted the native Back gate off while the JavaScript edge recognizer was also disabled, so Android had no active Back owner;
- JavaScript sent the ACK fields at the wrong Tauri argument level, so the native command rejected otherwise valid claims;
- synchronous mobile-plugin calls could block Activity dispatch, and the native controller mixed clock domains and lacked lifecycle/session fencing;
- native haptics used an overflowing first-submission timestamp, suppressing every initial request.

The implementation now enables the debug native path, requires an explicit release override with a preflight failure for an unreviewed default, sends the typed `{ args: ... }` ACK envelope, uses asynchronous plugin calls, fences epochs and sessions, reserves the root action until ACK/timeout, and keeps the JavaScript edge recognizer disabled on Android. Browser/PWA/iOS fallback gestures remain available. Haptic admission, recovery, diagnostics, and the developer smoke action are wired without inventing device evidence. Physical Android acceptance remains an unchecked release gate.
