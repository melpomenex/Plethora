//! Optional desktop-only recurring local folder import (explicit opt-in, idempotent, non-destructive).

use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::path::Path;

use crate::health::db::HealthVault;
use crate::health::models::HealthDataCategory;

use super::orchestrator::{commit_wearable_import, compute_file_sha256};
use super::types::{ImportCancellationToken, ImportCommitResult, ImportError};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedImportFolder {
    pub id: String,
    pub folder_path: String,
    pub enabled: bool,
    pub auto_commit: bool,
    pub last_scanned_at_ms: Option<i64>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedDetectedFile {
    pub folder_id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedScanReport {
    pub pending_files: Vec<WatchedDetectedFile>,
    pub auto_imported: Vec<ImportCommitResult>,
    pub skipped_already_processed: usize,
}

pub async fn add_watched_folder(
    vault: &HealthVault,
    folder_path: &str,
    auto_commit: bool,
) -> Result<WatchedImportFolder, ImportError> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Err(ImportError::UnsupportedFormat(
            "Watched local folders are only supported on desktop platforms.".to_string(),
        ));
    }
    let path = Path::new(folder_path);
    if !path.is_dir() {
        return Err(ImportError::InvalidInput(
            "Selected path is not an accessible directory.".to_string(),
        ));
    }
    if path.parent().is_none() {
        return Err(ImportError::SecurityViolation(
            "Cannot watch filesystem root directory.".to_string(),
        ));
    }
    if let Ok(home) = std::env::var("HOME") {
        if path == Path::new(&home) {
            return Err(ImportError::SecurityViolation(
                "Choose a dedicated subfolder rather than your entire home directory.".to_string(),
            ));
        }
    }

    let now = chrono::Utc::now().timestamp_millis();
    let id = format!("watch_{}", uuid::Uuid::new_v4());
    let canonical = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned();

    sqlx::query(
        "INSERT INTO health_watched_import_folders (id, folder_path, enabled, auto_commit, created_at_ms)
         VALUES (?1, ?2, 1, ?3, ?4)
         ON CONFLICT(folder_path) DO UPDATE SET enabled = 1, auto_commit = excluded.auto_commit",
    )
    .bind(&id)
    .bind(&canonical)
    .bind(if auto_commit { 1 } else { 0 })
    .bind(now)
    .execute(&vault.pool)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    let row = sqlx::query(
        "SELECT id, folder_path, enabled, auto_commit, last_scanned_at_ms, created_at_ms
         FROM health_watched_import_folders WHERE folder_path = ?1",
    )
    .bind(&canonical)
    .fetch_one(&vault.pool)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    Ok(WatchedImportFolder {
        id: row.get("id"),
        folder_path: row.get("folder_path"),
        enabled: row.get::<i64, _>("enabled") != 0,
        auto_commit: row.get::<i64, _>("auto_commit") != 0,
        last_scanned_at_ms: row.get("last_scanned_at_ms"),
        created_at_ms: row.get("created_at_ms"),
    })
}

pub async fn list_watched_folders(
    vault: &HealthVault,
) -> Result<Vec<WatchedImportFolder>, ImportError> {
    let rows = sqlx::query(
        "SELECT id, folder_path, enabled, auto_commit, last_scanned_at_ms, created_at_ms
         FROM health_watched_import_folders ORDER BY created_at_ms DESC",
    )
    .fetch_all(&vault.pool)
    .await
    .map_err(|e| ImportError::Database(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|r| WatchedImportFolder {
            id: r.get("id"),
            folder_path: r.get("folder_path"),
            enabled: r.get::<i64, _>("enabled") != 0,
            auto_commit: r.get::<i64, _>("auto_commit") != 0,
            last_scanned_at_ms: r.get("last_scanned_at_ms"),
            created_at_ms: r.get("created_at_ms"),
        })
        .collect())
}

pub async fn remove_watched_folder(vault: &HealthVault, folder_id: &str) -> Result<(), ImportError> {
    sqlx::query("DELETE FROM health_watched_import_folders WHERE id = ?1")
        .bind(folder_id)
        .execute(&vault.pool)
        .await
        .map_err(|e| ImportError::Database(e.to_string()))?;
    Ok(())
}

pub async fn scan_watched_folders(vault: &HealthVault) -> Result<WatchedScanReport, ImportError> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Ok(WatchedScanReport {
            pending_files: Vec::new(),
            auto_imported: Vec::new(),
            skipped_already_processed: 0,
        });
    }

    let folders = list_watched_folders(vault).await?;
    let mut pending_files = Vec::new();
    let mut auto_imported = Vec::new();
    let mut skipped_already_processed = 0usize;
    let now_sys = std::time::SystemTime::now();
    let now_ms = chrono::Utc::now().timestamp_millis();

    for folder in folders.into_iter().filter(|f| f.enabled) {
        let Ok(entries) = std::fs::read_dir(&folder.folder_path) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            if !matches!(ext.as_str(), "zip" | "xml" | "csv" | "json") {
                continue;
            }
            // Skip partial/in-progress browser downloads
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if let Ok(modified) = meta.modified() {
                if now_sys
                    .duration_since(modified)
                    .is_ok_and(|d| d.as_secs() < 2)
                {
                    continue;
                }
            }

            let Ok((file_hash, file_size)) = compute_file_sha256(&path) else {
                continue;
            };
            let path_str = path.to_string_lossy().into_owned();
            let already: Option<String> = sqlx::query_scalar(
                "SELECT status FROM health_watched_import_files
                 WHERE folder_id = ?1 AND file_path = ?2 AND file_hash = ?3",
            )
            .bind(&folder.id)
            .bind(&path_str)
            .bind(&file_hash)
            .fetch_optional(&vault.pool)
            .await
            .map_err(|e| ImportError::Database(e.to_string()))?;

            if already.is_some() {
                skipped_already_processed += 1;
                continue;
            }

            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("export")
                .to_string();

            if folder.auto_commit {
                let cancel = ImportCancellationToken::new();
                if let Ok(res) = commit_wearable_import(
                    vault,
                    &path,
                    None,
                    None,
                    &[
                        HealthDataCategory::Sleep,
                        HealthDataCategory::SleepStages,
                        HealthDataCategory::HeartRate,
                        HealthDataCategory::RestingHeartRate,
                        HealthDataCategory::Hrv,
                        HealthDataCategory::Recovery,
                        HealthDataCategory::Temperature,
                        HealthDataCategory::RespiratoryRate,
                    ],
                    None,
                    &cancel,
                    None,
                    "watched_scan",
                )
                .await
                {
                    let _ = sqlx::query(
                        "INSERT OR IGNORE INTO health_watched_import_files
                         (folder_id, file_path, file_hash, file_size_bytes, status, batch_id, processed_at_ms)
                         VALUES (?1, ?2, ?3, ?4, 'imported', ?5, ?6)",
                    )
                    .bind(&folder.id)
                    .bind(&path_str)
                    .bind(&file_hash)
                    .bind(file_size as i64)
                    .bind(&res.batch_id)
                    .bind(now_ms)
                    .execute(&vault.pool)
                    .await;
                    auto_imported.push(res);
                }
            } else {
                pending_files.push(WatchedDetectedFile {
                    folder_id: folder.id.clone(),
                    file_path: path_str,
                    file_name,
                    file_size_bytes: file_size as i64,
                });
            }
        }

        let _ = sqlx::query(
            "UPDATE health_watched_import_folders SET last_scanned_at_ms = ?1 WHERE id = ?2",
        )
        .bind(now_ms)
        .bind(&folder.id)
        .execute(&vault.pool)
        .await;
    }

    Ok(WatchedScanReport {
        pending_files,
        auto_imported,
        skipped_already_processed,
    })
}
