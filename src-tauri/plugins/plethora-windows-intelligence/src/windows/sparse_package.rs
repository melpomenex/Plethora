//! Sparse package registration for NSIS / unpackaged installs.
//!
//! Registers a lightweight MSIX identity package so Windows AI APIs receive
//! package identity without replacing the NSIS installer.

use std::path::{Path, PathBuf};
use std::process::Command;

use windows::Win32::System::ApplicationInstallationAndServicing::GetCurrentPackageFullName;
use windows::core::HRESULT;

use crate::{Error, PACKAGE_IDENTITY_MISSING};

const SPARSE_MSIX_REL: &str = "windows/sparse/out/PlethoraIdentity.msix";

pub fn sparse_msix_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("PlethoraIdentity.msix"));
            paths.push(dir.join("sparse").join("PlethoraIdentity.msix"));
            paths.push(dir.join("resources").join("PlethoraIdentity.msix"));
        }
    }
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let manifest_root = PathBuf::from(manifest_dir);
        if let Some(src_tauri) = manifest_root.parent() {
            paths.push(src_tauri.join(SPARSE_MSIX_REL));
        }
    }
    paths
}

pub fn try_register_sparse_package() -> Result<Option<String>, Error> {
    if current_package_identity().is_some() {
        return Ok(current_package_identity());
    }
    let msix = sparse_msix_candidates()
        .into_iter()
        .find(|p| p.is_file());
    if msix.is_none() {
        return Ok(None);
    }
    let msix = msix.unwrap();
    let external = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .filter(|d| d.is_dir());
    if external.is_none() {
        return Ok(None);
    }
    let external = external.unwrap();
    let msix_uri = format!("file:///{}", msix.display().to_string().replace('\\', "/"));
    let external_uri = format!(
        "file:///{}",
        external.display().to_string().replace('\\', "/")
    );

    // Prefer PowerShell Add-AppxPackage — stable on Win10+ without extra WinRT wiring.
    let ps = format!(
        "$ErrorActionPreference='Stop'; \
         $opt = New-Object -TypeName Microsoft.Windows.Management.Deployment.AddPackageOptions; \
         $opt.ExternalLocationUri = '{external_uri}'; \
         $pm = New-Object -TypeName Windows.Management.Deployment.PackageManager; \
         $pm.AddPackageByUriAsync([Uri]'{msix_uri}', $opt).GetAwaiter().GetResult();"
    );
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &ps,
        ])
        .output();
    match output {
        Ok(o) if o.status.success() => Ok(current_package_identity()),
        Ok(o) => {
            let msg = String::from_utf8_lossy(&o.stderr);
            Err(Error::new(
                PACKAGE_IDENTITY_MISSING,
                format!("Sparse package registration failed: {}", msg.trim()),
            ))
        }
        Err(e) => Err(Error::new(
            PACKAGE_IDENTITY_MISSING,
            format!("Failed to spawn PowerShell for sparse registration: {e}"),
        )),
    }
}

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

pub fn ensure_package_identity() -> Result<(), Error> {
    if current_package_identity().is_some() {
        return Ok(());
    }
    if let Ok(Some(_)) = try_register_sparse_package() {
        return Ok(());
    }
    Err(Error::new(
        PACKAGE_IDENTITY_MISSING,
        "Windows AI APIs require package identity. Install the sparse identity package or use the MSIX build.",
    ))
}
