//! Windows desktop probes and command dispatch.

use crate::{Error, FeatureState, WindowsIntelligenceSnapshot, PACKAGE_IDENTITY_MISSING, UNSUPPORTED_OS};
use crate::winrt;

mod sparse_package;

pub use sparse_package::{current_package_identity, try_register_sparse_package};

/// Windows 11 24H2 (build 26100) minimum for stable Windows AI APIs.
pub const MIN_WIN11_AI_BUILD: u32 = 26100;

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn meets_ai_os_requirement() -> bool {
    use windows::Win32::System::SystemInformation::{RtlGetVersion, OSVERSIONINFOEXW};
    let mut info = OSVERSIONINFOEXW {
        dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOEXW>() as u32,
        ..Default::default()
    };
    unsafe {
        if RtlGetVersion(&mut info as *mut _ as *mut _).is_err() {
            return false;
        }
    }
    info.dwBuildNumber >= MIN_WIN11_AI_BUILD
}

pub fn capabilities_snapshot() -> WindowsIntelligenceSnapshot {
    if current_package_identity().is_none() {
        let _ = try_register_sparse_package();
    }
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
    sparse_package::ensure_package_identity().map_err(|e| {
        if e.code == PACKAGE_IDENTITY_MISSING {
            e
        } else {
            Error::new(PACKAGE_IDENTITY_MISSING, e.message)
        }
    })?;
    if !meets_ai_os_requirement() {
        return Err(Error::new(
            UNSUPPORTED_OS,
            format!("Windows 11 build {MIN_WIN11_AI_BUILD}+ is required for Windows AI APIs"),
        ));
    }
    Ok(())
}

pub fn lm_diagnostics() -> serde_json::Value {
    let snap = capabilities_snapshot();
    serde_json::json!({
        "windowsOs": snap.windows_os,
        "packageIdentity": snap.package_identity,
        "languageModel": snap.language_model,
        "ocr": snap.ocr,
        "osMeetsMinimum": meets_ai_os_requirement(),
        "phiBridgeAvailable": winrt::bridge_available(),
        "phiReadyState": winrt::get_ready_state(),
        "ocrReadyState": winrt::get_ocr_ready_state(),
        "lafTokenConfigured": std::env::var(winrt::LAF_TOKEN_ENV)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        "lafAttestationConfigured": std::env::var(winrt::LAF_ATTESTATION_ENV)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        "sparseMsixCandidates": sparse_package::sparse_msix_candidates()
            .into_iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>(),
        "checkedAt": snap.checked_at,
    })
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
