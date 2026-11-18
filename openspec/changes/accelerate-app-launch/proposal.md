## Why

The Linux AppImage reportedly takes about 15 seconds to open. Plethora should respond promptly to a launch on every supported platform and show a usable local screen within a few seconds, including offline.

## What Changes

- Reproduce the AppImage delay from the normal launcher and measure where time is spent before changing the startup path. Compare the packaged launch with the same build run unpacked to isolate packaging and runtime overhead.
- Set release-build p95 targets from launch request to responsive shell and usable local screen. Target 1 and 2 seconds on desktop and the installed PWA, and 1.5 and 3 seconds on Android and iOS.
- Keep navigation responsive while required local initialization runs. Remove measured blockers from the launch path, defer optional work, and let launch presentation yield as soon as the underlying controls are usable.
- Verify cold launches on Linux, macOS, Windows, Android, iOS, and the installed PWA with a repeatable local startup check. Preserve collection restoration, database integrity and migrations, startup recovery, and queued external opens.

## Capabilities

### New Capabilities

### Modified Capabilities

- `startup-performance` gains end-to-end launch budgets, readiness and recovery behavior, and packaged-launch verification. Its deferred-work requirement is tied to local readiness so optional work cannot compete with initial data or input.

## Impact

- Linux AppImage launcher and runtime setup, Tauri/WebView initialization, the shared frontend bootstrap and launch presentation, and the PWA startup path.
- Startup diagnostics and local performance tooling, building on the existing Android harness and bounded startup-data coordinator.
