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

        // Sanitize AppRun's Python paths and configure multimedia paths before
        // any graphics or webview initialization can spawn helper processes.
        let runtime = plethora_tauri_lib::linux_runtime::initialize();
        early_log(&format!(
            "[runtime] appimage={} python-sanitized={} gst-plugin-cache={} gst-plugin-dir={} gst-registry={}",
            runtime.appimage,
            if runtime.sanitized_python_keys.is_empty() {
                "none".to_string()
            } else {
                runtime.sanitized_python_keys.join(",")
            },
            runtime.gst_plugin_cache,
            runtime
                .gst_plugin_dir
                .as_deref()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "system-default".to_string()),
            std::env::var("GST_REGISTRY").unwrap_or_else(|_| "gstreamer-default".to_string()),
        ));

        // Disable sandbox (required for YouTube iframe playback on WebKitGTK 2.44+)
        std::env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");

        // Conditional GPU acceleration is owned by the graphics policy
        // module. It runs before any webview exists and leaves hardware
        // acceleration enabled on supported GPUs.
        let diagnostics = plethora_tauri_lib::graphics::init_with_diagnostics();
        let decision = diagnostics.decision;
        let setting = |key: &str| {
            diagnostics
                .settings
                .iter()
                .find(|setting| setting.key == key)
                .map(|setting| {
                    format!(
                        "{}:{}",
                        setting.value.as_deref().unwrap_or("unset"),
                        setting.source
                    )
                })
                .unwrap_or_else(|| "unavailable".to_string())
        };
        let webkit_version = diagnostics
            .webkit_version
            .map(|(major, minor)| format!("{major}.{minor}"))
            .unwrap_or_else(|| "unknown".to_string());
        let renderer = diagnostics
            .renderer
            .as_deref()
            .unwrap_or("unknown")
            .replace('\n', " ");
        early_log(&format!(
            "[graphics] requested={} effective={} reason={} display={} webkit={} renderer={:?} dmabuf-env={} explicit-sync-env={} acceleration-policy={}",
            diagnostics.requested_mode.as_str(),
            match decision.backend {
                GraphicsBackend::Hardware => "hardware",
                GraphicsBackend::Compatibility => "compatibility",
            },
            decision.reason,
            diagnostics.display_backend.as_str(),
            webkit_version,
            renderer,
            setting("WEBKIT_DISABLE_DMABUF_RENDERER"),
            setting("__NV_DISABLE_EXPLICIT_SYNC"),
            setting("WEBKIT_HARDWARE_ACCELERATION_POLICY"),
        ));
        if std::env::var("PLETHORA_LINUX_DIAGNOSTICS").ok().as_deref() == Some("1") {
            for value in &diagnostics.settings {
                early_log(&format!(
                    "[graphics-env] {}={} source={}",
                    value.key,
                    value.value.as_deref().unwrap_or("unset"),
                    value.source,
                ));
            }
        }
    }
    plethora_tauri_lib::run()
}
