//! Managed Nougat OCR runtime.
//!
//! Nougat is distributed as a Python package rather than a native desktop
//! installer.  Installing it into an arbitrary system Python is brittle (and
//! can modify an environment owned by the user), so Incrementum provisions an
//! isolated Python 3.10 virtual environment inside its app-data directory.
//! A pinned, checksum-verified `uv` bootstrapper supplies Python and installs
//! the official `nougat-ocr` package.

use crate::error::{IncrementumError, Result};
use crate::ocr::providers::{nougat_executable_is_runnable, resolve_nougat_executables};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;

const UV_VERSION: &str = "0.11.32";
const NOUGAT_PACKAGE: &str = "nougat-ocr==0.1.17";
const NOUGAT_REQUIREMENTS: &[&str] = &[
    "numpy<2",
    // The published 0.1.17 wheel predates these upper bounds, but the
    // official Nougat repository now carries them for compatibility.
    "transformers<=4.38.2",
    "albumentations<=1.4.24",
    // Nougat 0.1.17 calls PdfDocument.render(), which was removed in
    // pypdfium2 5.0.
    "pypdfium2<5",
    NOUGAT_PACKAGE,
];
const UV_INSTALLER_MAX_BYTES: usize = 1_000_000;

#[cfg(not(target_os = "windows"))]
const UV_INSTALLER_URL: &str = "https://astral.sh/uv/0.11.32/install.sh";
#[cfg(not(target_os = "windows"))]
const UV_INSTALLER_SHA256: &str =
    "43aff33a967fe40e8c17949d8c85c65bc43f3b5c94742393c957f56ab5ba80f4";

#[cfg(target_os = "windows")]
const UV_INSTALLER_URL: &str = "https://astral.sh/uv/0.11.32/install.ps1";
#[cfg(target_os = "windows")]
const UV_INSTALLER_SHA256: &str =
    "d84b0d973693497f8c1c1d82b2d2f52e32e50c7c24efa3d925341bd6fc5238b2";

static NOUGAT_INSTALL_LOCK: OnceLock<TokioMutex<()>> = OnceLock::new();

fn install_lock() -> &'static TokioMutex<()> {
    NOUGAT_INSTALL_LOCK.get_or_init(|| TokioMutex::new(()))
}

#[derive(Debug, Serialize, Clone)]
pub struct NougatRuntimeStatus {
    pub supported: bool,
    pub installed: bool,
    pub managed: bool,
    pub repair_required: bool,
    pub executable_path: Option<String>,
    pub install_root: Option<String>,
    pub package: String,
    pub detail: Option<String>,
}

fn runtime_root(app_handle: &AppHandle) -> Result<PathBuf> {
    let app_dir = app_handle.path().app_data_dir().map_err(|error| {
        IncrementumError::Internal(format!("Failed to resolve app data directory: {error}"))
    })?;
    Ok(app_dir.join("ocr").join("nougat-runtime"))
}

fn managed_uv_binary(root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        root.join("uv").join("uv.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        root.join("uv").join("uv")
    }
}

fn managed_python_binary(root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        root.join("venv").join("Scripts").join("python.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        root.join("venv").join("bin").join("python")
    }
}

fn managed_nougat_binary(root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        root.join("venv").join("Scripts").join("nougat.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        root.join("venv").join("bin").join("nougat")
    }
}

fn managed_nougat_dependencies_are_compatible(root: &Path) -> bool {
    std::process::Command::new(managed_python_binary(root))
        .args([
            "-c",
            "import pypdfium2; assert hasattr(pypdfium2.PdfDocument, 'render')",
        ])
        .output()
        .is_ok_and(|output| output.status.success())
}

fn emit_progress(app_handle: &AppHandle, stage: &str, progress: u8, message: &str) {
    let _ = app_handle.emit(
        "nougat://install-progress",
        serde_json::json!({
            "stage": stage,
            "progress": progress,
            "message": message,
        }),
    );
}

fn tail_output(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes).replace('\r', "");
    let tail: String = text.chars().rev().take(4_000).collect();
    tail.chars().rev().collect::<String>().trim().to_string()
}

async fn run_checked(command: &mut Command, label: &str) -> Result<()> {
    command.stdin(Stdio::null());
    let output = command
        .output()
        .await
        .map_err(|error| IncrementumError::Internal(format!("Failed to start {label}: {error}")))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = tail_output(&output.stderr);
    let stdout = tail_output(&output.stdout);
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    Err(IncrementumError::Internal(format!(
        "{label} failed with status {}{}",
        output.status,
        if detail.is_empty() {
            String::new()
        } else {
            format!(": {detail}")
        }
    )))
}

async fn download_verified_installer(app_handle: &AppHandle, root: &Path) -> Result<PathBuf> {
    emit_progress(
        app_handle,
        "downloading-installer",
        5,
        "Downloading the managed runtime installer…",
    );

    let installer_dir = root.join("installers");
    tokio::fs::create_dir_all(&installer_dir)
        .await
        .map_err(|error| {
            IncrementumError::Internal(format!(
                "Failed to create Nougat installer directory: {error}"
            ))
        })?;

    #[cfg(target_os = "windows")]
    let installer_path = installer_dir.join(format!("uv-{UV_VERSION}-install.ps1"));
    #[cfg(not(target_os = "windows"))]
    let installer_path = installer_dir.join(format!("uv-{UV_VERSION}-install.sh"));
    let temporary_path = installer_path.with_extension("download");

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| {
            IncrementumError::Internal(format!(
                "Failed to create the Nougat installer client: {error}"
            ))
        })?
        .get(UV_INSTALLER_URL)
        .send()
        .await
        .map_err(|error| {
            IncrementumError::Internal(format!("Failed to download the Nougat installer: {error}"))
        })?;

    if !response.status().is_success() {
        return Err(IncrementumError::Internal(format!(
            "Nougat installer download failed with HTTP {}",
            response.status()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > UV_INSTALLER_MAX_BYTES)
    {
        return Err(IncrementumError::Internal(
            "Nougat installer download was unexpectedly large".to_string(),
        ));
    }

    let mut file = tokio::fs::File::create(&temporary_path)
        .await
        .map_err(|error| {
            IncrementumError::Internal(format!(
                "Failed to create the Nougat installer file: {error}"
            ))
        })?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0usize;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            IncrementumError::Internal(format!("Nougat installer download failed: {error}"))
        })?;
        downloaded = downloaded.saturating_add(chunk.len());
        if downloaded > UV_INSTALLER_MAX_BYTES {
            let _ = tokio::fs::remove_file(&temporary_path).await;
            return Err(IncrementumError::Internal(
                "Nougat installer download exceeded the safety limit".to_string(),
            ));
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|error| {
            IncrementumError::Internal(format!("Failed to write the Nougat installer: {error}"))
        })?;
    }
    file.flush().await.map_err(|error| {
        IncrementumError::Internal(format!("Failed to finalize the Nougat installer: {error}"))
    })?;
    drop(file);

    let digest = hex::encode(hasher.finalize());
    if digest != UV_INSTALLER_SHA256 {
        let _ = tokio::fs::remove_file(&temporary_path).await;
        return Err(IncrementumError::Internal(format!(
            "Nougat installer checksum mismatch (expected {UV_INSTALLER_SHA256}, received {digest})"
        )));
    }

    if tokio::fs::try_exists(&installer_path)
        .await
        .unwrap_or(false)
    {
        tokio::fs::remove_file(&installer_path)
            .await
            .map_err(|error| {
                IncrementumError::Internal(format!(
                    "Failed to replace the previous Nougat installer: {error}"
                ))
            })?;
    }
    tokio::fs::rename(&temporary_path, &installer_path)
        .await
        .map_err(|error| {
            IncrementumError::Internal(format!("Failed to save the Nougat installer: {error}"))
        })?;
    Ok(installer_path)
}

async fn install_uv(app_handle: &AppHandle, root: &Path, installer_path: &Path) -> Result<PathBuf> {
    emit_progress(
        app_handle,
        "installing-manager",
        15,
        "Installing the isolated runtime manager…",
    );
    let uv_dir = root.join("uv");
    tokio::fs::create_dir_all(&uv_dir).await.map_err(|error| {
        IncrementumError::Internal(format!(
            "Failed to create the managed runtime directory: {error}"
        ))
    })?;

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(installer_path);
        command
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = Command::new("/bin/sh");
        command.arg(installer_path);
        command
    };

    command
        .env("UV_UNMANAGED_INSTALL", &uv_dir)
        .env("UV_NO_MODIFY_PATH", "1");
    run_checked(&mut command, "uv installer").await?;

    let uv_binary = managed_uv_binary(root);
    if !tokio::fs::try_exists(&uv_binary).await.unwrap_or(false) {
        return Err(IncrementumError::Internal(format!(
            "The runtime manager completed but {} was not created",
            uv_binary.display()
        )));
    }
    Ok(uv_binary)
}

fn configure_uv_command(command: &mut Command, root: &Path) {
    command
        .env("UV_CACHE_DIR", root.join("cache"))
        .env("UV_PYTHON_INSTALL_DIR", root.join("python"))
        .env("UV_NO_PROGRESS", "1")
        .env("UV_ISOLATED", "1");
}

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
pub async fn install_managed_nougat(app_handle: AppHandle) -> Result<NougatRuntimeStatus> {
    let _guard = install_lock().try_lock().map_err(|_| {
        IncrementumError::Internal("A Nougat installation is already running".to_string())
    })?;
    let root = runtime_root(&app_handle)?;
    tokio::fs::create_dir_all(&root).await.map_err(|error| {
        IncrementumError::Internal(format!(
            "Failed to create the Nougat runtime directory: {error}"
        ))
    })?;

    let installer_path = download_verified_installer(&app_handle, &root).await?;
    let uv_binary = install_uv(&app_handle, &root, &installer_path).await?;

    emit_progress(
        &app_handle,
        "installing-python",
        30,
        "Checking the isolated Python 3.10 runtime…",
    );
    let venv_dir = root.join("venv");
    let python_binary = managed_python_binary(&root);
    let environment_is_healthy = if tokio::fs::try_exists(&python_binary).await.unwrap_or(false) {
        Command::new(&python_binary)
            .arg("--version")
            .output()
            .await
            .is_ok_and(|output| output.status.success())
    } else {
        false
    };
    if !environment_is_healthy {
        emit_progress(
            &app_handle,
            "installing-python",
            35,
            "Downloading an isolated Python 3.10 runtime…",
        );
        let mut create_environment = Command::new(&uv_binary);
        create_environment
            .args(["venv", "--clear", "--python", "3.10", "--managed-python"])
            .arg(&venv_dir);
        configure_uv_command(&mut create_environment, &root);
        run_checked(&mut create_environment, "Python 3.10 setup").await?;
    }

    emit_progress(
        &app_handle,
        "installing-package",
        55,
        "Installing Nougat and its OCR dependencies…",
    );
    let mut install_package = Command::new(&uv_binary);
    install_package
        .args(["pip", "install", "--python"])
        .arg(&python_binary)
        .arg("--upgrade")
        .args(NOUGAT_REQUIREMENTS);
    configure_uv_command(&mut install_package, &root);
    run_checked(&mut install_package, "Nougat package installation").await?;

    emit_progress(
        &app_handle,
        "verifying",
        92,
        "Verifying the Nougat executable…",
    );
    let executable = managed_nougat_binary(&root);
    let verified = tokio::task::spawn_blocking({
        let executable = executable.clone();
        let root = root.clone();
        move || {
            nougat_executable_is_runnable(&executable)
                && managed_nougat_dependencies_are_compatible(&root)
        }
    })
    .await
    .unwrap_or(false);
    if !verified {
        return Err(IncrementumError::Internal(format!(
            "Nougat was installed but {} did not start successfully",
            executable.display()
        )));
    }

    emit_progress(
        &app_handle,
        "complete",
        100,
        "Nougat is installed and ready.",
    );
    Ok(NougatRuntimeStatus {
        supported: true,
        installed: true,
        managed: true,
        repair_required: false,
        executable_path: Some(executable.to_string_lossy().to_string()),
        install_root: Some(root.to_string_lossy().to_string()),
        package: NOUGAT_PACKAGE.to_string(),
        detail: Some(
            "The model checkpoint will download automatically the first time Nougat runs."
                .to_string(),
        ),
    })
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub async fn install_managed_nougat(_app_handle: AppHandle) -> Result<NougatRuntimeStatus> {
    Err(IncrementumError::Internal(
        "Managed Nougat installation is available on desktop only".to_string(),
    ))
}

pub async fn get_nougat_runtime_status(
    app_handle: &AppHandle,
    configured_path: Option<String>,
) -> Result<NougatRuntimeStatus> {
    let root = runtime_root(app_handle)?;
    let mut candidates = resolve_nougat_executables(configured_path.as_deref());
    let managed_executable = managed_nougat_binary(&root);
    if !candidates.contains(&managed_executable) {
        candidates.push(managed_executable);
    }

    let root_for_check = root.clone();
    let executable = tokio::task::spawn_blocking(move || {
        let mut managed_needs_repair = false;
        let executable = candidates.into_iter().find(|candidate| {
            if !nougat_executable_is_runnable(candidate) {
                return false;
            }
            if candidate.starts_with(&root_for_check)
                && !managed_nougat_dependencies_are_compatible(&root_for_check)
            {
                managed_needs_repair = true;
                return false;
            }
            true
        });
        (executable, managed_needs_repair)
    })
    .await
    .map_err(|error| {
        IncrementumError::Internal(format!("Failed to check the Nougat runtime: {error}"))
    })?;
    let (executable, managed_needs_repair) = executable;
    let managed = executable
        .as_ref()
        .is_some_and(|path| path.starts_with(&root));

    Ok(NougatRuntimeStatus {
        supported: cfg!(any(
            target_os = "windows",
            target_os = "macos",
            target_os = "linux"
        )),
        installed: executable.is_some(),
        managed,
        repair_required: managed_needs_repair,
        executable_path: executable.map(|path| path.to_string_lossy().to_string()),
        install_root: Some(root.to_string_lossy().to_string()),
        package: NOUGAT_PACKAGE.to_string(),
        detail: managed_needs_repair.then(|| {
            "The managed Nougat runtime has incompatible PDF dependencies. Repair the installation."
                .to_string()
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_runtime_paths_stay_inside_the_runtime_root() {
        let root = PathBuf::from("/tmp/incrementum-nougat-runtime");
        assert!(managed_uv_binary(&root).starts_with(&root));
        assert!(managed_python_binary(&root).starts_with(&root));
        assert!(managed_nougat_binary(&root).starts_with(&root));
    }

    #[test]
    fn installer_bootstrap_is_pinned_and_checksum_verified() {
        assert!(UV_INSTALLER_URL.contains(UV_VERSION));
        assert_eq!(UV_INSTALLER_SHA256.len(), 64);
        assert_eq!(NOUGAT_PACKAGE, "nougat-ocr==0.1.17");
        assert!(NOUGAT_REQUIREMENTS.contains(&"transformers<=4.38.2"));
        assert!(NOUGAT_REQUIREMENTS.contains(&"albumentations<=1.4.24"));
        assert!(NOUGAT_REQUIREMENTS.contains(&"pypdfium2<5"));
    }
}
