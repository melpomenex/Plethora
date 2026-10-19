## MODIFIED Requirements

### Requirement: NVIDIA X11 DMABUF mitigation
The Linux graphics policy SHALL select NVIDIA compatibility behavior using the detected WebKitGTK runtime version and display backend where observable. It SHALL retain hardware acceleration when a compatibility environment setting is sufficient, and SHALL not apply a renderer workaround known to cause incomplete repainting on the selected WebKitGTK version.

#### Scenario: NVIDIA legacy WebKitGTK path
- **WHEN** the detected renderer is proprietary NVIDIA, the selected display path is X11, and the linked WebKitGTK version is below 2.54 or cannot be determined
- **THEN** the policy applies the narrow legacy DMA-BUF mitigation while keeping compositing and hardware acceleration enabled, unless the user supplied an explicit value for that setting

#### Scenario: NVIDIA on X11
- **WHEN** the renderer string names NVIDIA, `XDG_SESSION_TYPE=x11`, and the linked WebKitGTK version is below 2.54 or cannot be determined
- **THEN** `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set unless the user supplied a value, compositing and hardware acceleration stay enabled, and the policy logs the selected compatibility reason

#### Scenario: NVIDIA Wayland with WebKitGTK 2.54 or newer
- **WHEN** the detected renderer is proprietary NVIDIA, the observable display backend is native Wayland, and linked WebKitGTK is 2.54 or newer
- **THEN** the policy keeps the DMA-BUF renderer and hardware acceleration enabled, and sets `__NV_DISABLE_EXPLICIT_SYNC=1` only when the environment did not supply a value

#### Scenario: NVIDIA modern WebKitGTK on X11 or unknown display
- **WHEN** the detected renderer is proprietary NVIDIA, linked WebKitGTK is 2.54 or newer, and the display backend is X11 or cannot be inferred
- **THEN** the policy keeps the DMA-BUF renderer and hardware acceleration enabled without applying a Wayland-only explicit-sync setting

#### Scenario: Non-NVIDIA renderer
- **WHEN** the renderer identifies AMD, Intel, or another non-NVIDIA hardware driver
- **THEN** the NVIDIA-specific compatibility settings are not applied

### Requirement: Explicit override
The policy SHALL honor `PLETHORA_GPU_MODE` with values `auto` (default), `hardware` (keep hardware acceleration enabled) and `software` (always compatibility), overriding backend selection, and SHALL log the requested override separately from any compatibility setting still required by a detected GPU/WebKitGTK combination.

#### Scenario: Forced hardware
- **WHEN** `PLETHORA_GPU_MODE=hardware` on a software-rendering machine
- **THEN** hardware acceleration is not disabled by Plethora, user-provided rendering variables are preserved, and `backend=hardware reason=override-hardware` is logged

#### Scenario: Forced hardware with NVIDIA compatibility requirement
- **WHEN** `PLETHORA_GPU_MODE=hardware` on a detected NVIDIA/WebKitGTK combination requiring a synchronization compatibility setting
- **THEN** acceleration remains enabled and the narrow compatibility setting is applied only when the user has not explicitly supplied a value for it

#### Scenario: Forced software
- **WHEN** `PLETHORA_GPU_MODE=software`
- **THEN** the full compatibility set is applied regardless of detection

### Requirement: Diagnostics and log hygiene
The policy SHALL emit at most a small fixed number of `[graphics] …` lines per startup via the early startup log, including requested mode, effective Plethora backend, decision reason, and rendering environment values Plethora explicitly configured. Diagnostics SHALL NOT describe NVIDIA synchronization as enabled or negotiated solely because a disable variable is absent.

#### Scenario: Single decision line
- **WHEN** Plethora starts normally on Linux
- **THEN** exactly one concise `[graphics]` decision line is appended to the startup log and describes policy configuration rather than unobservable driver/compositor negotiation

#### Scenario: Explicit environment override
- **WHEN** a relevant WebKitGTK or NVIDIA variable was supplied by the user or launcher
- **THEN** diagnostics identify it as inherited/overridden and do not attribute it to Plethora's automatic policy

## ADDED Requirements

### Requirement: Linux window surfaces do not expose stale desktop pixels
The Linux main window SHALL not expose desktop pixels as ordinary application content during startup, repaint, resize, minimize, or restore. If a supported Linux rendering combination cannot satisfy this behavior with a transparent native surface, Plethora SHALL use a Linux-specific opaque native surface while preserving in-app theme styling and transparent native windows on platforms where they remain supported.

#### Scenario: Window redraw and lifecycle
- **WHEN** the Linux window is opened, resized, minimized, restored, or animated
- **THEN** the visible application surface is fully painted and does not reveal wallpaper through stale or missing content

#### Scenario: Platform-specific opaque fallback
- **WHEN** regression testing shows transparent native composition is unstable for a supported Linux graphics combination
- **THEN** the compatibility fallback is limited to that Linux window configuration and application theme colors and supported in-page translucency remain available

#### Scenario: Other platforms retain transparency
- **WHEN** Plethora runs on Windows, macOS, or Android
- **THEN** this Linux-specific fallback does not change that platform's existing window behavior
