## ADDED Requirements

### Requirement: Single authoritative graphics policy

Linux graphics environment configuration SHALL be decided by exactly one policy module applied in `main()` before the WebKit view is created, and no launch path (dev or packaged) SHALL unconditionally disable WebKitGTK hardware acceleration, compositing, or the DMABUF renderer ahead of that policy.

#### Scenario: Healthy GPU keeps acceleration
- **WHEN** Plethora starts on Linux where the detected GL renderer is a hardware driver (AMD, Intel, non-software Mesa, or NVIDIA outside the X11 DMABUF case) in `auto` mode
- **THEN** no `WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE` or `WEBKIT_DISABLE_HARDWARE_ACCELERATION` variable is set by Plethora and the policy logs `backend=hardware`

#### Scenario: Software rasterizer falls back
- **WHEN** the GL renderer string contains `llvmpipe`, `softpipe` or `swrast`
- **THEN** the compatibility variable set is applied and the policy logs `backend=compatibility reason=software-renderer`

#### Scenario: Dev and packaged builds share the policy
- **WHEN** a developer runs the Tauri dev wrapper on a healthy-GPU Linux machine
- **THEN** the same conditional policy applies and the wrapper has not pre-disabled acceleration

### Requirement: Detection without glxinfo

The policy SHALL NOT conclude "software" merely because `glxinfo` is missing; it SHALL fall back to scanning `/sys/class/drm` for a real GPU device and MAY conclude compatibility only when no real GPU device is found.

#### Scenario: No mesa-utils installed
- **WHEN** `glxinfo` is absent but `/sys/class/drm` lists a non-VGEM card from a known GPU vendor
- **THEN** hardware acceleration stays enabled with `reason=dri-device-present`

#### Scenario: No GPU device nodes
- **WHEN** neither `glxinfo` nor any real DRI device is available
- **THEN** the compatibility fallback applies with `reason=no-gpu-detected`

### Requirement: NVIDIA X11 DMABUF mitigation

In `auto` mode, an NVIDIA renderer string under an X11 session SHALL disable only the DMABUF renderer while keeping hardware acceleration and compositing enabled.

#### Scenario: NVIDIA on X11
- **WHEN** the renderer string names NVIDIA and `XDG_SESSION_TYPE=x11`
- **THEN** `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set, compositing and hardware acceleration stay enabled, and the policy logs `backend=hardware reason=nvidia-x11-dmabuf`

### Requirement: Explicit override

The policy SHALL honor `PLETHORA_GPU_MODE` with values `auto` (default), `hardware` (never disable acceleration) and `software` (always compatibility), overriding detection, and SHALL log the override.

#### Scenario: Forced hardware
- **WHEN** `PLETHORA_GPU_MODE=hardware` on a software-rendering machine
- **THEN** no disabling variables are set and `backend=hardware reason=override-hardware` is logged

#### Scenario: Forced software
- **WHEN** `PLETHORA_GPU_MODE=software`
- **THEN** the full compatibility set is applied regardless of detection

### Requirement: YouTube and media constraints preserved

The sandbox disable and GStreamer configuration SHALL remain independent of the graphics policy: `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` SHALL be set unconditionally on Linux, and the APPDIR GStreamer plugin path behavior SHALL be unchanged.

#### Scenario: Sandbox unaffected by GPU mode
- **WHEN** any GPU mode is active
- **THEN** the sandbox disable is present and YouTube iframe playback prerequisites are intact

### Requirement: Diagnostics and log hygiene

The policy SHALL emit at most a small fixed number of `[graphics] …` lines per startup (exactly one decision line in the common case) via the early startup log, including backend and reason.

#### Scenario: Single decision line
- **WHEN** Plethora starts normally on Linux
- **THEN** exactly one `[graphics] backend=… reason=…` line is appended to the startup log

### Requirement: Wrapper regression protection

Repository tests SHALL fail if a shell wrapper or launcher reintroduces unconditional WebKitGTK acceleration-disabling exports or unconditionally forces `LIBGL_ALWAYS_SOFTWARE=1`.

#### Scenario: Blanket disable reintroduced
- **WHEN** a wrapper gains an unconditional `export WEBKIT_DISABLE_HARDWARE_ACCELERATION=1`
- **THEN** `npm run test:scripts` fails

### Requirement: Dead launcher removal

The unreferenced blanket-disabling launchers (`src-tauri/AppRun`, `src-tauri/dev-wrapper.sh`) SHALL be removed so only the authoritative policy configures WebKitGTK.

#### Scenario: No orphan launchers remain
- **WHEN** the repository is searched for files exporting the disabling trio outside the policy module and its tests
- **THEN** none are found
