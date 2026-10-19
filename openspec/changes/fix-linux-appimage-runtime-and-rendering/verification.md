# Linux AppImage verification — 2026-10-19

## Scope and result

The parent Python environment, persistent GStreamer cache, graphics policy,
and local packaging changes are implemented. The AppImage starts on the
target Wayland desktop and loads the existing Plethora library when launched
with the normal profile. Sustained performance and rendering validation remain
incomplete because the real-profile WebKit process caused severe memory pressure.

The target host was Omarchy/Arch, Hyprland/Wayland, an RTX 2060 SUPER with
NVIDIA 615.78.08, WebKitGTK 2.54.1, and GStreamer 1.28.8. Other desktop and GPU
applications remained running, so aggregate GPU and host memory figures are
not measurements of Plethora alone.

## Automated validation

- Focused Rust tests passed: graphics 12, Linux runtime 5, Python environment 5,
  and Pocket TTS Python environment 2.
- The graphics/packaging Node tests passed: 9 tests. These include source
  contract assertions; runtime evidence below is required in addition.
- `npm run test:scripts`: 236 passed, 3 failed. Failures were the unavailable
  `plutil` executable, marketing screenshot freshness fixtures, and a macOS
  memory expectation executed on Linux. This is not a clean suite pass.
- `npm run bench:check` passed all 60 benchmarks and the bundle budget.
  Baselines were not changed.
- Repository-wide `cargo fmt --check` failed on existing formatting differences.
  Focused formatting checks were used for the changed leaf modules; `lib.rs`
  was not recursively reformatted.
- `bash -n scripts/ci-build-appimage.sh`, `git diff --check`, and strict OpenSpec
  validation passed.
- The pre-commit structural review reported increased size/complexity in the
  packaging function and startup diagnostics, plus test-module and small
  constructor duplication findings. These are accepted review trade-offs for
  this change, not a clean structural-check result. The repository-wide output
  also includes ignored vendored sources unrelated to the Git diff.

Final commit preparation corrected cleanup of a losing concurrent plugin-cache
publisher's staging directory and extended the existing behavioral concurrency
test. The AppImage below was built before that cleanup-only correction; the
focused Linux runtime tests are the validation for the final source correction.
The final `cargo test --manifest-path src-tauri/Cargo.toml --lib
linux_runtime::tests -- --test-threads=1` rerun passed all 5 tests after rebuilding
the test binary. The changed Rust leaf modules also passed `rustfmt --check`.

## Built artifact

Command: `npm run tauri:build:linux:appimage`.

- Output: `src-tauri/target/release/bundle/appimage/Plethora_3.4.0_amd64.AppImage`
- Size: 326343160 bytes
- Timestamp: 2026-10-19 21:04:18 UTC
- SHA-256: `ce5db811938153b97baa887fee2371261de1b6381eaed8b24ce7c17a015e3bbc`
- Bundled GStreamer plugins: 18
- Plugin-set identity: `6b8eab79c407b51589d9a8dfb35bae82a29afb0408417389f495f02c6f222010`

The release build finished after approximately 94 minutes. Tauri's linuxdeploy
step failed; the script then packaged the newly produced AppDir successfully
with its appimagetool fallback and exited zero. This is a successful fallback
package, not a successful linuxdeploy invocation. The prior AppDir backup was
cleaned after packaging succeeded.

The installed `/opt/plethora/Plethora.AppImage` was not replaced. Its recorded
SHA-256 remained `b1924bbcf5361a394a049f9c81b643bd125870b1a6e704ac75beeceaab891e3c`.

## Runtime and GStreamer evidence

The built AppImage reached the webview-ready health ping on native Wayland.
The WebKit child inherited no `PYTHONHOME` or `PYTHONPATH`; its plugin path was
the hash-keyed XDG cache copy, its registry was a persistent XDG cache file,
and its system plugin path retained `/usr/lib/gstreamer-1.0`.

On this NVIDIA/Wayland/WebKitGTK combination, the child environment contained
`__NV_DISABLE_EXPLICIT_SYNC=1` and
`WEBKIT_HARDWARE_ACCELERATION_POLICY=ondemand`, with
`WEBKIT_DISABLE_DMABUF_RENDERER` unset. This proves environment selection,
not driver/compositor synchronization negotiation.

A separate `gst-inspect-1.0` loader probe used the same staged plugin directory
and host plugin paths with a fresh isolated registry. Polling the probe's child
processes every 5 ms observed one `gst-plugin-scanner` on the cold run and none
on the warm run. The cold run took 2.772 seconds and logged 271 plugin loads
(18 staged and 253 host); the warm run took 0.031 seconds and logged no plugin
loads. Both exited zero and produced/reused a 1722086-byte registry. These are
GStreamer loader timings, not complete AppImage startup timings or media
playback validation.

## Library and interaction findings

The first launch intentionally used temporary HOME/XDG directories and
therefore showed an empty test profile. A normal-profile launch used
`/home/ubuntu/.local/share/com.plethora.app/plethora.db` (about 5.9 GB), and the
Queue displayed 190 items. The app ran its normal startup migrations and
background indexer against that profile; the database was not copied or
replaced for the test.

The user reported that the interface was no longer laggy. This is recorded as
user feedback; the preceding release build and swapping were confounding load,
so the report does not establish a specific causal fix.

Normal-profile testing revealed WebKit private resident memory near 9 GB and
several additional GB swapped out. Available host RAM fell to roughly 300 MB.
The Documents view remained loading for over 30 seconds, and a second launch
reproduced memory growth while Queue was visible without opening Documents.
The test instances were closed through the window manager, releasing roughly
10 GB of available host memory. No test Plethora processes were left running.

Navigation, palette search, and fullscreen resize/restore were exercised.
The required continuous 15-minute interaction soak, audio/video/YouTube
playback, minimize/restore, transparent-versus-opaque comparison, and controlled
idle/frame measurements were not completed. Transparency remains enabled.
The exact cause of real-profile WebKit memory growth is unresolved; background
indexer logs and slow database queries are observations, not proof of its cause.

The confirmed defects are the launcher-owned Python paths, the previous
`GST_REGISTRY=/dev/null` policy, ephemeral/duplicate plugin paths, stale-AppDir
packaging risk, and diagnostics that overstated synchronization state. The
specific graphics root cause and full-library sustained performance remain
unconfirmed on this host.
