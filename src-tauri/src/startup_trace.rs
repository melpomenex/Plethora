//! Content-free launch markers independent of Tauri IPC and plugin logging.

#[cfg(target_os = "android")]
pub(crate) fn mark(phase: &'static str) {
    use std::ffi::CString;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        OnceLock,
    };
    use std::time::Instant;
    static EPOCH: OnceLock<Instant> = OnceLock::new();
    static COUNT: AtomicUsize = AtomicUsize::new(0);
    if COUNT.fetch_add(1, Ordering::Relaxed) >= 128 {
        return;
    }
    let elapsed = EPOCH.get_or_init(Instant::now).elapsed().as_millis();
    let thread = std::thread::current();
    let name = thread.name().unwrap_or("unnamed");
    let message = serde_json::json!({
        "phase": phase, "clock": "rust", "elapsedMs": elapsed,
        "thread": name, "version": env!("CARGO_PKG_VERSION"),
    })
    .to_string();
    #[link(name = "log")]
    extern "C" {
        fn __android_log_write(
            priority: i32,
            tag: *const std::ffi::c_char,
            text: *const std::ffi::c_char,
        ) -> i32;
    }
    if let Ok(text) = CString::new(message) {
        // Android's logger copies the message before returning. Both pointers
        // remain live across the call; this never schedules WebView work.
        unsafe {
            __android_log_write(4, c"PlethoraStartup".as_ptr(), text.as_ptr());
        }
    }
}

#[cfg(target_os = "linux")]
pub fn enabled() -> bool {
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ENABLED
        .get_or_init(|| std::env::var_os("PLETHORA_STARTUP_TRACE").as_deref() == Some("1".as_ref()))
}

#[cfg(target_os = "linux")]
pub fn mark(phase: &'static str) {
    use std::io::Write;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        OnceLock,
    };
    use std::time::Instant;

    static EPOCH: OnceLock<Instant> = OnceLock::new();
    static COUNT: AtomicUsize = AtomicUsize::new(0);
    if !enabled() || COUNT.fetch_add(1, Ordering::Relaxed) >= 128 {
        return;
    }
    let marker = serde_json::json!({
        "phase": phase, "clock": "rust",
        "elapsedMs": EPOCH.get_or_init(Instant::now).elapsed().as_millis(),
    });
    let _ = writeln!(std::io::stderr().lock(), "[startup:native] {marker}");
}

#[cfg(target_os = "linux")]
pub(crate) fn attach_webview(window: &tauri::WebviewWindow) {
    use webkit2gtk::{SettingsExt, WebViewExt};

    if enabled() {
        let _ = window.with_webview(|webview| {
            if let Some(settings) = webview.inner().settings() {
                settings.set_enable_write_console_messages_to_stdout(true);
            }
            mark("webview-observer-installed");
        });
    }
}

#[cfg(not(any(target_os = "android", target_os = "linux")))]
pub(crate) fn mark(_phase: &'static str) {}
