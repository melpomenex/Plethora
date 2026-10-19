## Why

The Linux AppImage currently exposes host Python subprocesses to AppImage-specific `PYTHONHOME`/`PYTHONPATH` values that do not contain a Python standard library, and its GStreamer registry is redirected to `/dev/null`, forcing repeated plugin discovery. Separately, Linux users report incomplete repainting and lag on current NVIDIA/WebKitGTK stacks; the graphics policy needs to distinguish Plethora's configured environment from driver/compositor behavior and retain hardware acceleration where stable.

This change makes the AppImage runtime deterministic and observable, validates its media and rendering behavior on the target Wayland/NVIDIA environment, and produces a local test artifact without replacing an installed release.

## What Changes

- Establish a centralized Linux child-process environment policy that removes invalid AppImage Python variables from system subprocesses while preserving explicitly configured isolated Python runtimes.
- Replace the non-persistent GStreamer registry path with a writable, user-scoped cache and verify scanner reuse, plugin discovery, and media support across launches.
- Refine the Linux graphics policy for WebKitGTK/NVIDIA combinations, including override precedence, transparency behavior, and diagnostics that report configured policy without claiming the driver negotiated a particular synchronization mode.
- Add focused regression coverage for runtime environment isolation, GStreamer cache selection, graphics decisions, and AppImage packaging integrity.
- Measure startup and idle process cost, scanner activity, frame behavior, and memory/GPU pressure; document target-hardware results and any remaining upstream limitation.
- Keep AppImage packaging reproducible on supported Linux build hosts, retain bundled sidecars/media assets and release signing behavior, and build a separate local artifact for testing.

## Capabilities

### New Capabilities
- `linux-appimage-runtime`: Isolated Python subprocess environments, persistent GStreamer registry/plugin discovery, runtime diagnostics, and verifiable Linux AppImage contents.

### Modified Capabilities
- `linux-graphics-policy`: Version-aware NVIDIA/WebKitGTK behavior, accurate policy diagnostics, and platform-specific window rendering behavior where regression evidence justifies it.

## Impact

- Rust startup and subprocess code under `src-tauri/src`, especially `main.rs`, `utils/python_env.rs`, and the TTS/NotebookLM integrations.
- `scripts/ci-build-appimage.sh`, its launcher/runtime resources, and Linux packaging validation.
- `src-tauri/src/graphics.rs`, Linux window configuration, graphics documentation, and related regression tests.
- Local AppImage build output under `src-tauri/target/release/bundle/appimage`; no installed `/opt/plethora/Plethora.AppImage` replacement.
