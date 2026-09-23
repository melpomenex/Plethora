// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(dev), windows_subsystem = "windows")]

use std::io::Write;

fn early_log(message: &str) {
    let log_path = std::env::temp_dir().join("plethora-startup.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let timestamp = chrono::Utc::now().to_rfc3339();
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

fn install_early_panic_hook() {
    // Keep the default panic output (stderr) while also logging to a file for
    // cases where the terminal output is not visible (e.g., GUI launches).
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        early_log(&format!("panic: {info}"));
        default_hook(info);
    }));
}

fn main() {
    install_early_panic_hook();
    early_log("startup: main begin");

    #[cfg(target_os = "linux")]
    {
        use plethora_tauri_lib::graphics::GraphicsBackend;

        // Disable sandbox (required for YouTube iframe playback on WebKitGTK 2.44+)
        std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");

        // Conditional GPU acceleration (D8), owned by the graphics policy
        // module: healthy GPUs keep hardware acceleration, software
        // rasterizers get the compatibility variable set, NVIDIA drops only
        // the DMABUF renderer (tauri#9394 plus the Wayland Error 71 protocol
        // kill), and PLETHORA_GPU_MODE=hardware/software overrides detection.
        let decision = plethora_tauri_lib::graphics::init();
        early_log(&format!(
            "[graphics] backend={} reason={} dmabuf={}",
            match decision.backend {
                GraphicsBackend::Hardware => "hardware",
                GraphicsBackend::Compatibility => "compatibility",
            },
            decision.reason,
            if decision.disable_dmabuf {
                "disabled"
            } else {
                "enabled"
            },
        ));

        // Point GStreamer at bundled plugins when running from an AppImage.
        // The AppImage runtime REPLACES GST_PLUGIN_SYSTEM_PATH_1_0 with the
        // bundled directory, hiding the host's system plugins entirely — so
        // codecs and sinks missing from the bundle (VP9/AV1, PipeWire) never
        // resolve. Re-append the conventional system paths; bundled plugins
        // stay first in the list, and GStreamer skips individual plugins that
        // fail to load.
        if let Ok(appdir) = std::env::var("APPDIR") {
            let plugin_path = format!("{appdir}/usr/lib/gstreamer-1.0");
            std::env::set_var("GST_PLUGIN_PATH", &plugin_path);
            std::env::set_var("GST_REGISTRY", "/dev/null");

            let mut parts: Vec<String> = std::env::var("GST_PLUGIN_SYSTEM_PATH_1_0")
                .unwrap_or_default()
                .split(':')
                .filter(|p| !p.is_empty())
                .map(|p| p.to_string())
                .collect();
            for dir in [
                "/usr/lib/gstreamer-1.0",
                "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
                "/usr/lib64/gstreamer-1.0",
            ] {
                if std::path::Path::new(dir).is_dir() && !parts.iter().any(|p| p == dir) {
                    parts.push(dir.to_string());
                }
            }
            if !parts.is_empty() {
                std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", parts.join(":"));
            }
        }
    }
    plethora_tauri_lib::run()
}
