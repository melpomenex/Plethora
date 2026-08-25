//! Windows desktop probes and command dispatch.

use windows::Win32::System::ApplicationInstallationAndServicing::GetCurrentPackageFullName;
use windows::Win32::System::SystemInformation::{RtlGetVersion, OSVERSIONINFOEXW};
use windows::core::HRESULT;

use crate::{Error, FeatureState, WindowsIntelligenceSnapshot, PACKAGE_IDENTITY_MISSING, UNSUPPORTED_OS};
use crate::winrt;

/// Windows 11 24H2 (build 26100) minimum for stable Windows AI APIs.
pub const MIN_WIN11_AI_BUILD: u32 = 26100;

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Returns package full name when running inside an MSIX/AppX identity.
pub fn current_package_identity() -> Option<String> {
    let mut len = 0u32;
    unsafe {
        let _ = GetCurrentPackageFullName(&mut len, None);
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        match GetCurrentPackageFullName(&mut len, Some(buf.as_mut_ptr())) {
            Ok(()) => {
                let end = len.saturating_sub(1) as usize;
                let name = String::from_utf16_lossy(&buf[..end]);
                if name.is_empty() {
                    None
                } else {
                    Some(name)
                }
            }
            Err(e) if e.code() == HRESULT::from(windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE) => {
                None
            }
            Err(_) => None,
        }
    }
}

/// Authoritative OS build number via RtlGetVersion (not the deprecated GetVersion).
pub fn windows_build_number() -> Option<u32> {
    let mut info = OSVERSIONINFOEXW {
        dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOEXW>() as u32,
        ..Default::default()
    };
    unsafe {
        if RtlGetVersion(&mut info as *mut _ as *mut _).is_err() {
            return None;
        }
    }
    Some(info.dwBuildNumber)
}

pub fn meets_ai_os_requirement() -> bool {
    windows_build_number()
        .map(|build| build >= MIN_WIN11_AI_BUILD)
        .unwrap_or(false)
}

pub fn capabilities_snapshot() -> WindowsIntelligenceSnapshot {
    let package_identity = current_package_identity();
    let has_identity = package_identity.is_some();
    let os_ok = meets_ai_os_requirement();
    let platform_ready = has_identity && os_ok;

    WindowsIntelligenceSnapshot {
        windows_os: true,
        package_identity,
        language_model: if !has_identity {
            FeatureState::unavailable(PACKAGE_IDENTITY_MISSING)
        } else if !os_ok {
            FeatureState::unavailable(UNSUPPORTED_OS)
        } else {
            winrt::language_model_feature_state(platform_ready)
        },
        ocr: if !has_identity {
            FeatureState::unavailable(PACKAGE_IDENTITY_MISSING)
        } else if !os_ok {
            FeatureState::unavailable(UNSUPPORTED_OS)
        } else {
            winrt::ocr_feature_state(platform_ready)
        },
        image_description: if !has_identity {
            FeatureState::unavailable(PACKAGE_IDENTITY_MISSING)
        } else if !os_ok {
            FeatureState::unavailable(UNSUPPORTED_OS)
        } else {
            winrt::image_description_feature_state(platform_ready)
        },
        embeddings: if !has_identity {
            FeatureState::unavailable(PACKAGE_IDENTITY_MISSING)
        } else if !os_ok {
            FeatureState::unavailable(UNSUPPORTED_OS)
        } else {
            winrt::embeddings_feature_state(platform_ready)
        },
        checked_at: now_ms(),
    }
}

pub fn lm_generate(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    preflight_inference()?;
    winrt::generate(payload)
}

pub fn lm_generate_stream(
    app: tauri::AppHandle<tauri::Wry>,
    payload: serde_json::Value,
) -> Result<serde_json::Value, Error> {
    preflight_inference()?;
    winrt::generate_stream(app, payload)
}

pub fn lm_cancel(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    winrt::cancel(payload)
}

pub fn lm_warmup(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    preflight_inference()?;
    winrt::warmup(payload)
}

pub fn lm_ensure_ready(payload: serde_json::Value) -> Result<serde_json::Value, Error> {
    preflight_inference()?;
    winrt::ensure_ready(payload)
}

pub fn ocr_status() -> Result<serde_json::Value, Error> {
    if current_package_identity().is_none() {
        return Ok(serde_json::json!({
            "status": "unavailable",
            "reason": PACKAGE_IDENTITY_MISSING,
        }));
    }
    if !meets_ai_os_requirement() {
        return Ok(serde_json::json!({
            "status": "unavailable",
            "reason": UNSUPPORTED_OS,
        }));
    }
    winrt::ocr_status()
}

fn preflight_inference() -> Result<(), Error> {
    if current_package_identity().is_none() {
        return Err(Error::new(
            PACKAGE_IDENTITY_MISSING,
            "Windows AI APIs require MSIX package identity",
        ));
    }
    if !meets_ai_os_requirement() {
        return Err(Error::new(
            UNSUPPORTED_OS,
            format!("Windows 11 build {MIN_WIN11_AI_BUILD}+ is required for Windows AI APIs"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_reports_windows_os() {
        let snap = capabilities_snapshot();
        assert!(snap.windows_os);
        assert!(snap.checked_at > 0);
    }
}
