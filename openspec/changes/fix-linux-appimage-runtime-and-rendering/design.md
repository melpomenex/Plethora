## Context

See `proposal.md` for motivation and the specs for observable behavior. The generated AppDir's `AppRun` contains `PYTHONHOME=%s/usr/` and a `PYTHONPATH` under `usr/share/pyshared`, while the bundled NotebookLM standard library is nested deeper under `usr/bin/notebooklm-runtime/.../python/lib/python3.12`. `main.rs` currently leaves those launcher values in the parent environment and sets `GST_REGISTRY=/dev/null`. The existing Python sanitizer is attached to selected commands, not the AppImage process before WebKit/GStreamer child processes start.

The AppRun-provided plugin path is also repeated: it contains the bundled plugin directory in `GST_PLUGIN_SYSTEM_PATH_1_0`, and startup sets the same directory in `GST_PLUGIN_PATH`. GStreamer caches plugin metadata by file path: a local `gst-inspect-1.0` probe reused the cache when the path was unchanged and rescanned the identical plugin after only its directory path changed. AppImage mount points are temporary, so a persistent registry alone does not guarantee reuse for bundled plugins.

The current target host is Omarchy/Arch on Wayland with an RTX 2060 SUPER, NVIDIA 615.78.08, WebKitGTK 2.54.1, and GStreamer 1.28.8. The worktree already contains user edits to `graphics.rs`, `main.rs`, `docs/LINUX_WEBKITGTK.md`, and unrelated Assistant files. Those edits must be preserved and reviewed in place. Existing graphics tests exercise the pure decision function but not environment application or actual rendering. The existing AppImage build script can continue packaging an old AppDir after a failed Tauri build, so artifact existence alone is not build evidence.

## Goals / Non-Goals

**Goals:**

- Correct the AppImage parent environment before WebKit, GStreamer, and other children can inherit invalid AppDir Python paths.
- Keep runtime-specific Python settings explicit at the command that selects the bundled or managed interpreter.
- Reuse GStreamer plugin metadata across AppImage launches despite ephemeral mount paths, while allowing GStreamer to invalidate changed plugins.
- Keep hardware acceleration and multimedia support, with graphics compatibility settings selected narrowly and reported accurately.
- Distinguish measured startup/idle cost and scanner work from unverified reports or lifetime-average CPU values.
- Fail closed on stale/partial AppImage packaging and report the local artifact path.

**Non-Goals:**

- Modify installed `/opt/plethora/Plethora.AppImage`, machine-wide graphics settings, kernel/driver packages, or release signing configuration.
- Change Windows, macOS, or Android window/runtime behavior.
- Bundle a second GStreamer core or remove codecs solely to silence plugin warnings without ABI evidence.
- Rewrite frontend views before profiling identifies application work as the bottleneck.

## Decisions

### Scrub only AppImage-owned Python paths at startup

Add a Linux AppImage environment initialization step at the top of `main()`, before graphics initialization, `run()`, or any operation that can create a child process. It will remove AppDir-rooted `PYTHONHOME` and `PYTHONPATH` entries from the parent environment, preserving unrelated host entries where safe. System-Python commands will continue to use the existing command-level sanitizer so venv state cannot redirect them. NotebookLM and other bundled Python commands will set their runtime-specific paths explicitly after parent sanitization. This keeps the fix at the inheritance boundary and avoids spreading unconditional `unset` operations across integrations.

### Give the AppImage plugin set a stable path and registry

The build script will write a deterministic identity for the exact bundled GStreamer plugin files. At runtime, Plethora will stage those files under a per-user XDG cache directory keyed by that identity, using a temporary directory and atomic publication so concurrent launches cannot observe a partial copy. The registry will use a persistent Plethora-specific cache path under the same XDG cache root. If staging or registry creation is unavailable, startup will use the AppDir's original plugin path and log the fallback; media playback remains available even if that launch must rescan.

Startup will deduplicate plugin search paths, remove the ephemeral AppDir plugin directory from AppRun's system path after staging, and preserve validated host plugin directories for host sinks/codecs. The GStreamer core remains the host core used by WebKitGTK. Bundle/host plugin compatibility will be checked through runtime load diagnostics and media smoke tests before changing which plugin classes are included; the current cross-version mix is a risk to measure, not a proven ABI failure.

### Separate acceleration choice from NVIDIA synchronization policy

Keep `PLETHORA_GPU_MODE` as the requested acceleration mode, but compute renderer compatibility independently. On NVIDIA, use the linked WebKitGTK runtime version and observable display backend to choose the narrowest tested setting. For WebKitGTK 2.54.1 on the target Wayland session, test the documented NVIDIA explicit-sync workaround against the shared-memory DMA-BUF transport option and the existing Skia override before selecting a default. Preserve explicit user-provided variables. `hardware` means keep hardware acceleration enabled; it does not suppress a required synchronization compatibility setting. `software` remains the explicit emergency fallback.

The `explicit-sync` diagnostic will be replaced with fields that distinguish the policy decision, inherited environment value, and observed display backend. Plethora cannot claim that synchronization was negotiated by the driver/compositor unless an API actually exposes that state. The linked WebKitGTK version getter remains the version source, not build-time package metadata.

Keep native transparency if target testing shows full repaint stability. If it does not, make the native surface opaque only in the Linux Tauri configuration and preserve in-page theme styling and transparency on other platforms. Do not treat hiding desktop bleed-through as a rendering fix if frames remain stale.

### Add measurement without permanent heavy instrumentation

Use an opt-in diagnostics mode for detailed runtime facts and repeatable external process/GPU sampling. Capture cold and warm startup separately, scanner count and duration, process CPU during interaction and a sustained idle period, resident memory, GPU utilization/memory, and frame behavior. Keep Chatterbox and other external GPU consumers fixed or record their usage in each sample. Existing high lifetime-average CPU readings do not count as idle measurements.

### Make local packaging failure and output identity explicit

Retain the existing Tauri build, NotebookLM runtime, GStreamer plugin bundle, and appimagetool steps. Capture the build status and AppDir/artifact freshness so a failed Tauri build cannot reuse an old AppDir as if it were current. Check required sidecars and essential plugin assets before packaging, validate the produced AppImage's embedded version/manifest, and emit its exact path. Continue to use the repository-local bundle output; never copy it to `/opt`.

## Risks / Trade-offs

- [Risk] Copying bundled plugins into the XDG cache costs disk space and first-launch I/O. → Key the cache by a content-derived identity, stage atomically, reuse it on warm launches, and fall back to the mounted AppDir when the cache is unavailable.
- [Risk] Host plugins may be incompatible with the runtime GStreamer core or duplicate bundled features. → Deduplicate paths, preserve load errors, inspect the target AppImage's registry/plugin versions, and run audio/video/YouTube smoke tests before narrowing the plugin set.
- [Risk] NVIDIA/WebKitGTK rendering behavior varies by display backend and driver release. → Keep policy decisions testable, use runtime-version/backend evidence, preserve explicit overrides, and report the hardware test scope without claiming upstream resolution.
- [Risk] Changing native window opacity can affect appearance. → Make any fallback Linux-only and retain app-level themes/translucency; only enable it if target rendering tests show that transparency is unstable.
- [Risk] A local build can consume substantial disk space or appear successful with stale output. → Check free space, fail on stale inputs, record timestamps and hashes, and inspect the final AppImage rather than trusting an existing path.

## Migration Plan

No user database migration is required. The first AppImage launch after this change creates the Plethora GStreamer cache and, when available, a content-keyed copy of bundled plugins under the user's XDG cache directory. Existing cache files are left untouched. If the new graphics policy causes a regression, users can use `PLETHORA_GPU_MODE=software` or explicit WebKitGTK/NVIDIA overrides for diagnosis; the AppImage remains separate from the installed application.
