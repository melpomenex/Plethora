## 1. Isolate Python environments

- [x] 1.1 Add an early Linux AppImage environment sanitizer that removes only AppDir-rooted Python paths before any child process can start; test removal, unrelated host path preservation, and non-AppImage behavior.
- [x] 1.2 Verify system-Python commands use the host environment while NotebookLM, Pocket TTS, and Chatterbox retain their explicitly selected runtime environment; run the focused Rust tests.

## 2. Make GStreamer discovery reusable and compatible

- [x] 2.1 Generate and validate a deterministic manifest for the bundled GStreamer plugin set; make the AppImage build fail when required media plugins or sidecars are absent.
- [x] 2.2 Stage bundled plugins atomically under a content-keyed XDG cache path, select a persistent GStreamer registry, and deduplicate AppRun/bundled/host plugin paths; add tests for cache hit, plugin-set change, read-only fallback, and concurrent launch behavior.
- [x] 2.3 Run cold and warm GStreamer discovery checks, count scanner invocations, and inspect plugin load diagnostics on the target host; record the loader-probe scope in `verification.md`.
- [ ] 2.4 Smoke-test supported audio/video/YouTube playback on the target host.

## 3. Stabilize and diagnose Linux rendering

- [x] 3.1 Refine the NVIDIA/WebKitGTK policy so display backend, runtime WebKit version, `PLETHORA_GPU_MODE`, and inherited explicit settings have tested precedence; cover AMD, Intel, software, and unknown-version cases.
- [x] 3.2 Correct graphics diagnostics to report requested/effective policy and actual environment values without claiming driver/compositor synchronization negotiation; test both automatic and inherited settings.
- [ ] 3.3 Compare transparent and opaque Linux window behavior with the same workload; keep transparency unless the target test reproduces missing/stale paints, then use a Linux-only opaque native surface while preserving in-app theme styling.

## 4. Harden and build the local AppImage

- [x] 4.1 Prevent packaging from reusing an old AppDir after a failed or incomplete Tauri build; verify required runtime resources, plugins, and manifest before appimagetool runs.
- [x] 4.2 Run `cargo fmt --check`, focused Rust tests, `npm run test:scripts`, and `npm run bench:check`; record each actual result, including formatting and script-suite failures, in `verification.md`.
- [x] 4.3 Run `npm run tauri:build:linux:appimage`, verify the new artifact timestamp/hash/version and embedded runtime contents, and confirm the script never writes to `/opt/plethora/Plethora.AppImage`.

## 5. Measure target behavior

- [ ] 5.1 Capture before/after cold and warm startup, GStreamer scan count/duration, idle and interaction CPU, process memory, GPU utilization/memory, and frame behavior with external GPU load recorded.
- [ ] 5.2 Launch the built AppImage independently with workaround variables unset; run at least 15 minutes of navigation, document scrolling, resizing, media playback, and minimize/restore, then check idle CPU and logs for Python/scanner errors.
- [x] 5.3 Report confirmed root causes separately from hypotheses, include the exact artifact and test command, and document any rendering validation that could not be completed in `verification.md`.
