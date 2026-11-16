//! Dynamic runtime FFI bindings for Cactus Compute's native C engine (`libcactus`).
//!
//! Matches `cactus.h` from `Cactus-Compute/cactus` (v4.1.x):
//! - `int cactus_load(const unsigned char* cact, unsigned long long n);`
//! - `const char* cactus_last_error(void);`
//! - `int cactus_describe(const unsigned char* rgb, int width, int height, const char* options, const char* language, const char* keywords, char* out, int out_capacity);`
//!
//! Uses `libloading` so Plethora compiles cleanly on all platforms without
//! build-time linkage to `libcactus`. At runtime, `CactusLibrary::load` probes
//! `PLETHORA_CACTUS_LIB`, the executable directory, `src-tauri/bin`, and OS
//! library search paths (including Android `nativeLibraryDir` via `libcactus.so`).

#![allow(non_snake_case, non_camel_case_types, dead_code)]

use libloading::{Library, Symbol};
use std::ffi::{c_char, c_int, c_ulonglong, CStr, CString};
use std::path::PathBuf;

type FnCactusLoad = unsafe extern "C" fn(cact: *const u8, n: c_ulonglong) -> c_int;
type FnCactusLastError = unsafe extern "C" fn() -> *const c_char;
type FnCactusDescribe = unsafe extern "C" fn(
    rgb: *const u8,
    width: c_int,
    height: c_int,
    options: *const c_char,
    language: *const c_char,
    keywords: *const c_char,
    out: *mut c_char,
    out_capacity: c_int,
) -> c_int;

/// Default output buffer capacity (256 KB) for `cactus_describe` JSON output.
const DESCRIBE_OUT_CAPACITY: usize = 256 * 1024;

/// Loaded `libcactus` dynamic library handle and resolved symbols.
pub struct CactusLibrary {
    _lib: Library,
    pub path: PathBuf,
    fn_load: FnCactusLoad,
    fn_last_error: Option<FnCactusLastError>,
    fn_describe: FnCactusDescribe,
}

unsafe impl Send for CactusLibrary {}
unsafe impl Sync for CactusLibrary {}

impl CactusLibrary {
    /// Candidate shared-library filenames for the current OS.
    pub fn platform_lib_names() -> &'static [&'static str] {
        #[cfg(target_os = "macos")]
        {
            &["libcactus.dylib", "libmirage.dylib"]
        }
        #[cfg(target_os = "windows")]
        {
            &["cactus.dll", "libcactus.dll", "mirage.dll"]
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            &["libcactus.so", "libmirage.so"]
        }
    }

    /// Resolve candidate library paths in priority order.
    pub fn candidate_paths() -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        if let Ok(explicit) = std::env::var("PLETHORA_CACTUS_LIB") {
            let trimmed = explicit.trim();
            if !trimmed.is_empty() {
                candidates.push(PathBuf::from(trimmed));
            }
        }
        for name in Self::platform_lib_names() {
            candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(name));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for name in Self::platform_lib_names() {
                    candidates.push(dir.join(name));
                    candidates.push(dir.join("bin").join(name));
                    // Linux AppImage / .deb resource layout: usr/bin/exe -> usr/lib/<product>/bin/
                    candidates.push(dir.join("../lib/Plethora/bin").join(name));
                    candidates.push(dir.join("../lib/plethora-tauri/bin").join(name));
                    // macOS .app bundle resource layout: Contents/MacOS/exe -> Contents/Resources/bin/
                    candidates.push(dir.join("../Resources/bin").join(name));
                }
            }
        }
        if let Ok(cwd) = std::env::current_dir() {
            for name in Self::platform_lib_names() {
                candidates.push(cwd.join("src-tauri").join("bin").join(name));
                candidates.push(cwd.join("bin").join(name));
            }
        }
        // Standard soname lookup (resolves Android APK nativeLibraryDir & LD_LIBRARY_PATH)
        for name in Self::platform_lib_names() {
            candidates.push(PathBuf::from(name));
        }
        candidates
    }

    /// Attempt to dynamically load `libcactus` and resolve `cactus_load` + `cactus_describe`.
    pub fn load() -> Result<Self, String> {
        let mut errors = Vec::new();
        for path in Self::candidate_paths() {
            if path.is_absolute() && !path.exists() {
                continue;
            }
            match unsafe { Library::new(&path) } {
                Ok(lib) => match Self::bind_symbols(lib, path.clone()) {
                    Ok(bound) => return Ok(bound),
                    Err(e) => errors.push(format!("{}: {}", path.display(), e)),
                },
                Err(e) => errors.push(format!("{}: {}", path.display(), e)),
            }
        }
        Err(format!(
            "Could not load Cactus Compute native library (libcactus). Set PLETHORA_CACTUS_LIB or bundle {}. Details: {}",
            Self::platform_lib_names()[0],
            errors.into_iter().take(3).collect::<Vec<_>>().join("; ")
        ))
    }

    fn bind_symbols(lib: Library, path: PathBuf) -> Result<Self, String> {
        unsafe {
            let load_sym: Symbol<FnCactusLoad> = lib
                .get(b"cactus_load\0")
                .map_err(|e| format!("missing cactus_load: {e}"))?;
            let describe_sym: Symbol<FnCactusDescribe> = lib
                .get(b"cactus_describe\0")
                .map_err(|e| format!("missing cactus_describe: {e}"))?;
            let fn_load = *load_sym;
            let fn_describe = *describe_sym;
            let fn_last_error = lib
                .get::<FnCactusLastError>(b"cactus_last_error\0")
                .ok()
                .map(|s| *s);

            Ok(Self {
                _lib: lib,
                path,
                fn_load,
                fn_last_error,
                fn_describe,
            })
        }
    }

    fn last_error_string(&self) -> Option<String> {
        let f = self.fn_last_error?;
        let ptr = unsafe { f() };
        if ptr.is_null() {
            return None;
        }
        let s = unsafe { CStr::from_ptr(ptr) }
            .to_string_lossy()
            .trim()
            .to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }

    /// Load a `.cact` model buffer into the Cactus runtime.
    pub fn cactus_load_bytes(&self, cact_bytes: &[u8]) -> Result<(), String> {
        if cact_bytes.is_empty() {
            return Err("Empty .cact model buffer".to_string());
        }
        let rc = unsafe { (self.fn_load)(cact_bytes.as_ptr(), cact_bytes.len() as c_ulonglong) };
        if rc != 0 {
            let detail = self
                .last_error_string()
                .unwrap_or_else(|| format!("error code {rc}"));
            Err(format!("cactus_load failed: {detail}"))
        } else {
            Ok(())
        }
    }

    /// Run `cactus_describe` on a raw RGB24 buffer (`width * height * 3` bytes).
    pub fn cactus_describe(
        &self,
        rgb_data: &[u8],
        width: u32,
        height: u32,
        options_json: &str,
    ) -> Result<String, String> {
        let expected_len = (width as usize)
            .checked_mul(height as usize)
            .and_then(|px| px.checked_mul(3))
            .ok_or_else(|| "Image dimensions overflow RGB buffer size".to_string())?;
        if rgb_data.len() < expected_len {
            return Err(format!(
                "RGB buffer too small: got {} bytes, expected {} for {}x{}",
                rgb_data.len(),
                expected_len,
                width,
                height
            ));
        }

        let c_opts =
            CString::new(options_json).map_err(|e| format!("Invalid options JSON: {e}"))?;
        let mut out_buf = vec![0u8; DESCRIBE_OUT_CAPACITY];
        let rc = unsafe {
            (self.fn_describe)(
                rgb_data.as_ptr(),
                width as c_int,
                height as c_int,
                c_opts.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                out_buf.as_mut_ptr() as *mut c_char,
                out_buf.len() as c_int,
            )
        };
        if rc < 0 {
            let detail = self
                .last_error_string()
                .unwrap_or_else(|| format!("error code {rc}"));
            return Err(format!("cactus_describe failed: {detail}"));
        }
        let nul_pos = out_buf.iter().position(|&b| b == 0).unwrap_or(out_buf.len());
        let json_str = String::from_utf8_lossy(&out_buf[..nul_pos]).into_owned();
        if json_str.trim().is_empty() {
            return Err("cactus_describe returned empty output".to_string());
        }
        Ok(json_str)
    }
}
