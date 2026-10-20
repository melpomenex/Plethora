//! Managed storage, safe path resolution, and atomic file operations for recordings.

use crate::database::recording_session_repository::validate_recording_relative_path;
use crate::models::recording_session::SessionOperationError;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

type Result<T> = std::result::Result<T, SessionOperationError>;

fn unavailable() -> SessionOperationError {
    SessionOperationError::source_unavailable()
}

/// Managed root for a recording session: `{data_dir}/recordings/{session_id}`.
pub fn managed_recording_root(data_dir: &Path, session_id: &str) -> Result<PathBuf> {
    uuid::Uuid::parse_str(session_id).map_err(|_| unavailable())?;
    Ok(data_dir.join("recordings").join(session_id))
}

/// Resolves a relative path strictly within the session's managed root.
/// Rejects any path traversal (`..`), absolute paths, or symlinks.
pub fn safe_resolve_recording_path(
    data_dir: &Path,
    session_id: &str,
    relative_path: &str,
) -> Result<PathBuf> {
    validate_recording_relative_path(relative_path)?;
    let root = managed_recording_root(data_dir, session_id)?;

    for comp in Path::new(relative_path).components() {
        if !matches!(comp, Component::Normal(_)) {
            return Err(unavailable());
        }
    }

    let path = root.join(relative_path);

    // If path exists on disk, check for symlinks
    if let Ok(meta) = fs::symlink_metadata(&path) {
        if meta.file_type().is_symlink() {
            return Err(unavailable());
        }
    }

    // Verify canonical path does not escape the managed root
    if let (Ok(canon_path), Ok(canon_root)) = (fs::canonicalize(&path), fs::canonicalize(&root)) {
        if !canon_path.starts_with(&canon_root) {
            return Err(unavailable());
        }
    }

    Ok(path)
}

/// Atomically write a file via a temporary `.tmp` file and fsync before rename.
pub fn atomic_write_file(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let tmp_path = target.with_extension(format!("tmp.{}", &nonce[..8]));

    let mut file = File::create(&tmp_path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);

    fs::rename(&tmp_path, target)?;

    // Sync parent directory to persist directory entry rename on POSIX
    if let Some(parent) = target.parent() {
        if let Ok(dir) = File::open(parent) {
            let _ = dir.sync_all();
        }
    }

    Ok(())
}

/// Computes hex SHA-256 digest of in-memory bytes.
pub fn compute_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Computes hex SHA-256 digest streaming from a file.
pub fn compute_file_sha256(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}
