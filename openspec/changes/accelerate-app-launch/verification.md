# Launch evidence

## Linux baseline

The host was Omarchy 4.5.0 on Arch Linux with a Ryzen 9 5900X and WebKitGTK
2.54.1. The display was a private 1440 × 960 Xvfb X11 session at scale 1
with compatibility graphics and the launch animation on. Profiles used the
same migrated database with 1,000 documents and 5,000 learning items.
The usual installed desktop entry uses Hyprland/Wayland and NVIDIA hardware
graphics with shared-memory composition. These diagnostic runs cover the
AppImage and its runtime without reproducing that display configuration.

The locally installed `/opt/plethora/Plethora.AppImage` had SHA-256
`05e9e204289898513b15bf598e503af7f3afaff730a09c1929d6e8618b2f1e37`.
The published v3.9.0 AppImage had SHA-256
`a86884e54c516c3278c94192c2e2f4e5d33f41d3cb6a9d574c0217ec1a445d04`,
matching the release asset digest. The installed artifact was preserved.

| Artifact and launch | GStreamer staging | Native entry | Native setup starts | Verified shell | Verified local |
| --- | --- | ---: | ---: | ---: | ---: |
| Locally installed AppImage, FUSE | Fresh | 252 ms | 15,008 ms | 23,291 ms | 24,540 ms |
| Same local artifact, pre-extracted AppRun | Fresh | 151 ms | 14,763 ms | Probe failed | Probe failed |
| Published v3.9.0 AppImage, FUSE | Fresh | 153 ms | 3,261 ms | 11,002 ms | 12,132 ms |
| Published v3.9.0 AppImage, FUSE | Reused | 96 ms | 2,799 ms | 6,118 ms | 7,348 ms |
| Same published artifact, pre-extracted AppRun, offline diagnostic | Fresh | 76 ms | 2,964 ms | 10,204 ms | 11,381 ms |
| Same published artifact, pre-extracted AppRun, offline diagnostic | Reused | 81 ms | 2,778 ms | 6,300 ms | 7,527 ms |

The online extracted published control retained native setup at 3,008 and
2,760 ms. Both foreground probes failed and remain in the raw report. The
explicit AppImage extract-and-run fallback recorded native entry at 3,371 ms
on its first attempt, with an incomplete input result. The second attempt
failed preflight. Pre-extracted measurements supplied the original asset's
`APPDIR` and `APPIMAGE` equivalents, with extraction outside the timer.

A 1,250 ms delay injected before the published AppImage reported native
entry at 1,519 ms. A separate X11 cover kept the startup trace visible to the
observer while the shell probe failed. Endpoint timing includes the OS input
response and screenshot checks. The old build also visibly presented a
covering animation after Queue content appeared and ignored tab clicks
during that period.

## Attributed interval

The similar delay on the mounted and extracted local executable led to
instrumenting Tauri before WebView creation. The first instrumented
`package-fast` FUSE launch spent 13,238 ms in `tauri::generate_context!`,
compared with 29 ms staging runtime assets and 11 ms selecting graphics.
The same build with an injected migration delay spent 12,973 ms constructing
the context and accepted a Dashboard click while its required storage was
still pending. The recorded API request markers were frontend attempts.
No snapshot handler ran before native readiness.

Tauri generates a separate remote execution context for each allowed
command and URL pattern. The capability set contained 1,005 app commands.
In a controlled run with the same package-fast Tauri URL parser, 1,005
passes over the four original literal patterns took 10,049 ms. Using one
equivalent grouped pattern took 2,824 ms. The Tauri matcher agreed across the
old allow and deny matrix, including loopback aliases, exact ports,
unsupported schemes, and non-loopback hosts. The fix groups the origins in
both launch capabilities and preserves their permission sets.

## Packaged candidate

The grouped pattern was verified through the same local `package-fast`
AppImage profile and FUSE launch path. The diagnostic candidate has SHA-256
`990027d7cf1d0b5fae72541d4f5ad74a1a9e7dec2062e3d1fcaebcbc64d6003c`.

| Sample | GStreamer staging | Tauri context | Verified shell | Verified local |
| --- | --- | ---: | ---: | ---: |
| Instrumented AppImage before grouping | Fresh | 13,238 ms | Probe failed | Probe failed |
| After grouping | Fresh | 3,829 ms | 10,845 ms | 12,654 ms |
| After grouping | Reused | 3,732 ms | 6,846 ms | 8,909 ms |

With a fresh cache, the measured context interval fell by 9,409 ms (71%).
The candidate also contains shared startup changes. The context figures
measure the same native phase and do not extrapolate an end-to-end speedup
to production builds. Graphics selection and GStreamer staging were left
alone. The raw launch attempts are in [linux-launch-evidence.json](linux-launch-evidence.json).

## Storage and recovery

An injected 22-second storage delay reproduced the recovery path in a
diagnostic FUSE build. WebKit's packaged content policy blocked the inline
styles used by the first recovery control. The native dialog reliably
appeared above the app, and the independent WebKit console recorded the
timeout 15,020 ms into frontend bootstrap. A keyboard Enter activated the
visible Reload Plethora button. The app started a new frontend attempt,
finished the original native migration once, and showed a populated Queue
with 50 preview rows. Native sync initialization followed local paint once.
The same dialog and keyboard reload passed a Chromium test with an explicit
policy that blocked inline styles and a missing main module.

The delayed native comparison exercised Dashboard navigation before
migrations released the backend gate. Repeated frontend attempts were
initially queuing snapshots behind that gate. The request watchdog now waits
for storage readiness. The focused coordinator tests verify one snapshot
dispatch and one hydration after a delay, and reject late results from
superseded requests, queue modes, and collections.

After the snapshot gate change and tour deferral, a further FUSE launch
verified shell input at 7,592 ms and the populated Queue at 8,975 ms.
In that build a separate diagnostic launch reached HTML while the main
module stalled. The static fallback displayed the native recovery dialog,
and Enter reloaded into a populated Queue without a second native migration.
An X11 keyboard navigation test switched from Queue to Dashboard, then
reopened a running AppImage and found one window, one frontend bootstrap,
and one native sync scheduler. Focused animation tests cover enabled,
disabled, reduced-motion, and e-ink behavior.

A separate FUSE launch passed a Markdown file on the normal command line
while backend readiness was delayed 6.5 seconds. The isolated database
received one imported document after native readiness. The supported
deep-link and mobile share paths still need direct verification.

## Browser offline diagnostic

Chromium 155 loaded the local production PWA build on a disposable origin.
Before the service worker change, both optional API requests returned HTTP 500
and cache installation did not complete. After removing them from the install
step, the cached app loaded offline. One deferred cleanup chunk was absent
from the warmed cache and its rejected import had covered the Queue. Handling
that failure kept the local UI usable.

With an isolated empty library, fresh assets reached a visible Queue after an
actual navigation click in 1,179 ms. A warm offline navigation received its
document from the service worker, displayed the confirmed-empty Queue, and
responded to an Inspector toggle in 913 ms. These browser-navigation
measurements leave the installed PWA process-cold matrix pending.

## Local checks

- 59 focused Vitest tests passed, including the startup coordinator,
  input presentation, timeout, idle fallback, and local Queue checks.
- Eight launch checker and Android fixture identity script tests passed.
- The native Tauri origin equivalence test and bundle budget passed.
- `npm run bench:check` passed on the isolated rerun with 76 benchmarks.
  Two microbenchmarks exceeded tolerance during the earlier concurrent run.
  Benchmark baselines were preserved.
- `npm run test:scripts` reported 245 passed and two marketing failures.
  One expects a legacy native import archive comparison. The other reports
  unattributed showcase screenshots.
- Full type checking reported four errors in study-plan test fixtures.
- The separate startup static-frame and brand inventory checks each surfaced
  a test expectation already inconsistent with HEAD. The former expects a
  literal boot color and the latter expects a numeric-only cache suffix.

## Pending release evidence

The isolated X11 runs are diagnostics. The qualifying 20-sample release
matrix remains pending for the normal Wayland AppImage, installed Linux,
macOS, Windows, physical Android and Boox, physical iOS, and the installed
production PWA. No Android device was attached to this host. The installed
PWA fresh-asset comparison, platform-specific launch adapters beyond Linux,
and the full external-open, offline, reduced-motion, and resume matrix
remain pending until recorded below.
