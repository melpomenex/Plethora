//! Single authoritative Linux graphics policy.
//!
//! WebKitGTK acceleration used to be blanket-disabled on every Linux launch
//! path (main.rs, the dev wrapper, the dead AppRun launcher), which forced
//! CPU rasterization even on machines with a perfectly healthy GPU. This
//! module owns the decision instead: it probes the GL stack once at startup,
//! keeps hardware acceleration for real GPUs, and applies the compatibility
//! variable set (WEBKIT_DISABLE_DMABUF_RENDERER / COMPOSITING_MODE /
//! HARDWARE_ACCELERATION) only for software rasterers, GPU-less machines,
//! and the NVIDIA DMABUF breakage (X11 EGL imports and the Wayland
//! protocol-error client kill — detected via the glxinfo renderer string,
//! or via `/sys/module/nvidia` when glxinfo is not installed).
//! `PLETHORA_GPU_MODE` overrides detection when set to `hardware` or
//! `software`.
//!
//! The decision core (`resolve`) is pure and unit-testable on every platform;
//! only `init()` touches the process environment, and it is Linux-gated.

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

/// The resolved startup decision: which backend to run, which WebKitGTK
/// variables to set, and a machine-readable reason for diagnostics.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct GraphicsDecision {
    pub backend: GraphicsBackend,
    pub disable_dmabuf: bool,
    pub disable_compositing: bool,
    pub disable_hardware_acceleration: bool,
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
    /// installed) to apply the same DMABUF disable the renderer string would.
    pub nvidia_module_loaded: bool,
}

/// A hardware backend with all disabling variables off.
fn hardware_decision(disable_dmabuf: bool, reason: &'static str) -> GraphicsDecision {
    GraphicsDecision {
        backend: GraphicsBackend::Hardware,
        disable_dmabuf,
        disable_compositing: false,
        disable_hardware_acceleration: false,
        reason,
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
        reason,
    }
}

/// Decide the graphics backend from the mode override plus detection inputs.
///
/// Order of precedence:
/// 1. `Hardware`/`Software` mode overrides beat every detection signal.
/// 2. `LIBGL_ALWAYS_SOFTWARE=1` (the user already forced Mesa software GL).
/// 3. Software rasterizer renderer strings (llvmpipe/softpipe/swrast).
/// 4. NVIDIA proprietary: hardware with only the DMABUF renderer disabled
///    (X11 EGL DMABUF import breakage, tauri#9394; on Wayland the DMA-BUF
///    renderer gets the client killed with a protocol error).
/// 5. Any other real renderer string from glxinfo.
/// 6. No renderer string: `/sys/module/nvidia` probe, then the
///    `/sys/class/drm` DRI-device fallback.
pub fn resolve(mode: GpuMode, inputs: &DetectionInputs) -> GraphicsDecision {
    match mode {
        GpuMode::Hardware => return hardware_decision(false, "override-hardware"),
        GpuMode::Software => return compatibility_decision("override-software"),
        GpuMode::Auto => {}
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
        // The NVIDIA proprietary driver mishandles DMABUFs on both display
        // servers: under X11 WebKitGTK's EGL imports break (tauri#9394), and
        // under Wayland the DMA-BUF renderer violates the compositor's
        // acquire-point rule, killing the client with `Gdk-Message: Error 71
        // (Protocol error) dispatching to Wayland display`. Disabling only
        // the DMABUF renderer keeps the GPU path while dodging both.
        if renderer.contains("nvidia") {
            return hardware_decision(true, "nvidia-dmabuf");
        }
        // Mesa Intel/AMD are healthy GPU drivers.
        return hardware_decision(false, "glxinfo-hardware");
    }

    // glxinfo missing or silent (e.g. no mesa-utils installed): probe the
    // kernel's module directory and DRM class instead of assuming software.
    // The proprietary NVIDIA module alone is enough to need the DMABUF
    // disable even without a renderer string to name the GPU.
    if inputs.nvidia_module_loaded {
        return hardware_decision(true, "nvidia-module");
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

/// Detect the machine's graphics stack and apply the WebKitGTK environment.
/// Called once from `main()` on Linux, before any webview exists. Returns
/// the decision so the caller can log it.
#[cfg(target_os = "linux")]
fn init_linux() -> GraphicsDecision {
    let mode = parse_gpu_mode(std::env::var("PLETHORA_GPU_MODE").ok().as_deref());

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
    let inputs = DetectionInputs {
        libgl_always_software: std::env::var("LIBGL_ALWAYS_SOFTWARE").ok().as_deref() == Some("1"),
        renderer_string,
        nvidia_module_loaded: std::path::Path::new("/sys/module/nvidia").exists(),
        has_real_dri_device: if needs_dri_scan {
            detect_real_dri_device()
        } else {
            None
        },
    };

    let decision = resolve(mode, &inputs);
    apply_environment(&decision);
    decision
}

/// Apply the decision's WebKitGTK variables to the process environment.
/// The sandbox disable is NOT handled here — it is unconditional on Linux
/// and stays in main.rs (YouTube iframe playback requirement).
#[cfg(target_os = "linux")]
fn apply_environment(decision: &GraphicsDecision) {
    match decision.backend {
        GraphicsBackend::Hardware => {
            // NVIDIA (X11 or Wayland): drop only the DMABUF renderer
            // (tauri#9394 and the Wayland Error 71 protocol kill), keep
            // acceleration and compositing on the GPU.
            if decision.disable_dmabuf {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
            // In WebKitGTK, setting WEBKIT_HARDWARE_ACCELERATION_POLICY="always" forces
            // hardware acceleration unconditionally onto video iframes, which crashes
            // or renders blank when GStreamer hardware codecs/DMABUF video sinks fail.
            // "ondemand" is the safe WebKitGTK default that lets the webview use GPU
            // acceleration for themes/canvas while avoiding video iframe breakage.
            if std::env::var("WEBKIT_HARDWARE_ACCELERATION_POLICY").is_err() {
                std::env::set_var("WEBKIT_HARDWARE_ACCELERATION_POLICY", "ondemand");
            }
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
pub fn init() -> GraphicsDecision {
    #[cfg(target_os = "linux")]
    {
        init_linux()
    }
    #[cfg(not(target_os = "linux"))]
    {
        hardware_decision(false, "non-linux")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs(renderer: Option<&str>) -> DetectionInputs {
        DetectionInputs {
            libgl_always_software: false,
            renderer_string: renderer.map(str::to_string),
            has_real_dri_device: None,
            nvidia_module_loaded: false,
        }
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

    fn hardware(reason: &'static str) -> GraphicsDecision {
        GraphicsDecision {
            backend: GraphicsBackend::Hardware,
            disable_dmabuf: false,
            disable_compositing: false,
            disable_hardware_acceleration: false,
            reason,
        }
    }

    fn compatibility(reason: &'static str) -> GraphicsDecision {
        GraphicsDecision {
            backend: GraphicsBackend::Compatibility,
            disable_dmabuf: true,
            disable_compositing: true,
            disable_hardware_acceleration: true,
            reason,
        }
    }

    fn hardware_dmabuf_off(reason: &'static str) -> GraphicsDecision {
        GraphicsDecision {
            backend: GraphicsBackend::Hardware,
            disable_dmabuf: true,
            disable_compositing: false,
            disable_hardware_acceleration: false,
            reason,
        }
    }

    #[test]
    fn resolve_classifies_renderer_strings() {
        let nvidia_dmabuf = hardware_dmabuf_off("nvidia-dmabuf");
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
            (Some("NVIDIA GeForce RTX 3060"), nvidia_dmabuf),
            (
                Some("NVIDIA GeForce RTX 2060 SUPER/PCIe/SSE2"),
                nvidia_dmabuf,
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
        // The proprietary module loaded beats every no-glxinfo fallback
        // (mesa-utils missing is common on end-user installs).
        assert_eq!(
            resolve(GpuMode::Auto, &with_nvidia_module(with_dri(inputs(None), Some(true)))),
            hardware_dmabuf_off("nvidia-module")
        );
        // Even when the DRI scan could not run at all.
        assert_eq!(
            resolve(GpuMode::Auto, &with_nvidia_module(with_dri(inputs(None), None))),
            hardware_dmabuf_off("nvidia-module")
        );
        // A renderer string still wins over the module probe: NVIDIA GL
        // visible through glxinfo keeps the renderer-based reason, and a
        // software renderer falls back to compatibility.
        assert_eq!(
            resolve(
                GpuMode::Auto,
                &with_nvidia_module(inputs(Some("NVIDIA GeForce RTX 3060")))
            ),
            hardware_dmabuf_off("nvidia-dmabuf")
        );
        assert_eq!(
            resolve(GpuMode::Auto, &with_nvidia_module(inputs(Some("llvmpipe")))),
            compatibility("software-renderer")
        );
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
        assert_eq!(
            parse_glxinfo_renderer("OpenGL renderer string: \n"),
            None
        );
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
    }
}
