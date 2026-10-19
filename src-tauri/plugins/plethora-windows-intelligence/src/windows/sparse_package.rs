//! Sparse package registration for NSIS / unpackaged installs.
//!
//! Registers a lightweight MSIX identity package so Windows AI APIs receive
//! package identity without replacing the NSIS installer.
//!
//! This module owns the platform parts — spawning PowerShell, querying the
//! current identity. The policy (which command, how to classify the result, what
//! to publish in diagnostics) lives in `crate::sparse_identity`, which is
//! compiled and unit-tested on every platform.
//!
//! Identity is attached when a process starts, so this is a *repair* path for
//! installs whose installer-time registration was skipped: its effect appears on
//! the next launch, never on the current one. It stays best effort — the app
//! runs without identity and reports `package_identity_missing` for the features
//! that need it.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use windows::Win32::Foundation::WIN32_ERROR;
use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
use windows::core::PWSTR;

use crate::sparse_identity::{
    RegistrationOutcome, RegistrationReport, add_appx_package_command, power_shell_args,
};
use crate::{Error, PACKAGE_IDENTITY_MISSING};

const SPARSE_MSIX_REL: &str = "windows/sparse/out/PlethoraIdentity.msix";

/// Last registration attempt, published through the diagnostics payload. The
/// decision to attempt one happens during capability probes, far from where
/// diagnostics are rendered.
static LAST_REPORT: Mutex<Option<RegistrationReport>> = Mutex::new(None);

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

/// Record and return a report so callers can both act on it and let diagnostics
/// see it later.
fn record(report: RegistrationReport) -> RegistrationReport {
    if let Ok(mut slot) = LAST_REPORT.lock() {
        *slot = Some(report.clone());
    }
    report
}

/// The last identity-registration attempt, if one happened in this process.
pub fn last_registration_report() -> Option<RegistrationReport> {
    LAST_REPORT.lock().ok().and_then(|slot| slot.clone())
}

/// Human-readable description of an attempt, used for the error surfaced to the
/// frontend. The raw OS text and its code are kept, never replaced by a generic
/// string: "package identity missing" alone is what made the 3.3.0 Windows AI
/// failures undiagnosable.
fn describe(report: &RegistrationReport) -> String {
    if let Some(reason) = &report.skipped_reason {
        return format!("Windows AI APIs require package identity ({reason}).");
    }
    let code = report
        .error_code
        .as_deref()
        .map(|code| format!(" [{code}]"))
        .unwrap_or_default();
    match (&report.error_message, report.outcome) {
        (Some(message), _) => format!("Sparse package registration failed{code}: {message}"),
        (None, RegistrationOutcome::AlreadyRegistered) => {
            "Sparse package identity is already registered; it takes effect on the next launch."
                .to_string()
        }
        _ => "Sparse package registration did not complete; it takes effect on the next launch."
            .to_string(),
    }
}

pub fn try_register_sparse_package() -> Result<Option<String>, Error> {
    if let Some(identity) = current_package_identity() {
        record(RegistrationReport::skipped(
            "package identity is already present",
        ));
        return Ok(Some(identity));
    }

    let external = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .filter(|d| d.is_dir());

    let msix = sparse_msix_candidates().into_iter().find(|p| p.is_file());
    let Some(msix) = msix else {
        record(
            RegistrationReport::skipped("identity package not found next to the executable")
                .with_paths(None, external.as_deref()),
        );
        return Ok(None);
    };
    let Some(external) = external else {
        record(
            RegistrationReport::skipped("executable directory could not be determined")
                .with_paths(Some(&msix), None),
        );
        return Ok(None);
    };

    // `Add-AppxPackage -Path <msix> -ExternalLocation <install dir>` is the
    // documented per-user registration (the identity package's certificate only
    // has to be trusted when it is signed by something other than a Microsoft or
    // enterprise root already present on the machine).
    let command = add_appx_package_command(&msix, &external);
    let report = match run_powershell(&command) {
        Ok(output) => {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            RegistrationReport::from_process_result(
                &msix,
                &external,
                output.status.success(),
                &combined,
            )
        }
        Err(error) => RegistrationReport {
            attempted: true,
            outcome: RegistrationOutcome::Failed,
            skipped_reason: None,
            msix_path: Some(msix.display().to_string()),
            external_location: Some(external.display().to_string()),
            error_code: None,
            error_message: Some(format!("failed to spawn powershell.exe: {error}")),
        },
    };
    let report = record(report);

    if report.is_ok() {
        // Identity is attached at process start, so the freshly registered
        // package is visible from the next launch, not this one.
        Ok(current_package_identity())
    } else {
        Err(Error::new(PACKAGE_IDENTITY_MISSING, describe(&report)))
    }
}

fn run_powershell(command: &str) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;

    // CREATE_NO_WINDOW: the repair path runs from a capability probe inside a GUI
    // app, so a console window would flash on screen every time it is triggered.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut child = Command::new("powershell.exe");
    child.args(power_shell_args(command)).creation_flags(CREATE_NO_WINDOW);
    child.output()
}

pub fn current_package_identity() -> Option<String> {
    let mut len = 0u32;
    unsafe {
        // windows 0.58: returns WIN32_ERROR instead of Result; PWSTR::null()
        // queries the required buffer length. Any failure means "no package
        // identity" for our purposes (unpackaged installs are supported).
        if GetCurrentPackageFullName(&mut len, PWSTR::null()) != WIN32_ERROR(0) || len == 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        if GetCurrentPackageFullName(&mut len, PWSTR(buf.as_mut_ptr())) != WIN32_ERROR(0) {
            return None;
        }
        let end = len.saturating_sub(1) as usize;
        let name = String::from_utf16_lossy(&buf[..end]);
        if name.is_empty() {
            None
        } else {
            Some(name)
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
    // `try_register_sparse_package` already recorded the specific reason; report
    // the most recent one so the caller sees the OS code instead of a generic
    // "install the sparse identity package" hint.
    match last_registration_report() {
        Some(report) => Err(Error::new(PACKAGE_IDENTITY_MISSING, describe(&report))),
        None => Err(Error::new(
            PACKAGE_IDENTITY_MISSING,
            "Windows AI APIs require package identity. Install the sparse identity package or use the MSIX build.",
        )),
    }
}
