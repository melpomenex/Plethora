//! Manifest storage and crash recovery ledger for recording sessions.

use crate::models::recording_session::*;
use crate::recording::assets::{
    atomic_write_file, compute_file_sha256, managed_recording_root, safe_resolve_recording_path,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::fs;
use std::path::Path;

type Result<T> = std::result::Result<T, SessionOperationError>;

fn unavailable() -> SessionOperationError {
    SessionOperationError::source_unavailable()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestPartEntry {
    pub sequence: i64,
    pub relative_path: String,
    pub byte_length: i64,
    pub sha256: String,
    pub start_ms: i64,
    pub duration_ms: i64,
    pub format_json: String,
    pub committed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecordingManifest {
    pub manifest_version: u32,
    pub session_id: String,
    pub asset_id: String,
    pub writer_epoch: String,
    pub mime: String,
    pub sample_rate: Option<u32>,
    pub channels: Option<u16>,
    pub parts: Vec<ManifestPartEntry>,
    pub finalized: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub session_id: String,
    pub asset_id: String,
    pub verified_parts: usize,
    pub corrupt_parts: usize,
    pub missing_gaps: usize,
    pub acknowledged_duration_ms: i64,
    pub acknowledged_bytes: i64,
    pub state: RecordingState,
}

pub fn read_manifest(managed_root: &Path) -> Result<Option<RecordingManifest>> {
    let manifest_path = managed_root.join("manifest.json");
    if !manifest_path.exists() {
        return Ok(None);
    }
    let data = fs::read(&manifest_path).map_err(|_| unavailable())?;
    let manifest: RecordingManifest = serde_json::from_slice(&data).map_err(|_| unavailable())?;
    Ok(Some(manifest))
}

pub fn write_manifest_atomic(managed_root: &Path, manifest: &RecordingManifest) -> Result<()> {
    let manifest_path = managed_root.join("manifest.json");
    let json = serde_json::to_vec_pretty(manifest).map_err(|_| unavailable())?;
    atomic_write_file(&manifest_path, &json).map_err(|_| unavailable())
}

/// Reconciles on-disk manifest and parts with the SQLite database.
/// Discards or isolates incomplete/corrupt tail parts while preserving verified prefixes.
pub async fn reconcile_recording_session(
    data_dir: &Path,
    pool: &SqlitePool,
    session_id: &str,
) -> Result<RecoveryReport> {
    let managed_root = managed_recording_root(data_dir, session_id)?;
    let Some(mut manifest) = read_manifest(&managed_root)? else {
        return Err(unavailable());
    };

    let mut verified_entries: Vec<ManifestPartEntry> = Vec::new();
    let mut corrupt_parts = 0;
    let mut missing_gaps = 0;
    let mut acknowledged_duration_ms: i64 = 0;
    let mut acknowledged_bytes: i64 = 0;
    let mut expected_sequence: i64 = 0;

    for entry in &manifest.parts {
        if entry.sequence > expected_sequence {
            missing_gaps += (entry.sequence - expected_sequence) as usize;
        }
        expected_sequence = entry.sequence + 1;

        let part_path = match safe_resolve_recording_path(data_dir, session_id, &entry.relative_path) {
            Ok(p) => p,
            Err(_) => {
                corrupt_parts += 1;
                continue;
            }
        };

        if !part_path.exists() {
            missing_gaps += 1;
            continue;
        }

        let meta = match fs::metadata(&part_path) {
            Ok(m) => m,
            Err(_) => {
                corrupt_parts += 1;
                continue;
            }
        };

        if meta.len() as i64 != entry.byte_length {
            corrupt_parts += 1;
            continue;
        }

        match compute_file_sha256(&part_path) {
            Ok(hash) if hash == entry.sha256 => {
                verified_entries.push(entry.clone());
                acknowledged_bytes += entry.byte_length;
                let part_end = entry.start_ms + entry.duration_ms;
                if part_end > acknowledged_duration_ms {
                    acknowledged_duration_ms = part_end;
                }
            }
            _ => {
                corrupt_parts += 1;
            }
        }
    }

    // Clean up any dangling .partial files left behind by crashes
    let parts_dir = managed_root.join("parts");
    if parts_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&parts_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("partial") {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }

    // If manifest had corrupt or missing entries, rewrite manifest with verified entries
    if verified_entries.len() != manifest.parts.len() {
        manifest.parts = verified_entries.clone();
        manifest.updated_at = chrono::Utc::now().to_rfc3339();
        write_manifest_atomic(&managed_root, &manifest)?;
    }

    // Reconcile into SQLite database
    let mut tx = pool.begin().await.map_err(SessionOperationError::from)?;

    // Upsert media_assets
    let asset_state = if manifest.finalized && corrupt_parts == 0 && missing_gaps == 0 {
        "ready"
    } else if !verified_entries.is_empty() {
        "partial"
    } else {
        "staging"
    };

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO media_assets (id, session_id, kind, relative_path, mime, byte_length, sha256, duration_ms, state, created_at)
         VALUES (?1, ?2, 'capture', ?3, ?4, ?5, NULL, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET byte_length = ?5, duration_ms = ?6, state = ?7",
    )
    .bind(&manifest.asset_id)
    .bind(session_id)
    .bind(format!("recordings/{}", session_id))
    .bind(&manifest.mime)
    .bind(acknowledged_bytes)
    .bind(acknowledged_duration_ms)
    .bind(asset_state)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(SessionOperationError::from)?;

    // Clear stale database recording_parts for this asset and re-insert verified entries
    sqlx::query("DELETE FROM recording_parts WHERE asset_id = ?1")
        .bind(&manifest.asset_id)
        .execute(&mut *tx)
        .await
        .map_err(SessionOperationError::from)?;

    for part in &verified_entries {
        sqlx::query(
            "INSERT INTO recording_parts (asset_id, writer_epoch, sequence, relative_path, byte_length, sha256, start_ms, duration_ms, format_json, committed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&manifest.asset_id)
        .bind(&manifest.writer_epoch)
        .bind(part.sequence)
        .bind(&part.relative_path)
        .bind(part.byte_length)
        .bind(&part.sha256)
        .bind(part.start_ms)
        .bind(part.duration_ms)
        .bind(&part.format_json)
        .bind(&part.committed_at)
        .execute(&mut *tx)
        .await
        .map_err(SessionOperationError::from)?;
    }

    let capture_state = if manifest.finalized && corrupt_parts == 0 && missing_gaps == 0 {
        RecordingState::Saved
    } else if !verified_entries.is_empty() {
        RecordingState::Recoverable
    } else {
        RecordingState::Failed
    };

    let capture_state_str = serde_json::to_value(capture_state).unwrap();
    let ingestion_state_str = if capture_state == RecordingState::Saved {
        "saved"
    } else if capture_state == RecordingState::Recoverable {
        "partial"
    } else {
        "failed"
    };

    sqlx::query(
        "UPDATE recording_sessions SET media_asset_id = ?1, capture_state = ?2, ingestion_state = ?3, updated_at = ?4 WHERE id = ?5",
    )
    .bind(&manifest.asset_id)
    .bind(capture_state_str.as_str().unwrap_or("failed"))
    .bind(ingestion_state_str)
    .bind(&now)
    .bind(session_id)
    .execute(&mut *tx)
    .await
    .map_err(SessionOperationError::from)?;

    tx.commit().await.map_err(SessionOperationError::from)?;

    Ok(RecoveryReport {
        session_id: session_id.to_string(),
        asset_id: manifest.asset_id,
        verified_parts: verified_entries.len(),
        corrupt_parts,
        missing_gaps,
        acknowledged_duration_ms,
        acknowledged_bytes,
        state: capture_state,
    })
}
