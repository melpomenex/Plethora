//! macOS desktop FFI bridge to Swift FoundationModels.

#![cfg(target_os = "macos")]

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use tauri::{AppHandle, Emitter, Wry};

use crate::Error;

type StreamCb = unsafe extern "C" fn(*const c_char, *const c_char, *mut std::ffi::c_void);

extern "C" {
    fn plethora_fm_availability() -> *mut c_char;
    fn plethora_fm_generate(args_json: *const c_char) -> *mut c_char;
    fn plethora_fm_generate_stream(
        args_json: *const c_char,
        cb: Option<StreamCb>,
        ctx: *mut std::ffi::c_void,
    ) -> *mut c_char;
    fn plethora_fm_cancel(args_json: *const c_char) -> *mut c_char;
    fn plethora_fm_count_tokens(args_json: *const c_char) -> *mut c_char;
    fn plethora_fm_warmup() -> *mut c_char;
    fn plethora_translate_sentence(args_json: *const c_char) -> *mut c_char;
    fn plethora_fm_free_string(s: *mut c_char);
}

struct StreamCtx {
    app: AppHandle<Wry>,
}

unsafe extern "C" fn stream_callback(
    event_type: *const c_char,
    payload_json: *const c_char,
    ctx: *mut std::ffi::c_void,
) {
    if event_type.is_null() || payload_json.is_null() || ctx.is_null() {
        return;
    }
    let event = CStr::from_ptr(event_type).to_string_lossy();
    let payload_str = CStr::from_ptr(payload_json).to_string_lossy();
    let payload: serde_json::Value =
        serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null);
    let ctx = &*(ctx as *const StreamCtx);
    let channel = match event.as_ref() {
        "text" => "apple-fm://text",
        "complete" => "apple-fm://complete",
        "error" => "apple-fm://error",
        _ => return,
    };
    let _ = ctx.app.emit(channel, payload);
}

fn take_string(ptr: *mut c_char) -> Result<String, Error> {
    if ptr.is_null() {
        return Err(Error::new(
            "inference_failed",
            "Native bridge returned null",
        ));
    }
    let s = unsafe {
        let cstr = CStr::from_ptr(ptr);
        let out = cstr.to_string_lossy().into_owned();
        plethora_fm_free_string(ptr);
        out
    };
    Ok(s)
}

fn json_value_or_error(json: &str) -> Result<serde_json::Value, Error> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|e| {
        Error::new("inference_failed", format!("Invalid native JSON: {e}"))
    })?;
    if let Some(code) = value.get("code").and_then(|c| c.as_str()) {
        let message = value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or(code);
        return Err(Error::new(code, message));
    }
    Ok(value)
}

pub fn fm_availability_with_payload(_payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    fm_availability()
}

pub fn fm_availability() -> Result<serde_json::Value, Error> {
    let ptr = unsafe { plethora_fm_availability() };
    let json = take_string(ptr)?;
    json_value_or_error(&json)
}

pub fn fm_generate(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    let args = CString::new(payload.to_string()).map_err(|e| Error::new("invalid_argument", e.to_string()))?;
    let ptr = unsafe { plethora_fm_generate(args.as_ptr()) };
    let json = take_string(ptr)?;
    json_value_or_error(&json)
}

pub fn fm_generate_stream(
    app: AppHandle<Wry>,
    payload: serde_json::Value,
) -> Result<serde_json::Value, Error> {
    let args = CString::new(payload.to_string()).map_err(|e| Error::new("invalid_argument", e.to_string()))?;
    let ctx = StreamCtx { app };
    let ctx_box = Box::new(ctx);
    let ctx_ptr = Box::into_raw(ctx_box) as *mut std::ffi::c_void;
    let ptr = unsafe {
        plethora_fm_generate_stream(args.as_ptr(), Some(stream_callback), ctx_ptr)
    };
    // Reclaim context box
    unsafe {
        drop(Box::from_raw(ctx_ptr as *mut StreamCtx));
    }
    if ptr.is_null() {
        return Ok(serde_json::json!({ "ok": true }));
    }
    let json = take_string(ptr)?;
    json_value_or_error(&json)
}

pub fn fm_cancel(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    let args = CString::new(payload.to_string()).map_err(|e| Error::new("invalid_argument", e.to_string()))?;
    let ptr = unsafe { plethora_fm_cancel(args.as_ptr()) };
    let json = take_string(ptr)?;
    Ok(serde_json::from_str(&json).unwrap_or(serde_json::json!({ "ok": true })))
}

pub fn fm_count_tokens(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    let args = CString::new(payload.to_string()).map_err(|e| Error::new("invalid_argument", e.to_string()))?;
    let ptr = unsafe { plethora_fm_count_tokens(args.as_ptr()) };
    let json = take_string(ptr)?;
    json_value_or_error(&json)
}

pub fn fm_warmup_with_payload(_payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    fm_warmup()
}

pub fn fm_warmup() -> Result<serde_json::Value, Error> {
    let ptr = unsafe { plethora_fm_warmup() };
    let json = take_string(ptr)?;
    Ok(serde_json::from_str(&json).unwrap_or(serde_json::json!({ "ok": true })))
}

pub fn translate_sentence(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    let wrapped = if payload.get("request").is_some() {
        payload
    } else {
        serde_json::json!({ "request": payload })
    };
    let args = CString::new(wrapped.to_string())
        .map_err(|e| Error::new("invalid_argument", e.to_string()))?;
    let ptr = unsafe { plethora_translate_sentence(args.as_ptr()) };
    let json = take_string(ptr)?;
    json_value_or_error(&json)
}

pub fn fm_capabilities_snapshot() -> Result<crate::AppleIntelligenceSnapshot, Error> {
    let avail = fm_availability()?;
    let status = avail
        .get("status")
        .and_then(|s| s.as_str())
        .unwrap_or("unavailable")
        .to_string();
    let reason = avail.get("reason").and_then(|r| r.as_str()).map(String::from);
    let foundation = crate::FeatureState {
        status: status.clone(),
        reason: reason.clone(),
    };
    let unavailable = crate::FeatureState::unavailable("not_implemented");
    Ok(crate::AppleIntelligenceSnapshot {
        apple_os: true,
        foundation_models: foundation,
        foundation_reason: reason,
        speech: unavailable.clone(),
        vision_documents: unavailable.clone(),
        spotlight_semantic: unavailable.clone(),
        natural_language_embeddings: unavailable.clone(),
        core_ai: unavailable,
        checked_at: crate::now_ms(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn availability_returns_json_shape() {
        let result = fm_availability();
        if let Ok(v) = result {
            assert!(v.get("status").is_some());
        }
    }
}
