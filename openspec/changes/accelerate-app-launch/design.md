## Context

- Linux enters `linux_runtime::initialize` and graphics detection before Tauri. The AppImage can stage bundled GStreamer plugins, and graphics detection synchronously waits for `glxinfo -B`. The earlier AppImage repair measured a standalone GStreamer probe and left end-to-end launch timing open. These are leads for a matched trace of the reported delay. [Desktop entry](../../../src-tauri/src/main.rs#L28) · [Graphics probe](../../../src-tauri/src/graphics.rs#L429) · [AppImage verification](../fix-linux-appimage-runtime-and-rendering/verification.md#L66)
- Tauri setup currently waits for native initialization that includes database open, migrations, and additional service setup. The frontend then loads the main module graph and hydrates a bounded local snapshot. The browser client uses the same snapshot API with its browser backend. [Tauri setup](../../../src-tauri/src/lib.rs#L1137) · [Frontend bootstrap](../../../src/main-bootstrap.ts#L92) · [Startup API](../../../src/api/startup.ts#L63)
- The Android startup harness already distinguishes native, frontend, and visible-data phases and includes isolated fixtures and an independent trace channel. The current shared root-mounted health ping and the Android-only Rust markers have narrower coverage than the proposed launch check. [Android harness](../../../scripts/android-startup/README.md#L32) · [Root health ping](../../../src/main.tsx#L605) · [Native markers](../../../src-tauri/src/startup_trace.rs#L41)

## Goals / Non-Goals

**Goals**

- Attribute elapsed time to the launcher, native setup, WebView or browser, frontend shell, and visible local data. Measure both ready frames on the released launch path.
- Make shell readiness independent of data readiness while sharing the existing collection-scoped startup load and its limits.

**Non-Goals**

- Packaging format changes and storage or schema redesign are outside this change. The production startup path is the performance target. Developer servers and automation-only builds serve as diagnostic comparisons.

## Decisions

### Start with a matched AppImage baseline

Identify the artifact, launcher, and environment associated with the report where available. Measure the distributed AppImage from its normal entry point and compare it with the same artifact's pre-extracted `AppRun` under equivalent runtime settings. Do extraction before starting that control's timer. Observe launcher-to-native-entry, actual mount or extract mode, plugin-cache staging and scanners, graphics detection and child processes, WebKit startup, initial paint, backend readiness, and local hydration. Compare fresh and reused app and GStreamer caches in isolated profiles. Check the reported environment and a second Linux display/runtime configuration if a Linux-specific change is needed. The comparison guides the fix, and the normal AppImage run supplies the acceptance result.

If a phase dominates, isolate it with a one-variable diagnostic comparison before modifying it. A slow pre-WebView probe warrants a bounded, compatible detection path. A cache or packaging bottleneck warrants fixing that path while preserving plugin ABI, first-run construction, invalidation, updater compatibility, media behavior, and graphics override precedence. A fast packaged entry moves the investigation downstream to Tauri, WebKit, or the frontend. The earlier `gst-inspect-1.0` measurement helps pick a probe and cannot attribute the reported 15 seconds by itself.

### Give the shell and local data their own readiness signals

Use the existing lightweight bootstrap and layout where practical. Establish when the foreground shell has rendered and accepts navigation, then use the existing startup coordinator to hydrate data for the active collection and visible surface. Render loading feedback while the required service is pending. Emit the local-ready signal from the current surface's committed content or confirmed empty state after presentation releases input and a frame and input turn have elapsed. Discard stale results if the user changes surface, collection, or startup attempt. Use the two signals to locate the wait even when one phase finishes long before the other.

Move confirmed optional blockers out of Tauri setup or eager frontend imports at their owning boundary. Preserve managed-state registration for early commands, thread affinity for window and WebView APIs, and readiness gating for database work. Keep required initialization and migrations on a single native lifecycle. Share an absolute frontend recovery deadline across bootstrap import, readiness, and initial data so independent retries cannot extend the wait. Explicit retries create a new frontend generation and rejoin any still-running required native initialization.

### Schedule optional work and presentation from readiness

Start automatic integrations once per runtime after local readiness and idle scheduling. Use bounded tasks so the fallback cannot create an input stall. Keep demand-driven initialization and the existing external-open queue available while deferring unrelated work. Let branded presentation yield on the first frame with usable shell controls and retain its existing preference and reduced-motion variants. Reconcile the pending `knowledge-peck-startup-animation` lifecycle contract during implementation, especially the fast-play rule that currently permits blocking input while the remaining beats finish. Reuse the existing Android recovery and measurement work so this change and `fix-android-startup-hang` share readiness hooks and deadline semantics.

### Validate release launch behavior locally

Use a shared report format and platform-specific launch adapters. Use an external monotonic launch clock for both acceptance endpoints. Correlate native and frontend phase clocks explicitly or report them within their own timelines. Keep marker capture independent of application IPC where feasible, and verify actual platform input against each adapter's ready markers. The baseline and acceptance runs use production release settings with a fresh process for each sample. Keep harness instrumentation opt-in and check that it leaves production startup behavior intact.

Document artifact, OS, hardware, WebView or browser, display backend, fixture, cache, and connectivity for each reference configuration. Use isolated profiles with roughly 1,000 documents and 5,000 learning items, migrated through the normal path, and retain all samples. Test the released Linux AppImage and one installed native Linux package, installed macOS and Windows release builds, a physical Android reference phone and the existing Boox data-loading profile, a physical iOS reference device, and an installed production PWA profile. Use separate runs for startup animation states and unavailable configured integrations. Record fresh-profile or required-migration launches and do functional recovery checks separately from the migrated-profile timing matrix. Exercise first PWA navigation on a controlled network as a diagnostic alongside the installed offline path. Keep the existing startup-data budget and `npm run bench:check` alongside the local packaged check.

## Risks / Trade-offs

- Reference results vary across WebView, GPU, disk, and cache state → Pair baseline and candidate on the same configuration and report first-launch and steady-cache results separately.
- Moving setup can expose native state too early → Register required state before accepting dependent commands, keep the readiness gate, and fault-test failed and slow migrations.
- Faster paint can leave input blocked or first data invisible → Check platform input and confirmed data in the foreground as well as timing markers.
- Platform or device access may limit measurement → Report missing reference runs explicitly and leave those acceptance checks open until release evidence is collected.

## Migration Plan

Land the measurements first, then the smallest measured changes to each startup boundary. Use the existing database format, launcher entry points, and settings. Keep phase reporting available to verify packaged builds and isolate regressions. If a platform-specific optimization regresses startup or compatibility, revert it at the owning boundary using the matched baseline to verify recovery.
