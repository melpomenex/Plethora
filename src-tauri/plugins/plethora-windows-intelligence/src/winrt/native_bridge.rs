//! FFI to the C++/WinRT Phi Silica bridge (when compiled).

#[cfg(target_os = "windows")]
mod ffi {
    use std::os::raw::{c_char, c_int, c_uint};

    extern "C" {
        pub fn plethora_phi_bridge_available() -> c_int;
        pub fn plethora_phi_get_ready_state() -> c_int;
        pub fn plethora_phi_generate(
            prompt_utf8: *const c_char,
            max_output_tokens: c_uint,
            out_buf: *mut c_char,
            out_buf_len: c_uint,
            err_buf: *mut c_char,
            err_buf_len: c_uint,
        ) -> c_int;
        pub fn plethora_phi_cancel(request_id_utf8: *const c_char) -> c_int;
    }

    pub fn bridge_available() -> bool {
        ffi::plethora_phi_bridge_available() != 0
    }

    pub fn get_ready_state() -> Option<i32> {
        let v = ffi::plethora_phi_get_ready_state();
        if v < 0 {
            None
        } else {
            Some(v)
        }
    }

    pub fn generate(prompt: &str, max_tokens: u32) -> Result<String, String> {
        let mut out = vec![0u8; 64 * 1024];
        let mut err = vec![0u8; 512];
        let rc = ffi::plethora_phi_generate(
            prompt.as_ptr() as *const c_char,
            max_tokens,
            out.as_mut_ptr() as *mut c_char,
            out.len() as c_uint,
            err.as_mut_ptr() as *mut c_char,
            err.len() as c_uint,
        );
        if rc == 0 {
            let nul = out.iter().position(|&b| b == 0).unwrap_or(out.len());
            Ok(String::from_utf8_lossy(&out[..nul]).to_string())
        } else {
            let nul = err.iter().position(|&b| b == 0).unwrap_or(err.len());
            Err(String::from_utf8_lossy(&err[..nul]).to_string())
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod ffi {
    pub fn bridge_available() -> bool {
        false
    }
    pub fn get_ready_state() -> Option<i32> {
        None
    }
    pub fn generate(_prompt: &str, _max_tokens: u32) -> Result<String, String> {
        Err("winrt_bindings_pending".into())
    }
}

pub use ffi::*;
