//! Content-free Android markers independent of Tauri IPC and plugin logging.

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

#[cfg(not(target_os = "android"))]
pub(crate) fn mark(_phase: &'static str) {}
