//! Single authoritative Linux graphics policy.
//!
//! WebKitGTK acceleration used to be blanket-disabled on every Linux launch
//! path (main.rs, the dev wrapper, the dead AppRun launcher), which forced
//! CPU rasterization even on machines with a perfectly healthy GPU. This
//! module owns the decision instead: it probes the GL stack once at startup,
//! keeps hardware acceleration for real GPUs, and applies the compatibility
//! variable set (WEBKIT_DISABLE_DMABUF_RENDERER / COMPOSITING_MODE /
//! HARDWARE_ACCELERATION) only for software rasterers, GPU-less machines,
//! and narrowly scoped NVIDIA compatibility settings when the NVIDIA GPU,
//! WebKitGTK version, and selected display backend are observable.
//!
//! The NVIDIA policy is version- and display-gated: WebKitGTK 2.54 changes
//! the non-DMA-BUF transport, and a matching NVIDIA issue reports stale
//! repainting. The explicit-sync workaround is limited to observable native
//! Wayland sessions.
//!
//! `PLETHORA_GPU_MODE` overrides detection when set to `hardware` or
//! `software`.
//!
//! The decision core (`resolve`) is pure and unit-testable on every platform;
//! the Linux initialization entry point probes and updates the process
//! environment before WebKitGTK starts.

/// Explicit user override read from `PLETHORA_GPU_MODE`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GpuMode {
    /// Detect and pick the best backend (default).
    Auto,
    /// Never disable acceleration, regardless of detection.
    Hardware,
    /// Always use the compatibility variable set.
    Software,
}

/// The WebKitGTK rendering backend the decision selected.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GraphicsBackend {
    /// Hardware-accelerated WebKitGTK.
    Hardware,
    /// Software compatibility mode (all disabling variables applied).
    Compatibility,
}

/// GTK display protocol observed from the process environment.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DisplayBackend {
    Wayland,
    X11,
    Unknown,
}

impl DisplayBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wayland => "wayland",
            Self::X11 => "x11",
            Self::Unknown => "unknown",
        }
    }
}

/// The resolved startup decision: which backend to run, which WebKitGTK
/// variables to set, and a machine-readable reason for diagnostics.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct GraphicsDecision {
    pub backend: GraphicsBackend,
    pub disable_dmabuf: bool,
    pub disable_compositing: bool,
    pub disable_hardware_acceleration: bool,
    /// Set `__NV_DISABLE_EXPLICIT_SYNC=1` for the reported modern NVIDIA
    /// Wayland failure. This records Plethora's requested setting only.
    pub disable_explicit_sync: bool,
    pub reason: &'static str,
}

/// Everything `resolve` needs to know about the machine. Every field is
/// caller-supplied so the decision logic can be tested without a display,
/// a GPU, or a Linux kernel.
pub struct DetectionInputs {
    /// `LIBGL_ALWAYS_SOFTWARE=1` was set by the user — force software.
    pub libgl_always_software: bool,
    /// Renderer line parsed from `glxinfo -B`; `None` when glxinfo is
    /// missing, failed, or produced no renderer line.
    pub renderer_string: Option<String>,
    /// Result of scanning `/sys/class/drm` for a real GPU. `Some(true)` /
    /// `Some(false)` after a completed scan; `None` = scan not attempted
    /// (non-Linux, or `/sys/class/drm` unreadable).
    pub has_real_dri_device: Option<bool>,
    /// `/sys/module/nvidia` exists — the proprietary NVIDIA kernel module is
    /// loaded. Used when glxinfo is unavailable (e.g. mesa-utils not
    /// installed) to apply the same DMABUF policy the renderer string would.
    pub nvidia_module_loaded: bool,
    /// WebKitGTK runtime version (`webkit_get_major_version`,
    /// `webkit_get_minor_version`), or `None` when it could not be read.
    /// Gates the 2.54 DMA-BUF regression described on
    /// `WEBKIT_DMABUF_FLICKER_REGRESSION`.
    pub webkit_version: Option<(u32, u32)>,
    /// The selected GTK display protocol when it can be inferred from the
    /// process environment. This matters because NVIDIA explicit-sync policy
    /// applies to native Wayland clients, not X11 clients.
    pub display_backend: DisplayBackend,
}

/// WebKitGTK 2.54 no longer adds the shared-memory renderer transport when
/// `WEBKIT_DISABLE_DMABUF_RENDERER=1`. A report for NVIDIA/WebKitGTK 2.54.1
/// describes stale repainting with that path, so the policy avoids forcing it
/// off on modern versions. Disable NVIDIA explicit sync only for observable
/// native Wayland sessions, where the protocol error was reported.
pub const WEBKIT_DMABUF_FLICKER_REGRESSION: (u32, u32) = (2, 54);

/// True at or above the WebKitGTK version whose DMA-BUF-disabled path has a
/// reported repaint issue. Unknown versions are treated as legacy.
fn has_dmabuf_flicker_regression(version: Option<(u32, u32)>) -> bool {
    version.is_some_and(|v| v >= WEBKIT_DMABUF_FLICKER_REGRESSION)
}

/// A hardware backend with all disabling variables off.
fn hardware_decision(disable_dmabuf: bool, reason: &'static str) -> GraphicsDecision {
    GraphicsDecision {
        backend: GraphicsBackend::Hardware,
        disable_dmabuf,
        disable_compositing: false,
        disable_hardware_acceleration: false,
        disable_explicit_sync: false,
        reason,
    }
}

/// Older WebKitGTK keeps the existing DMA-BUF mitigation. On WebKitGTK ≥ 2.54,
/// where disabling DMA-BUF has a repaint regression, the explicit-sync
/// setting applies only to native Wayland.
fn nvidia_decision(
    webkit_version: Option<(u32, u32)>,
    display_backend: DisplayBackend,
) -> GraphicsDecision {
    if !has_dmabuf_flicker_regression(webkit_version) {
        // On older WebKitGTK the NVIDIA DMA-BUF path is the known crash /
        // import-failure path. Keep acceleration for the rest of the view.
        hardware_decision(true, "nvidia-legacy-dmabuf-off")
    } else if display_backend == DisplayBackend::Wayland {
        GraphicsDecision {
            backend: GraphicsBackend::Hardware,
            disable_dmabuf: false,
            disable_compositing: false,
            disable_hardware_acceleration: false,
            disable_explicit_sync: true,
            reason: "nvidia-wayland-explicit-sync",
        }
    } else {
        // The available evidence for explicit-sync trouble is Wayland-specific.
        // Leave the modern DMA-BUF path alone for X11 or an unknown backend.
        hardware_decision(false, "nvidia-modern-no-sync-policy")
    }
}

/// The compatibility variable set: DMABUF renderer, compositing mode, and
/// hardware acceleration all disabled.
fn compatibility_decision(reason: &'static str) -> GraphicsDecision {
    GraphicsDecision {
        backend: GraphicsBackend::Compatibility,
        disable_dmabuf: true,
        disable_compositing: true,
        disable_hardware_acceleration: true,
        disable_explicit_sync: false,
        reason,
    }
}

/// Decide the graphics backend from the mode override plus detection inputs.
///
/// Order of precedence:
/// 1. Software mode forces compatibility. Hardware mode keeps acceleration
///    but still applies a detected NVIDIA/WebKitGTK Wayland safeguard.
/// 2. `LIBGL_ALWAYS_SOFTWARE=1` (the user already forced Mesa software GL).
/// 3. Software rasterizer renderer strings (llvmpipe/softpipe/swrast).
/// 4. NVIDIA proprietary: version- and display-specific compatibility.
/// 5. Any other real renderer string from glxinfo.
/// 6. No renderer string: `/sys/module/nvidia` probe, then the
///    `/sys/class/drm` DRI-device fallback.
pub fn resolve(mode: GpuMode, inputs: &DetectionInputs) -> GraphicsDecision {
    if mode == GpuMode::Software {
        return compatibility_decision("override-software");
    }

    let is_nvidia = match inputs.renderer_string.as_deref() {
        Some(renderer) => renderer.to_ascii_lowercase().contains("nvidia"),
        None => inputs.nvidia_module_loaded,
    };

    if mode == GpuMode::Hardware {
        return if is_nvidia {
            nvidia_decision(inputs.webkit_version, inputs.display_backend)
        } else {
            hardware_decision(false, "override-hardware")
        };
    }

    // The user forced Mesa software GL; WebKitGTK must not fight it.
    if inputs.libgl_always_software {
        return compatibility_decision("user-forced-software-gl");
    }

    if let Some(renderer) = &inputs.renderer_string {
        let renderer = renderer.to_ascii_lowercase();
        // Software rasterizers render fine but crash/soft-lock WebKitGTK's
        // accelerated pipeline (white screen, EGL errors) — fall back.
        if renderer.contains("llvmpipe")
            || renderer.contains("softpipe")
            || renderer.contains("swrast")
        {
            return compatibility_decision("software-renderer");
        }
        // The NVIDIA/WebKitGTK policy is narrowed to the display and runtime
        // version for which a workaround is justified.
        if renderer.contains("nvidia") {
            return nvidia_decision(inputs.webkit_version, inputs.display_backend);
        }
        // Mesa Intel/AMD are healthy GPU drivers.
        return hardware_decision(false, "glxinfo-hardware");
    }

    // glxinfo missing or silent (e.g. no mesa-utils installed): probe the
    // kernel's module directory and DRM class instead of assuming software.
    // The proprietary NVIDIA module alone is enough to need the NVIDIA
    // DMABUF policy even without a renderer string to name the GPU.
    if inputs.nvidia_module_loaded {
        return nvidia_decision(inputs.webkit_version, inputs.display_backend);
    }
    match inputs.has_real_dri_device {
        Some(true) => hardware_decision(false, "dri-device-present"),
        Some(false) => compatibility_decision("no-gpu-detected"),
        None => compatibility_decision("gpu-detection-unavailable"),
    }
}

/// Extract the `OpenGL renderer string:` value from `glxinfo -B` output.
/// Returns `None` when no such line (or no value) exists.
pub fn parse_glxinfo_renderer(stdout: &str) -> Option<String> {
    stdout.lines().find_map(|line| {
        let value = line.trim().strip_prefix("OpenGL renderer string:")?.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// Parse `PLETHORA_GPU_MODE`. `None`, empty, and unrecognized values all
/// mean `Auto`; `hardware` forces Hardware; `software`/`compat`/
/// `compatibility` force Software. Case-insensitive.
pub fn parse_gpu_mode(raw: Option<&str>) -> GpuMode {
    let Some(value) = raw else {
        return GpuMode::Auto;
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "hardware" => GpuMode::Hardware,
        "software" | "compat" | "compatibility" => GpuMode::Software,
        _ => GpuMode::Auto,
    }
}

/// Infer the GTK display backend from an explicit `GDK_BACKEND` selection or
/// the display/session variables available to the process.
pub fn resolve_display_backend(
    gdk_backend: Option<&str>,
    wayland_display: bool,
    x11_display: bool,
    session_type: Option<&str>,
) -> DisplayBackend {
    if let Some(value) = gdk_backend.filter(|value| !value.trim().is_empty()) {
        let candidates: Vec<_> = value
            .split(',')
            .map(|candidate| candidate.trim().to_ascii_lowercase())
            .collect();
        for candidate in &candidates {
            match candidate.as_str() {
                "wayland" if wayland_display => return DisplayBackend::Wayland,
                "x11" if x11_display => return DisplayBackend::X11,
                _ => {}
            }
        }
        if candidates.len() == 1 {
            return match candidates[0].as_str() {
                "wayland" => DisplayBackend::Wayland,
                "x11" => DisplayBackend::X11,
                _ => DisplayBackend::Unknown,
            };
        }
    }

    if wayland_display {
        DisplayBackend::Wayland
    } else if x11_display {
        DisplayBackend::X11
    } else if let Some(session_type) = session_type {
        if session_type.eq_ignore_ascii_case("wayland") {
            DisplayBackend::Wayland
        } else if session_type.eq_ignore_ascii_case("x11") {
            DisplayBackend::X11
        } else {
            DisplayBackend::Unknown
        }
    } else {
        DisplayBackend::Unknown
    }
}

impl GpuMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Hardware => "hardware",
            Self::Software => "software",
        }
    }
}

#[derive(Debug, Clone)]
pub struct EnvironmentSetting {
    pub key: &'static str,
    pub value: Option<String>,
    /// `inherited`, `policy`, or `unset`; this does not describe driver
    /// negotiation or the value ultimately used by WebKitGTK.
    pub source: &'static str,
}

#[derive(Debug, Clone)]
pub struct GraphicsStartupDiagnostics {
    pub decision: GraphicsDecision,
    pub requested_mode: GpuMode,
    pub display_backend: DisplayBackend,
    pub renderer: Option<String>,
    pub webkit_version: Option<(u32, u32)>,
    pub settings: Vec<EnvironmentSetting>,
}

/// Scan `/sys/class/drm` for a GPU from a known vendor.
///
/// Only top-level device nodes (`card0`, `renderD128`) are considered —
/// connector entries like `card0-HDMI-A-1` are children of a card, not
/// devices. A node counts when its `device/vendor` file matches a real GPU
/// vendor (Intel, AMD, NVIDIA, virtio, VMware); VGEM and similar stubs do
/// not. Returns `Some(true)` on any hit, `Some(false)` when the scan
/// completed without one, and `None` when `/sys/class/drm` is unreadable
/// or the platform has no such directory (non-Linux).
pub fn detect_real_dri_device() -> Option<bool> {
    #[cfg(target_os = "linux")]
    {
        scan_drm_class_dir()
    }
    #[cfg(not(target_os = "linux"))]
    {
        // No /sys/class/drm outside Linux; report "not attempted".
        None
    }
}

/// Does the `/sys/class/drm` entry name denote a device node rather than a
/// connector? `card0`/`renderD128` yes, `card0-HDMI-A-1` no.
#[cfg(target_os = "linux")]
fn is_drm_device_node(name: &str) -> bool {
    fn digits_after(prefix: &str, name: &str) -> bool {
        name.strip_prefix(prefix)
            .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
    }
    digits_after("card", name) || digits_after("renderD", name)
}

#[cfg(target_os = "linux")]
fn scan_drm_class_dir() -> Option<bool> {
    // PCI vendor IDs of real GPU drivers (VGEM and other stub devices have
    // different IDs and are deliberately absent).
    const KNOWN_GPU_VENDOR_IDS: &[&str] = &[
        "0x8086", // Intel
        "0x1002", // AMD
        "0x10de", // NVIDIA
        "0x1af4", // virtio-gpu
        "0x15ad", // VMware SVGA
    ];

    let entries = std::fs::read_dir("/sys/class/drm").ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !is_drm_device_node(name) {
            continue;
        }
        // Tolerate unreadable vendor files (permissions, raced unplug).
        let Ok(vendor) = std::fs::read_to_string(entry.path().join("device/vendor")) else {
            continue;
        };
        if KNOWN_GPU_VENDOR_IDS.contains(&vendor.trim()) {
            return Some(true);
        }
    }
    Some(false)
}

/// Read the linked WebKitGTK runtime version. The library is already a
/// dependency of the process (Tauri's `wry` links it), so the exported
/// version accessors resolve without a `dlopen`. Returns `None` only if the
/// symbols were somehow absent, in which case the policy stays on the legacy
/// (DMABUF-off) path.
#[cfg(target_os = "linux")]
fn runtime_webkit_version() -> Option<(u32, u32)> {
    unsafe extern "C" {
        fn webkit_get_major_version() -> u32;
        fn webkit_get_minor_version() -> u32;
    }
    // SAFETY: both accessors are pure, take no arguments, and are part of the
    // stable WebKitGTK 4.1 ABI that the webview already links against.
    let version = unsafe { (webkit_get_major_version(), webkit_get_minor_version()) };
    (version.0 > 0).then_some(version)
}

const DIAGNOSTIC_ENV_KEYS: &[&str] = &[
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "WEBKIT_DISABLE_HARDWARE_ACCELERATION",
    "WEBKIT_HARDWARE_ACCELERATION_POLICY",
    "__NV_DISABLE_EXPLICIT_SYNC",
    "WEBKIT_USE_SKIA_FOR_COMPOSITION",
];

/// Detect the graphics stack, apply the policy, and capture what Plethora
/// requested and configured. Environment values do not prove what the driver
/// or compositor ultimately negotiated.
#[cfg(target_os = "linux")]
fn init_linux_with_diagnostics() -> GraphicsStartupDiagnostics {
    let requested_mode = parse_gpu_mode(std::env::var("PLETHORA_GPU_MODE").ok().as_deref());
    let display_backend = resolve_display_backend(
        std::env::var("GDK_BACKEND").ok().as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").is_some(),
        std::env::var_os("DISPLAY").is_some(),
        std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
    );

    // Same glxinfo probe main.rs always used; a missing glxinfo simply
    // yields no renderer string and the DRI fallback takes over below.
    let renderer_string = std::process::Command::new("glxinfo")
        .arg("-B")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|stdout| parse_glxinfo_renderer(&stdout));

    // Only pay for the sysfs scan when glxinfo could not answer.
    let needs_dri_scan = renderer_string.is_none();
    let webkit_version = runtime_webkit_version();
    let inputs = DetectionInputs {
        libgl_always_software: std::env::var("LIBGL_ALWAYS_SOFTWARE").ok().as_deref() == Some("1"),
        renderer_string: renderer_string.clone(),
        nvidia_module_loaded: std::path::Path::new("/sys/module/nvidia").exists(),
        has_real_dri_device: if needs_dri_scan {
            detect_real_dri_device()
        } else {
            None
        },
        webkit_version,
        display_backend,
    };

    let inherited: Vec<_> = DIAGNOSTIC_ENV_KEYS
        .iter()
        .map(|key| (*key, std::env::var_os(key)))
        .collect();
    let decision = resolve(requested_mode, &inputs);
    apply_environment(&decision);
    let settings = DIAGNOSTIC_ENV_KEYS
        .iter()
        .map(|key| {
            let before = inherited
                .iter()
                .find(|(inherited_key, _)| inherited_key == key)
                .and_then(|(_, value)| value.as_ref());
            let value = std::env::var(key).ok();
            let source = if before.is_some() {
                "inherited"
            } else if value.is_some() {
                "policy"
            } else {
                "unset"
            };
            EnvironmentSetting { key, value, source }
        })
        .collect();

    GraphicsStartupDiagnostics {
        decision,
        requested_mode,
        display_backend,
        renderer: renderer_string,
        webkit_version,
        settings,
    }
}

/// Set `key` only when the user (or the launcher) has not already decided.
/// An explicit `WEBKIT_DISABLE_DMABUF_RENDERER=0` must survive the policy.
#[cfg(target_os = "linux")]
fn set_if_unset(key: &str, value: &str) {
    if std::env::var_os(key).is_none() {
        std::env::set_var(key, value);
    }
}

/// Apply the decision's WebKitGTK variables to the process environment.
/// The sandbox disable is NOT handled here — it is unconditional on Linux
/// and stays in main.rs (YouTube iframe playback requirement).
#[cfg(target_os = "linux")]
fn apply_environment(decision: &GraphicsDecision) {
    match decision.backend {
        GraphicsBackend::Hardware => {
            // NVIDIA on WebKitGTK < 2.54: drop only the DMABUF renderer
            // (tauri#9394 and the Wayland Error 71 protocol kill), keep
            // acceleration and compositing on the GPU.
            if decision.disable_dmabuf {
                set_if_unset("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
            // On the reported modern NVIDIA Wayland combination, keep the
            // DMA-BUF renderer and request the NVIDIA explicit-sync workaround.
            // The environment value does not prove driver negotiation.
            if decision.disable_explicit_sync {
                set_if_unset("__NV_DISABLE_EXPLICIT_SYNC", "1");
            }
            // In WebKitGTK, setting WEBKIT_HARDWARE_ACCELERATION_POLICY="always" forces
            // hardware acceleration unconditionally onto video iframes, which crashes
            // or renders blank when GStreamer hardware codecs/DMABUF video sinks fail.
            // "ondemand" is the safe WebKitGTK default that lets the webview use GPU
            // acceleration for themes/canvas while avoiding video iframe breakage.
            set_if_unset("WEBKIT_HARDWARE_ACCELERATION_POLICY", "ondemand");
        }
        GraphicsBackend::Compatibility => {
            // Software rasterizer fallback: the trio that keeps WebKitGTK
            // stable without a GPU (white-screen/EGL fix, YouTube playback).
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            std::env::set_var("WEBKIT_DISABLE_HARDWARE_ACCELERATION", "1");
            std::env::set_var("WEBKIT_HARDWARE_ACCELERATION_POLICY", "never");
        }
    }
}

/// Entry point: run the detection pipeline and apply the resulting env vars
/// on Linux; a no-op hardware decision everywhere else (WebKitGTK-only
/// policy, nothing to configure on macOS/Windows/mobile).
pub fn init_with_diagnostics() -> GraphicsStartupDiagnostics {
    #[cfg(target_os = "linux")]
    {
        init_linux_with_diagnostics()
    }
    #[cfg(not(target_os = "linux"))]
    {
        GraphicsStartupDiagnostics {
            decision: hardware_decision(false, "non-linux"),
            requested_mode: GpuMode::Auto,
            display_backend: DisplayBackend::Unknown,
            renderer: None,
            webkit_version: None,
            settings: Vec::new(),
        }
    }
}

/// Detect and apply the graphics policy, returning only the decision.
pub fn init() -> GraphicsDecision {
    init_with_diagnostics().decision
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[cfg(target_os = "linux")]
    static ENVIRONMENT_LOCK: Mutex<()> = Mutex::new(());

    fn inputs(renderer: Option<&str>) -> DetectionInputs {
        DetectionInputs {
            libgl_always_software: false,
            renderer_string: renderer.map(str::to_string),
            has_real_dri_device: None,
            nvidia_module_loaded: false,
            // Legacy baseline: the NVIDIA DMABUF-off path is what shipped
            // before the 2.54 regression.
            webkit_version: Some((2, 52)),
            display_backend: DisplayBackend::Wayland,
        }
    }

    fn with_webkit(mut base: DetectionInputs, version: Option<(u32, u32)>) -> DetectionInputs {
        base.webkit_version = version;
        base
    }

    fn with_nvidia_module(mut base: DetectionInputs) -> DetectionInputs {
        base.nvidia_module_loaded = true;
        base
    }

    fn with_dri(mut base: DetectionInputs, dri: Option<bool>) -> DetectionInputs {
        base.has_real_dri_device = dri;
        base
    }

    fn with_libgl(mut base: DetectionInputs) -> DetectionInputs {
        base.libgl_always_software = true;
        base
    }

    fn with_display(mut base: DetectionInputs, display_backend: DisplayBackend) -> DetectionInputs {
        base.display_backend = display_backend;
        base
    }

    fn hardware(reason: &'static str) -> GraphicsDecision {
        GraphicsDecision {
            backend: GraphicsBackend::Hardware,
            disable_dmabuf: false,
            disable_compositing: false,
            disable_hardware_acceleration: false,
            disable_explicit_sync: false,
            reason,
        }
    }

    fn compatibility(reason: &'static str) -> GraphicsDecision {
        GraphicsDecision {
            backend: GraphicsBackend::Compatibility,
            disable_dmabuf: true,
            disable_compositing: true,
            disable_hardware_acceleration: true,
            disable_explicit_sync: false,
            reason,
        }
    }

    fn hardware_dmabuf_off(reason: &'static str) -> GraphicsDecision {
        GraphicsDecision {
            backend: GraphicsBackend::Hardware,
            disable_dmabuf: true,
            disable_compositing: false,
            disable_hardware_acceleration: false,
            disable_explicit_sync: false,
            reason,
        }
    }

    /// NVIDIA >= 2.54: DMA-BUF renderer stays on, explicit sync is disabled.
    fn hardware_dmabuf_on_explicit_sync_off(reason: &'static str) -> GraphicsDecision {
        GraphicsDecision {
            backend: GraphicsBackend::Hardware,
            disable_dmabuf: false,
            disable_compositing: false,
            disable_hardware_acceleration: false,
            disable_explicit_sync: true,
            reason,
        }
    }

    #[test]
    fn resolve_classifies_renderer_strings() {
        let cases: &[(Option<&str>, GraphicsDecision)] = &[
            // Software rasterizers → compatibility fallback.
            (
                Some("llvmpipe (LLVM 15.0.7, 256 bits)"),
                compatibility("software-renderer"),
            ),
            (Some("softpipe"), compatibility("software-renderer")),
            (Some("swrast"), compatibility("software-renderer")),
            // Real Mesa drivers → hardware, nothing disabled.
            (
                Some("Mesa Intel(R) UHD Graphics 620 (CFL GT2)"),
                hardware("glxinfo-hardware"),
            ),
            (
                Some("AMD Radeon RX 6800 (RADV NAVI21)"),
                hardware("glxinfo-hardware"),
            ),
            // NVIDIA proprietary reports an "NVIDIA ..." renderer on every
            // display server: DMABUF renderer off, acceleration kept.
            (
                Some("NVIDIA GeForce RTX 3060"),
                hardware_dmabuf_off("nvidia-legacy-dmabuf-off"),
            ),
            (
                Some("NVIDIA GeForce RTX 2060 SUPER/PCIe/SSE2"),
                hardware_dmabuf_off("nvidia-legacy-dmabuf-off"),
            ),
        ];
        for (renderer, expected) in cases {
            assert_eq!(
                resolve(GpuMode::Auto, &inputs(*renderer)),
                *expected,
                "renderer={renderer:?}"
            );
        }
    }

    #[test]
    fn resolve_falls_back_to_dri_scan_without_glxinfo() {
        assert_eq!(
            resolve(GpuMode::Auto, &with_dri(inputs(None), Some(true))),
            hardware("dri-device-present")
        );
        assert_eq!(
            resolve(GpuMode::Auto, &with_dri(inputs(None), Some(false))),
            compatibility("no-gpu-detected")
        );
        assert_eq!(
            resolve(GpuMode::Auto, &with_dri(inputs(None), None)),
            compatibility("gpu-detection-unavailable")
        );
    }

    #[test]
    fn resolve_nvidia_module_without_glxinfo_disables_dmabuf() {
        // The proprietary module is the NVIDIA signal when glxinfo is absent.
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_nvidia_module(with_dri(inputs(None), Some(true)))
            ),
            hardware_dmabuf_off("nvidia-legacy-dmabuf-off")
        );
        // Even when the DRI scan could not run at all.
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_nvidia_module(with_dri(inputs(None), None))
            ),
            hardware_dmabuf_off("nvidia-legacy-dmabuf-off")
        );
        // A renderer string still wins over the module probe, and a software
        // renderer falls back to compatibility.
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_nvidia_module(inputs(Some("NVIDIA GeForce RTX 3060")))
            ),
            hardware_dmabuf_off("nvidia-legacy-dmabuf-off")
        );
        assert_eq!(
            resolve(GpuMode::Auto, &with_nvidia_module(inputs(Some("llvmpipe")))),
            compatibility("software-renderer")
        );
    }

    #[test]
    fn resolve_webkit_254_keeps_dmabuf_for_nvidia() {
        // WebKitGTK 2.54 regressed the non-DMABUF path (static content
        // blinks out). Keep the renderer and disable explicit sync instead.
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_webkit(inputs(Some("NVIDIA GeForce RTX 3060")), Some((2, 54)))
            ),
            hardware_dmabuf_on_explicit_sync_off("nvidia-wayland-explicit-sync")
        );
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_webkit(with_nvidia_module(inputs(None)), Some((2, 54)))
            ),
            hardware_dmabuf_on_explicit_sync_off("nvidia-wayland-explicit-sync")
        );
        // Later 2.54.x and newer stay on the modern path.
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_webkit(inputs(Some("NVIDIA GeForce RTX 4080")), Some((2, 56)))
            ),
            hardware_dmabuf_on_explicit_sync_off("nvidia-wayland-explicit-sync")
        );
        // Non-NVIDIA decisions are untouched by the version gate.
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_webkit(
                    inputs(Some("AMD Radeon RX 6800 (RADV NAVI21)")),
                    Some((2, 54))
                )
            ),
            hardware("glxinfo-hardware")
        );
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_webkit(inputs(Some("llvmpipe")), Some((2, 54)))
            ),
            compatibility("software-renderer")
        );
    }

    #[test]
    fn modern_nvidia_workaround_is_limited_to_native_wayland() {
        let modern = with_webkit(inputs(Some("NVIDIA GeForce RTX 2060")), Some((2, 54)));
        assert_eq!(
            resolve(GpuMode::Auto, &with_display(modern, DisplayBackend::X11)),
            hardware("nvidia-modern-no-sync-policy")
        );
        let modern = with_webkit(inputs(Some("NVIDIA GeForce RTX 2060")), Some((2, 54)));
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_display(modern, DisplayBackend::Unknown)
            ),
            hardware("nvidia-modern-no-sync-policy")
        );

        // hardware mode controls acceleration but does not bypass the
        // Wayland-specific NVIDIA synchronization policy.
        let modern = with_webkit(inputs(Some("NVIDIA GeForce RTX 2060")), Some((2, 54)));
        assert_eq!(
            resolve(GpuMode::Hardware, &modern),
            hardware_dmabuf_on_explicit_sync_off("nvidia-wayland-explicit-sync")
        );
    }

    #[test]
    fn resolve_unknown_webkit_version_keeps_legacy_nvidia_protection() {
        // An unreadable version must not silently drop the crash guard that
        // older WebKitGTK needs.
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_webkit(inputs(Some("NVIDIA GeForce RTX 3060")), None)
            ),
            hardware_dmabuf_off("nvidia-legacy-dmabuf-off")
        );
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_webkit(with_nvidia_module(inputs(None)), None)
            ),
            hardware_dmabuf_off("nvidia-legacy-dmabuf-off")
        );
        assert!(!has_dmabuf_flicker_regression(None));
        assert!(!has_dmabuf_flicker_regression(Some((2, 53))));
        assert!(has_dmabuf_flicker_regression(Some((2, 54))));
    }

    #[test]
    fn resolve_honors_libgl_force_and_mode_overrides() {
        // User-forced software GL beats even a healthy renderer string.
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_libgl(inputs(Some("AMD Radeon RX 6800 (RADV NAVI21)")))
            ),
            compatibility("user-forced-software-gl")
        );
        // Mode overrides beat every detection signal, libgl included.
        assert_eq!(
            resolve(GpuMode::Hardware, &with_libgl(inputs(Some("llvmpipe")))),
            hardware("override-hardware")
        );
        assert_eq!(
            resolve(GpuMode::Software, &inputs(Some("AMD Radeon RX 6800"))),
            compatibility("override-software")
        );
    }

    #[test]
    fn parse_gpu_mode_variants() {
        assert_eq!(parse_gpu_mode(None), GpuMode::Auto);
        assert_eq!(parse_gpu_mode(Some("")), GpuMode::Auto);
        assert_eq!(parse_gpu_mode(Some("auto")), GpuMode::Auto);
        assert_eq!(parse_gpu_mode(Some("AUTO")), GpuMode::Auto);
        assert_eq!(parse_gpu_mode(Some("HARDWARE")), GpuMode::Hardware);
        assert_eq!(parse_gpu_mode(Some(" hardware ")), GpuMode::Hardware);
        assert_eq!(parse_gpu_mode(Some("Software")), GpuMode::Software);
        assert_eq!(parse_gpu_mode(Some("compat")), GpuMode::Software);
        assert_eq!(parse_gpu_mode(Some("compatibility")), GpuMode::Software);
        assert_eq!(parse_gpu_mode(Some("bogus")), GpuMode::Auto);
    }

    #[test]
    fn resolve_display_backend_prefers_explicit_gtk_selection() {
        assert_eq!(
            resolve_display_backend(Some("x11"), true, true, Some("wayland")),
            DisplayBackend::X11
        );
        assert_eq!(
            resolve_display_backend(Some("wayland,x11"), true, true, Some("wayland")),
            DisplayBackend::Wayland
        );
        assert_eq!(
            resolve_display_backend(Some("x11,wayland"), true, true, Some("wayland")),
            DisplayBackend::X11
        );
        assert_eq!(
            resolve_display_backend(None, true, true, Some("wayland")),
            DisplayBackend::Wayland
        );
        assert_eq!(
            resolve_display_backend(None, false, true, Some("wayland")),
            DisplayBackend::X11
        );
        assert_eq!(
            resolve_display_backend(None, false, false, None),
            DisplayBackend::Unknown
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn hardware_environment_keeps_explicit_values_and_applies_narrow_policy() {
        struct Restore(Vec<(&'static str, Option<std::ffi::OsString>)>);
        impl Drop for Restore {
            fn drop(&mut self) {
                for (key, value) in &self.0 {
                    if let Some(value) = value {
                        std::env::set_var(key, value);
                    } else {
                        std::env::remove_var(key);
                    }
                }
            }
        }

        let _lock = ENVIRONMENT_LOCK.lock().unwrap();
        let keys = [
            "WEBKIT_DISABLE_DMABUF_RENDERER",
            "WEBKIT_DISABLE_COMPOSITING_MODE",
            "WEBKIT_DISABLE_HARDWARE_ACCELERATION",
            "WEBKIT_HARDWARE_ACCELERATION_POLICY",
            "__NV_DISABLE_EXPLICIT_SYNC",
            "WEBKIT_USE_SKIA_FOR_COMPOSITION",
        ];
        let _restore = Restore(
            keys.iter()
                .map(|key| (*key, std::env::var_os(key)))
                .collect(),
        );
        for key in keys {
            std::env::remove_var(key);
        }
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "0");
        std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "0");
        std::env::set_var("WEBKIT_USE_SKIA_FOR_COMPOSITION", "0");

        apply_environment(&hardware_dmabuf_on_explicit_sync_off(
            "nvidia-wayland-explicit-sync",
        ));

        assert_eq!(
            std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref(),
            Ok("0")
        );
        assert_eq!(
            std::env::var("__NV_DISABLE_EXPLICIT_SYNC").as_deref(),
            Ok("0")
        );
        assert_eq!(
            std::env::var("WEBKIT_USE_SKIA_FOR_COMPOSITION").as_deref(),
            Ok("0")
        );
        assert_eq!(
            std::env::var("WEBKIT_HARDWARE_ACCELERATION_POLICY").as_deref(),
            Ok("ondemand")
        );
        assert!(std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none());
        assert!(std::env::var_os("WEBKIT_DISABLE_HARDWARE_ACCELERATION").is_none());
    }

    #[test]
    fn parse_glxinfo_renderer_finds_renderer_line() {
        let stdout = "\
display: :0  screen: 0
direct rendering: Yes
Extended renderer info (GLX_MESA_query_renderer):
    Vendor: Intel (0x8086)
    Device: Mesa Intel(R) UHD Graphics 620 (CFL GT2)
    Accelerated: yes
OpenGL vendor string: Intel
OpenGL renderer string: Mesa Intel(R) UHD Graphics 620 (CFL GT2)
OpenGL core profile version string: 4.6 (Core Profile) Mesa 20.3.5
";
        assert_eq!(
            parse_glxinfo_renderer(stdout).as_deref(),
            Some("Mesa Intel(R) UHD Graphics 620 (CFL GT2)")
        );
    }

    #[test]
    fn parse_glxinfo_renderer_handles_missing_or_empty() {
        assert_eq!(parse_glxinfo_renderer(""), None);
        assert_eq!(parse_glxinfo_renderer("direct rendering: Yes\n"), None);
        // A renderer line with no value must not masquerade as hardware.
        assert_eq!(parse_glxinfo_renderer("OpenGL renderer string: \n"), None);
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn init_off_linux_returns_no_op_hardware_decision() {
        let decision = init();
        assert_eq!(decision.backend, GraphicsBackend::Hardware);
        assert_eq!(decision.reason, "non-linux");
        assert!(!decision.disable_dmabuf);
        assert!(!decision.disable_compositing);
        assert!(!decision.disable_hardware_acceleration);
        assert!(!decision.disable_explicit_sync);
    }
}
