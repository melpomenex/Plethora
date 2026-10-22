//! Durable recording storage, atomic part writer, and crash recovery.

pub mod assets;
pub mod consolidate;
pub mod recovery;

pub use assets::*;
pub use consolidate::*;
pub use recovery::*;

use crate::models::recording_session::*;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

type Result<T> = std::result::Result<T, SessionOperationError>;

fn unavailable() -> SessionOperationError {
    SessionOperationError::source_unavailable()
}

fn storage_full() -> SessionOperationError {
    SessionOperationError {
        code: "StorageFull",
        stage: "ingestion",
        session_id: None,
        retryable: true,
        message_key: "recording.storageFull",
    }
}

/// Initializes an empty manifest for a new recording session and asset.
pub fn init_recording_manifest(
    data_dir: &Path,
    session_id: &str,
    asset_id: &str,
    writer_epoch: &str,
    mime: &str,
    sample_rate: Option<u32>,
    channels: Option<u16>,
) -> Result<RecordingManifest> {
    let managed_root = managed_recording_root(data_dir, session_id)?;
    fs::create_dir_all(&managed_root).map_err(|_| unavailable())?;

    let now = chrono::Utc::now().to_rfc3339();
    let manifest = RecordingManifest {
        manifest_version: 1,
        session_id: session_id.to_string(),
        asset_id: asset_id.to_string(),
        writer_epoch: writer_epoch.to_string(),
        mime: mime.to_string(),
        sample_rate,
        channels,
        parts: Vec::new(),
        finalized: false,
        created_at: now.clone(),
        updated_at: now,
    };

    write_manifest_atomic(&managed_root, &manifest)?;
    Ok(manifest)
}

/// Appends a recorded part bounded to at most 4 MiB:
/// 1. Writes bytes to `parts/part_{sequence}.bin.partial`.
/// 2. Fsyncs and renames atomically to `parts/part_{sequence}.bin`.
/// 3. Updates `manifest.json` atomically.
/// 4. Commits `recording_parts` row and updates `media_assets` in SQLite.
pub async fn append_recording_part(
    data_dir: &Path,
    pool: &SqlitePool,
    session_id: &str,
    writer_epoch: &str,
    sequence: i64,
    start_ms: i64,
    duration_ms: i64,
    format_json: &str,
    bytes: &[u8],
) -> Result<RecordingPart> {
    if bytes.is_empty() {
        return Err(unavailable());
    }
    // Hard bound: 4 MiB max per part
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(SessionOperationError {
            code: "InputTooLarge",
            stage: "capture",
            session_id: Some(session_id.to_string()),
            retryable: false,
            message_key: "recording.inputTooLarge",
        });
    }

    let managed_root = managed_recording_root(data_dir, session_id)?;
    let parts_dir = managed_root.join("parts");
    fs::create_dir_all(&parts_dir).map_err(|_| unavailable())?;

    // Read or create manifest
    let mut manifest = match read_manifest(&managed_root)? {
        Some(m) => m,
        None => {
            let asset_id = uuid::Uuid::new_v4().to_string();
            init_recording_manifest(
                data_dir,
                session_id,
                &asset_id,
                writer_epoch,
                "audio/wav",
                None,
                None,
            )?
        }
    };

    let hash = compute_sha256(bytes);
    let relative_path = format!("parts/part_{:06}.bin", sequence);

    // Idempotency check: if this sequence is already recorded with identical hash, return existing part
    if let Some(existing) = manifest.parts.iter().find(|p| p.sequence == sequence) {
        if existing.sha256 == hash && existing.byte_length == bytes.len() as i64 {
            return Ok(RecordingPart {
                asset_id: manifest.asset_id.clone(),
                writer_epoch: manifest.writer_epoch.clone(),
                sequence: existing.sequence,
                relative_path: existing.relative_path.clone(),
                byte_length: existing.byte_length,
                sha256: existing.sha256.clone(),
                start_ms: existing.start_ms,
                duration_ms: existing.duration_ms,
                format_json: existing.format_json.clone(),
                committed_at: existing.committed_at.clone(),
            });
        }
        return Err(SessionOperationError::stale());
    }

    // Step 1 & 2: Write to .partial and rename atomically
    let target_part_path = safe_resolve_recording_path(data_dir, session_id, &relative_path)?;
    let partial_path = target_part_path.with_extension("bin.partial");

    let mut part_file = File::create(&partial_path).map_err(|e| {
        if e.raw_os_error() == Some(28) {
            storage_full()
        } else {
            unavailable()
        }
    })?;
    part_file.write_all(bytes).map_err(|e| {
        let _ = fs::remove_file(&partial_path);
        if e.raw_os_error() == Some(28) {
            storage_full()
        } else {
            unavailable()
        }
    })?;
    part_file.sync_all().map_err(|_| unavailable())?;
    drop(part_file);

    fs::rename(&partial_path, &target_part_path).map_err(|_| unavailable())?;

    // Step 3: Update manifest atomically
    let now = chrono::Utc::now().to_rfc3339();
    let entry = ManifestPartEntry {
        sequence,
        relative_path: relative_path.clone(),
        byte_length: bytes.len() as i64,
        sha256: hash.clone(),
        start_ms,
        duration_ms,
        format_json: format_json.to_string(),
        committed_at: now.clone(),
    };

    manifest.parts.push(entry);
    manifest.parts.sort_by_key(|p| p.sequence);
    manifest.updated_at = now.clone();
    write_manifest_atomic(&managed_root, &manifest)?;

    // Step 4: Commit into SQLite
    let mut tx = pool.begin().await.map_err(SessionOperationError::from)?;

    // Ensure media_asset exists
    sqlx::query(
        "INSERT INTO media_assets (id, session_id, kind, relative_path, mime, byte_length, sha256, duration_ms, state, created_at)
         VALUES (?1, ?2, 'capture', ?3, ?4, ?5, NULL, ?6, 'staging', ?7)
         ON CONFLICT(id) DO UPDATE SET byte_length = byte_length + ?5, duration_ms = MAX(duration_ms, ?6)",
    )
    .bind(&manifest.asset_id)
    .bind(session_id)
    .bind(format!("recordings/{}", session_id))
    .bind(&manifest.mime)
    .bind(bytes.len() as i64)
    .bind(start_ms + duration_ms)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(SessionOperationError::from)?;

    // Insert recording_part
    sqlx::query(
        "INSERT INTO recording_parts (asset_id, writer_epoch, sequence, relative_path, byte_length, sha256, start_ms, duration_ms, format_json, committed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )
    .bind(&manifest.asset_id)
    .bind(writer_epoch)
    .bind(sequence)
    .bind(&relative_path)
    .bind(bytes.len() as i64)
    .bind(&hash)
    .bind(start_ms)
    .bind(duration_ms)
    .bind(format_json)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(SessionOperationError::from)?;

    // Update recording_sessions
    sqlx::query("UPDATE recording_sessions SET media_asset_id = ?1, updated_at = ?2 WHERE id = ?3")
        .bind(&manifest.asset_id)
        .bind(&now)
        .bind(session_id)
        .execute(&mut *tx)
        .await
        .map_err(SessionOperationError::from)?;

    tx.commit().await.map_err(SessionOperationError::from)?;

    Ok(RecordingPart {
        asset_id: manifest.asset_id,
        writer_epoch: writer_epoch.to_string(),
        sequence,
        relative_path,
        byte_length: bytes.len() as i64,
        sha256: hash,
        start_ms,
        duration_ms,
        format_json: format_json.to_string(),
        committed_at: now,
    })
}

/// Finalizes a recording session: verifies all parts, updates manifest, and marks media ready.
pub async fn finalize_recording_session(
    data_dir: &Path,
    pool: &SqlitePool,
    session_id: &str,
    expected_version: i64,
) -> Result<RecordingSession> {
    let report = reconcile_recording_session(data_dir, pool, session_id).await?;
    let managed_root = managed_recording_root(data_dir, session_id)?;

    let mut manifest = read_manifest(&managed_root)?.ok_or_else(unavailable)?;
    manifest.finalized = true;
    manifest.updated_at = chrono::Utc::now().to_rfc3339();
    write_manifest_atomic(&managed_root, &manifest)?;

    // Join the rolling parts into one seekable file so playback and
    // transcription can consume the session. Failure to consolidate must not
    // fail the save: the verified parts remain the source of truth.
    match consolidate_capture_media(data_dir, session_id, &manifest) {
        Ok(Some(media)) => {
            let state = if report.corrupt_parts == 0 && report.missing_gaps == 0 {
                "ready"
            } else {
                "partial"
            };
            if let Err(error) =
                apply_consolidated_media(pool, session_id, &report.asset_id, &media, state).await
            {
                tracing::warn!(
                    "[recording] consolidated media could not be recorded for session {session_id}: {error}"
                );
            }
        }
        Ok(None) => {}
        Err(error) => {
            tracing::warn!("[recording] consolidation skipped for session {session_id}: {error}");
        }
    }

    let mut tx = pool.begin().await.map_err(SessionOperationError::from)?;
    let now = chrono::Utc::now().to_rfc3339();

    let is_clean = report.corrupt_parts == 0 && report.missing_gaps == 0;
    let final_capture = if is_clean { "saved" } else { "recoverable" };
    let final_ingestion = if is_clean { "saved" } else { "partial" };
    let final_asset_state = if is_clean { "ready" } else { "partial" };

    sqlx::query("UPDATE media_assets SET state = ?1 WHERE id = ?2")
        .bind(final_asset_state)
        .bind(&report.asset_id)
        .execute(&mut *tx)
        .await
        .map_err(SessionOperationError::from)?;

    let updated = sqlx::query(
        "UPDATE recording_sessions SET capture_state = ?1, ingestion_state = ?2, version = version + 1, updated_at = ?3 WHERE id = ?4 AND version = ?5",
    )
    .bind(final_capture)
    .bind(final_ingestion)
    .bind(&now)
    .bind(session_id)
    .bind(expected_version)
    .execute(&mut *tx)
    .await
    .map_err(SessionOperationError::from)?;

    if updated.rows_affected() != 1 {
        return Err(SessionOperationError::stale());
    }

    let row = sqlx::query("SELECT s.* FROM recording_sessions s JOIN documents d ON d.id = s.document_id WHERE s.id = ?1")
        .bind(session_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(SessionOperationError::from)?;

    tx.commit().await.map_err(SessionOperationError::from)?;

    let origin: SessionOrigin = serde_json::from_value(serde_json::Value::String(row.get("origin"))).map_err(|_| unavailable())?;
    let content_type: SessionContentType = serde_json::from_value(serde_json::Value::String(row.get("content_type"))).map_err(|_| unavailable())?;
    let raw: String = row.get("content_type");

    Ok(RecordingSession {
        id: row.get("id"),
        document_id: row.get("document_id"),
        origin,
        content_type,
        original_content_type: (content_type == SessionContentType::Other && raw != "other").then_some(raw),
        profile_json: row.get("profile_json"),
        capture_state: serde_json::from_value(serde_json::Value::String(row.get("capture_state"))).map_err(|_| unavailable())?,
        ingestion_state: serde_json::from_value(serde_json::Value::String(row.get("ingestion_state"))).map_err(|_| unavailable())?,
        transcript_id: row.get("transcript_id"),
        media_asset_id: row.get("media_asset_id"),
        transcript_revision: row.get("transcript_revision"),
        overview_json: row.get("overview_json"),
        overview_revision: row.get("overview_revision"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        version: row.get("version"),
    })
}

/// Stages an external media file into managed recording storage.
pub async fn stage_session_media(
    data_dir: &Path,
    pool: &SqlitePool,
    session_id: &str,
    source_path: &Path,
    mime: &str,
) -> Result<SessionMediaAsset> {
    if !source_path.is_file() {
        return Err(unavailable());
    }

    let managed_root = managed_recording_root(data_dir, session_id)?;
    fs::create_dir_all(&managed_root).map_err(|_| unavailable())?;

    let asset_id = uuid::Uuid::new_v4().to_string();
    let ext = source_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("media");
    let relative_path = format!("asset_{}.{}", &asset_id[..8], ext);
    let target_path = safe_resolve_recording_path(data_dir, session_id, &relative_path)?;

    // Stream copy with sha256
    let mut src = File::open(source_path).map_err(|_| unavailable())?;
    let mut dst = File::create(&target_path).map_err(|_| unavailable())?;
    let mut hasher = sha2::Sha256::new();
    let mut buf = [0u8; 65536];
    let mut total_bytes = 0i64;

    loop {
        let n = src.read(&mut buf).map_err(|_| unavailable())?;
        if n == 0 {
            break;
        }
        dst.write_all(&buf[..n]).map_err(|_| unavailable())?;
        hasher.update(&buf[..n]);
        total_bytes += n as i64;
    }
    dst.sync_all().map_err(|_| unavailable())?;
    drop(dst);

    let sha256 = hex::encode(hasher.finalize());
    let now = chrono::Utc::now().to_rfc3339();

    let mut tx = pool.begin().await.map_err(SessionOperationError::from)?;

    sqlx::query(
        "INSERT INTO media_assets (id, session_id, kind, relative_path, mime, byte_length, sha256, duration_ms, state, created_at)
         VALUES (?1, ?2, 'original', ?3, ?4, ?5, ?6, NULL, 'ready', ?7)",
    )
    .bind(&asset_id)
    .bind(session_id)
    .bind(&relative_path)
    .bind(mime)
    .bind(total_bytes)
    .bind(&sha256)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(SessionOperationError::from)?;

    sqlx::query(
        "UPDATE recording_sessions SET media_asset_id = ?1, capture_state = 'saved', ingestion_state = 'saved', updated_at = ?2 WHERE id = ?3",
    )
    .bind(&asset_id)
    .bind(&now)
    .bind(session_id)
    .execute(&mut *tx)
    .await
    .map_err(SessionOperationError::from)?;

    tx.commit().await.map_err(SessionOperationError::from)?;

    Ok(SessionMediaAsset {
        id: asset_id,
        session_id: session_id.to_string(),
        kind: MediaAssetKind::Original,
        relative_path,
        mime: mime.to_string(),
        byte_length: total_bytes,
        sha256: Some(sha256),
        duration_ms: None,
        state: MediaAssetState::Ready,
        source_url: None,
        source_adapter: None,
        created_at: now,
    })
}

/// Exports all verified parts of a session to a single contiguous file.
///
/// PCM captures are exported as one valid WAV file (a single header, not one
/// header per part). Container captures fall back to bytewise concatenation,
/// which restores the MediaRecorder fragment stream.
pub fn export_partial_recording(
    data_dir: &Path,
    session_id: &str,
    output_path: &Path,
) -> Result<i64> {
    let managed_root = managed_recording_root(data_dir, session_id)?;
    let manifest = read_manifest(&managed_root)?.ok_or_else(unavailable)?;

    if let Some(written) = write_capture_media_to(data_dir, session_id, &manifest, output_path)? {
        return Ok(written as i64);
    }

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|_| unavailable())?;
    }

    let mut out = File::create(output_path).map_err(|_| unavailable())?;
    let mut total_bytes = 0i64;

    for part in &manifest.parts {
        let part_path = safe_resolve_recording_path(data_dir, session_id, &part.relative_path)?;
        if part_path.exists() {
            let mut file = File::open(&part_path).map_err(|_| unavailable())?;
            let mut buf = [0u8; 65536];
            loop {
                let n = file.read(&mut buf).map_err(|_| unavailable())?;
                if n == 0 {
                    break;
                }
                out.write_all(&buf[..n]).map_err(|_| unavailable())?;
                total_bytes += n as i64;
            }
        }
    }
    out.sync_all().map_err(|_| unavailable())?;
    Ok(total_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use crate::database::Repository;
    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::TempDir;

    async fn setup_test_db() -> (TempDir, Repository) {
        let dir = TempDir::new().unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        (dir, Repository::new(pool))
    }

    #[tokio::test]
    async fn append_part_atomic_write_and_idempotency() {
        let (dir, repo) = setup_test_db().await;
        let session_id = uuid::Uuid::new_v4().to_string();

        // Create recording session in DB
        let request = CreateRecordingSession {
            id: session_id.clone(),
            document_id: None,
            collection_id: None,
            title: "Test Session".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        repo.create_recording_session(&request).await.unwrap();

        let bytes = b"RIFF-WAVE-PART-DATA-1";
        let part = append_recording_part(
            dir.path(),
            repo.pool(),
            &session_id,
            "epoch-1",
            0,
            0,
            1000,
            "{}",
            bytes,
        )
        .await
        .unwrap();

        assert_eq!(part.sequence, 0);
        assert_eq!(part.byte_length, bytes.len() as i64);

        // Idempotent retry with identical bytes succeeds
        let retried = append_recording_part(
            dir.path(),
            repo.pool(),
            &session_id,
            "epoch-1",
            0,
            0,
            1000,
            "{}",
            bytes,
        )
        .await
        .unwrap();
        assert_eq!(retried.sha256, part.sha256);

        // Conflicting bytes for same sequence returns StaleRevision
        let conflicting = append_recording_part(
            dir.path(),
            repo.pool(),
            &session_id,
            "epoch-1",
            0,
            0,
            1000,
            "{}",
            b"DIFFERENT-BYTES",
        )
        .await;
        assert_eq!(conflicting.unwrap_err().code, "StaleRevision");
    }

    #[tokio::test]
    async fn recovery_handles_failure_before_rename() {
        let (dir, repo) = setup_test_db().await;
        let session_id = uuid::Uuid::new_v4().to_string();

        let request = CreateRecordingSession {
            id: session_id.clone(),
            document_id: None,
            collection_id: None,
            title: "Test".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        repo.create_recording_session(&request).await.unwrap();

        let root = managed_recording_root(dir.path(), &session_id).unwrap();
        let parts_dir = root.join("parts");
        fs::create_dir_all(&parts_dir).unwrap();

        let asset_id = uuid::Uuid::new_v4().to_string();
        init_recording_manifest(dir.path(), &session_id, &asset_id, "epoch-1", "audio/wav", None, None).unwrap();

        // Inject unrenamed .partial file
        let partial = parts_dir.join("part_000000.bin.partial");
        fs::write(&partial, b"unfinished bytes").unwrap();

        let report = reconcile_recording_session(dir.path(), repo.pool(), &session_id).await.unwrap();
        assert_eq!(report.verified_parts, 0);
        // Partial file should be cleaned up
        assert!(!partial.exists());
    }

    #[tokio::test]
    async fn recovery_handles_failure_after_manifest_before_db_commit() {
        let (dir, repo) = setup_test_db().await;
        let session_id = uuid::Uuid::new_v4().to_string();

        let request = CreateRecordingSession {
            id: session_id.clone(),
            document_id: None,
            collection_id: None,
            title: "Test".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        repo.create_recording_session(&request).await.unwrap();

        let root = managed_recording_root(dir.path(), &session_id).unwrap();
        let parts_dir = root.join("parts");
        fs::create_dir_all(&parts_dir).unwrap();

        let asset_id = uuid::Uuid::new_v4().to_string();
        let mut manifest = init_recording_manifest(dir.path(), &session_id, &asset_id, "epoch-1", "audio/wav", None, None).unwrap();

        // Write verified part to disk
        let part_file = parts_dir.join("part_000000.bin");
        let bytes = b"verified data bytes";
        fs::write(&part_file, bytes).unwrap();
        let hash = compute_sha256(bytes);

        manifest.parts.push(ManifestPartEntry {
            sequence: 0,
            relative_path: "parts/part_000000.bin".into(),
            byte_length: bytes.len() as i64,
            sha256: hash,
            start_ms: 0,
            duration_ms: 5000,
            format_json: "{}".into(),
            committed_at: chrono::Utc::now().to_rfc3339(),
        });
        write_manifest_atomic(&root, &manifest).unwrap();

        // DB currently has no parts for this asset!
        // Run recovery 1st time
        let report1 = reconcile_recording_session(dir.path(), repo.pool(), &session_id).await.unwrap();
        assert_eq!(report1.verified_parts, 1);
        assert_eq!(report1.acknowledged_duration_ms, 5000);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recording_parts WHERE asset_id = ?1")
            .bind(&asset_id)
            .fetch_one(repo.pool())
            .await
            .unwrap();
        assert_eq!(count, 1);

        // Run recovery 2nd time (restart twice yields same verified state)
        let report2 = reconcile_recording_session(dir.path(), repo.pool(), &session_id).await.unwrap();
        assert_eq!(report2.verified_parts, 1);
        assert_eq!(report2.acknowledged_duration_ms, 5000);
    }

    #[tokio::test]
    async fn recovery_handles_corrupt_tail_and_honest_gaps() {
        let (dir, repo) = setup_test_db().await;
        let session_id = uuid::Uuid::new_v4().to_string();

        let request = CreateRecordingSession {
            id: session_id.clone(),
            document_id: None,
            collection_id: None,
            title: "Test".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        repo.create_recording_session(&request).await.unwrap();

        let root = managed_recording_root(dir.path(), &session_id).unwrap();
        let parts_dir = root.join("parts");
        fs::create_dir_all(&parts_dir).unwrap();

        let asset_id = uuid::Uuid::new_v4().to_string();
        let mut manifest = init_recording_manifest(dir.path(), &session_id, &asset_id, "epoch-1", "audio/wav", None, None).unwrap();

        // Part 0 is valid
        let p0 = parts_dir.join("part_000000.bin");
        fs::write(&p0, b"part0").unwrap();
        manifest.parts.push(ManifestPartEntry {
            sequence: 0,
            relative_path: "parts/part_000000.bin".into(),
            byte_length: 5,
            sha256: compute_sha256(b"part0"),
            start_ms: 0,
            duration_ms: 5000,
            format_json: "{}".into(),
            committed_at: chrono::Utc::now().to_rfc3339(),
        });

        // Part 1 is MISSING from disk
        manifest.parts.push(ManifestPartEntry {
            sequence: 1,
            relative_path: "parts/part_000001.bin".into(),
            byte_length: 5,
            sha256: compute_sha256(b"part1"),
            start_ms: 5000,
            duration_ms: 5000,
            format_json: "{}".into(),
            committed_at: chrono::Utc::now().to_rfc3339(),
        });

        // Part 2 is CORRUPTED on disk
        let p2 = parts_dir.join("part_000002.bin");
        fs::write(&p2, b"corrupted bytes").unwrap();
        manifest.parts.push(ManifestPartEntry {
            sequence: 2,
            relative_path: "parts/part_000002.bin".into(),
            byte_length: 5,
            sha256: compute_sha256(b"expected"),
            start_ms: 10000,
            duration_ms: 5000,
            format_json: "{}".into(),
            committed_at: chrono::Utc::now().to_rfc3339(),
        });

        write_manifest_atomic(&root, &manifest).unwrap();

        let report = reconcile_recording_session(dir.path(), repo.pool(), &session_id).await.unwrap();
        assert_eq!(report.verified_parts, 1);
        assert_eq!(report.missing_gaps, 1);
        assert_eq!(report.corrupt_parts, 1);
        assert_eq!(report.state, RecordingState::Recoverable);
    }

    #[tokio::test]
    async fn finalize_consolidates_pcm_parts_into_playable_asset() {
        let (dir, repo) = setup_test_db().await;
        let session_id = uuid::Uuid::new_v4().to_string();

        let request = CreateRecordingSession {
            id: session_id.clone(),
            document_id: None,
            collection_id: None,
            title: "Consolidated lecture".into(),
            origin: SessionOrigin::Recorded,
            content_type: "lecture".into(),
            profile_json: "{}".into(),
        };
        repo.create_recording_session(&request).await.unwrap();

        let root = managed_recording_root(dir.path(), &session_id).unwrap();
        let parts_dir = root.join("parts");
        fs::create_dir_all(&parts_dir).unwrap();

        let asset_id = uuid::Uuid::new_v4().to_string();
        let mut manifest = init_recording_manifest(
            dir.path(),
            &session_id,
            &asset_id,
            "epoch-1",
            "audio/wav",
            Some(16000),
            Some(1),
        )
        .unwrap();
        let mut write_wav_part = |sequence: i64, samples: &[u8]| {
            let mut bytes = Vec::with_capacity(44 + samples.len());
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&((36 + samples.len()) as u32).to_le_bytes());
            bytes.extend_from_slice(b"WAVE");
            bytes.extend_from_slice(b"fmt ");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&16000u32.to_le_bytes());
            bytes.extend_from_slice(&32000u32.to_le_bytes());
            bytes.extend_from_slice(&2u16.to_le_bytes());
            bytes.extend_from_slice(&16u16.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&(samples.len() as u32).to_le_bytes());
            bytes.extend_from_slice(samples);

            let name = format!("part_{sequence:06}.bin");
            fs::write(parts_dir.join(&name), &bytes).unwrap();
            manifest.parts.push(ManifestPartEntry {
                sequence,
                relative_path: format!("parts/{name}"),
                byte_length: bytes.len() as i64,
                sha256: compute_sha256(&bytes),
                start_ms: sequence * 5000,
                duration_ms: 5000,
                format_json:
                    "{\"sampleRate\":16000,\"channels\":1,\"encoding\":\"pcm16le\"}".into(),
                committed_at: chrono::Utc::now().to_rfc3339(),
            });
        };
        write_wav_part(0, &[1u8, 0, 2, 0]);
        write_wav_part(1, &[3u8, 0]);
        write_manifest_atomic(&root, &manifest).unwrap();

        let finalized = finalize_recording_session(dir.path(), repo.pool(), &session_id, 1)
            .await
            .unwrap();
        assert_eq!(finalized.capture_state, RecordingState::Saved);

        let asset = repo
            .get_recording_asset(&session_id, &asset_id)
            .await
            .unwrap();
        assert_eq!(
            asset.relative_path,
            format!("recordings/{session_id}/audio.wav")
        );
        assert_eq!(asset.state, MediaAssetState::Ready);
        let audio = fs::read(root.join("audio.wav")).unwrap();
        assert_eq!(&audio[44..], &[1u8, 0, 2, 0, 3, 0]);
    }

    #[tokio::test]
    async fn traversal_and_symlink_paths_fail() {
        let (dir, _repo) = setup_test_db().await;
        let session_id = uuid::Uuid::new_v4().to_string();

        assert!(safe_resolve_recording_path(dir.path(), &session_id, "../escape.bin").is_err());
        assert!(safe_resolve_recording_path(dir.path(), &session_id, "/abs/path").is_err());
        assert!(safe_resolve_recording_path(dir.path(), &session_id, "foo/../../bar").is_err());

        // Test symlink rejection
        let root = managed_recording_root(dir.path(), &session_id).unwrap();
        fs::create_dir_all(&root).unwrap();
        let target_file = dir.path().join("outside.txt");
        fs::write(&target_file, b"outside").unwrap();

        let symlink_path = root.join("link.bin");
        #[cfg(unix)]
        {
            let _ = std::os::unix::fs::symlink(&target_file, &symlink_path);
            assert!(safe_resolve_recording_path(dir.path(), &session_id, "link.bin").is_err());
        }
    }
}
