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
        pub fn plethora_phi_try_unlock_laf(
            feature_id_utf8: *const c_char,
            token_utf8: *const c_char,
            attestation_utf8: *const c_char,
        ) -> c_int;
        pub fn plethora_ocr_get_ready_state() -> c_int;
        pub fn plethora_ocr_recognize_image(
            image_data: *const u8,
            image_len: c_uint,
            out_buf: *mut c_char,
            out_buf_len: c_uint,
            err_buf: *mut c_char,
            err_buf_len: c_uint,
        ) -> c_int;
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

    pub fn get_ocr_ready_state() -> Option<i32> {
        let v = ffi::plethora_ocr_get_ready_state();
        if v < 0 {
            None
        } else {
            Some(v)
        }
    }

    pub fn try_unlock_laf(feature_id: &str, token: &str, attestation: &str) -> Option<i32> {
        if !bridge_available() {
            return None;
        }
        let feature = std::ffi::CString::new(feature_id).ok()?;
        let token_c = std::ffi::CString::new(token).ok()?;
        let attestation_c = std::ffi::CString::new(attestation).ok()?;
        let rc = ffi::plethora_phi_try_unlock_laf(
            feature.as_ptr(),
            token_c.as_ptr(),
            attestation_c.as_ptr(),
        );
        if rc < 0 {
            None
        } else {
            Some(rc)
        }
    }

    pub fn generate(prompt: &str, max_tokens: u32) -> Result<String, String> {
        let prompt_c = std::ffi::CString::new(prompt).map_err(|_| "invalid_argument".to_string())?;
        let mut out = vec![0u8; 64 * 1024];
        let mut err = vec![0u8; 512];
        let rc = ffi::plethora_phi_generate(
            prompt_c.as_ptr(),
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

    pub fn recognize_image(image_data: &[u8]) -> Result<String, String> {
        if !bridge_available() {
            return Err("winrt_bindings_pending".into());
        }
        let mut out = vec![0u8; 512 * 1024];
        let mut err = vec![0u8; 512];
        let rc = ffi::plethora_ocr_recognize_image(
            image_data.as_ptr(),
            image_data.len() as c_uint,
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
    pub fn get_ocr_ready_state() -> Option<i32> {
        None
    }
    pub fn try_unlock_laf(_feature_id: &str, _token: &str, _attestation: &str) -> Option<i32> {
        None
    }
    pub fn generate(_prompt: &str, _max_tokens: u32) -> Result<String, String> {
        Err("winrt_bindings_pending".into())
    }
    pub fn recognize_image(_image_data: &[u8]) -> Result<String, String> {
        Err("winrt_bindings_pending".into())
    }
}

pub use ffi::*;
