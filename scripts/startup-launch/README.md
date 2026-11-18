# Release startup checks

The timer starts immediately before the launch command. An endpoint requires a
foreground screenshot and an observed UI change after a real platform click.
Instrumented Linux builds also require the relevant frontend phase. For older
releases, `--legacy` uses the same input checks and the phases available in
the previous app logs. Legacy phase timestamps use their own wall-clock
timeline. Both acceptance endpoints always use the runner's monotonic clock.

## Linux

Use Node.js 22.13 or later, X11, Xvfb, D-Bus, xdotool, ImageMagick and
Tesseract with its English model. Run with an exclusive display and a private
D-Bus session. Port 9527 must be free in the launch network namespace. The
runner gives the app disposable HOME, XDG and temporary directories and stops
the process group it launches. Use an installed native executable for
`linux-installed` measurements, or invoke the distributed AppImage directly
for `linux-appimage`. The test uses the compatibility graphics mode in this
example. Record the flags used for each reference run.

```sh
profile="$(mktemp -d)/plethora"
node scripts/startup-launch.mjs init-linux --profile "$profile"
```

Warm this profile by running the release once with the same launcher and
isolated directories. Complete or skip the onboarding tour, wait for the
Queue, then close that instance. The
following command runs the app on the X11 display supplied by the shell.

```sh
dbus-run-session -- env HOME="$profile/home" XDG_DATA_HOME="$profile/data" \
  XDG_CONFIG_HOME="$profile/config" XDG_CACHE_HOME="$profile/cache" \
  XDG_RUNTIME_DIR="$profile/runtime" TMPDIR="$profile/tmp" GDK_BACKEND=x11 \
  /path/to/Plethora.AppImage
node scripts/startup-launch.mjs seed-linux --profile "$profile"
```

The seeder requires an empty database that the release already migrated. It
shares the Android fixture's 1,000 synthetic documents and 5,000 learning
items. Use independent copies of the stopped fixture for matched cache and
launcher comparisons. Specify fresh app and GStreamer caches separately from
steady-cache runs. Keep database state, connectivity, rendering mode, and
appearance settings matched between comparisons.

Set the initial view to Queue for the example [X11 probe](queue-probe.json).
The probe switches to Dashboard, verifies its visible header, returns to
Queue, and verifies that toggling the inspector changes the visible state
while fixture data remains on screen. Its coordinates are relative to the
window at scale 1 with the default left toolbar and a 1280 × 800 window.
Adjust the coordinates and crop for other layouts. The probe file hash is
included in the report.

Create a JSON configuration with `platform`, `mode` (`packaged` for normal
AppImage launch), `release` (true for a production-profile build),
`launcher`, `os`, `hardware`, `engine`, `display`, `cache`,
`connectivity`, `animation`, and
`fixture: { "documents": 1000, "learningItems": 5000 }`. Keep each report
to one configuration. The runner calculates the artifact SHA-256, validates
actual FUSE mounting for packaged samples, and records the configuration
identity with every attempt.

```sh
artifact=/path/to/Plethora.AppImage
GDK_SCALE=1 PLETHORA_GPU_MODE=compatibility \
  xvfb-run -a -s '-screen 0 1440x960x24' dbus-run-session -- \
  node scripts/startup-launch.mjs run-linux --profile "$profile" \
  --config config.json --probe scripts/startup-launch/queue-probe.json \
  --artifact "$artifact" --output launch-report.json -- "$artifact"
node scripts/startup-launch.mjs check --report launch-report.json
```

For an extracted comparison, run `--appimage-extract` outside the timed
command. Set `APPDIR` to the extracted root and `APPIMAGE` to the very same
package. Pass the extracted `AppRun` as the launch command and record
`mode: "extracted"`. For fault diagnosis on an instrumented Linux build,
`PLETHORA_STARTUP_MIGRATION_DELAY_MS` delays required initialization only
with tracing armed. The runner retains an unsuccessful sample and its
bounded phases even when readiness or the data endpoint times out. Raw
application console messages and OCR text are omitted from the report.

## Acceptance

The checker requires at least 20 process-cold attempts per configuration and
fails on a missing endpoint or failed attempt. It reports medians and
nearest-rank p95 for both endpoints. Linux, macOS, Windows, and the installed
PWA budgets are 1,000 ms for the shell and 2,000 ms for usable local data.
Android and iOS budgets are 1,500 ms and 3,000 ms.

The Linux launch adapter and common report checker are available. The
[Android harness](../android-startup/README.md) still collects the existing
Boox first-data evidence with the same fixture. Physical Android input and
launch-origin evidence, along with the macOS, Windows, iOS, and installed PWA
adapters, are pending for the common gate.
