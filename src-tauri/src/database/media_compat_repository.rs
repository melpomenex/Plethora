//! Persistence for local-media compatibility inspections and artifacts.

use sqlx::Row;

use crate::database::Repository;

pub async fn get_inspection(
    repo: &Repository,
    document_id: &str,
    source_fingerprint: &str,
) -> Result<Option<(String, i64)>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT inspection_json, schema_version
         FROM media_inspections
         WHERE document_id = ? AND source_fingerprint = ?",
    )
    .bind(document_id)
    .bind(source_fingerprint)
    .fetch_optional(repo.pool())
    .await?;

    Ok(row.map(|row| {
        (
            row.get::<String, _>("inspection_json"),
            row.get::<i64, _>("schema_version"),
        )
    }))
}

pub async fn upsert_inspection(
    repo: &Repository,
    document_id: &str,
    source_fingerprint: &str,
    source_path: &str,
    inspection_json: &str,
    schema_version: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO media_inspections
            (document_id, source_fingerprint, source_path, inspection_json, schema_version, probed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(document_id, source_fingerprint) DO UPDATE SET
            source_path = excluded.source_path,
            inspection_json = excluded.inspection_json,
            schema_version = excluded.schema_version,
            probed_at = excluded.probed_at",
    )
    .bind(document_id)
    .bind(source_fingerprint)
    .bind(source_path)
    .bind(inspection_json)
    .bind(schema_version)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(repo.pool())
    .await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct MediaArtifactRow {
    pub cache_key: String,
    pub document_id: String,
    pub source_path: String,
    pub source_fingerprint: String,
    pub inspection_hash: String,
    pub plan_json: String,
    pub output_path: String,
    pub output_container: String,
    pub output_size: i64,
    pub duration_seconds: Option<f64>,
    pub timeline_offset_seconds: f64,
    pub state: String,
    pub error_code: Option<String>,
    pub created_at: String,
    pub last_accessed_at: String,
}

fn artifact_from_row(row: sqlx::sqlite::SqliteRow) -> MediaArtifactRow {
    MediaArtifactRow {
        cache_key: row.get("cache_key"),
        document_id: row.get("document_id"),
        source_path: row.get("source_path"),
        source_fingerprint: row.get("source_fingerprint"),
        inspection_hash: row.get("inspection_hash"),
        plan_json: row.get("plan_json"),
        output_path: row.get("output_path"),
        output_container: row.get("output_container"),
        output_size: row.get("output_size"),
        duration_seconds: row.get("duration_seconds"),
        timeline_offset_seconds: row.get("timeline_offset_seconds"),
        state: row.get("state"),
        error_code: row.get("error_code"),
        created_at: row.get("created_at"),
        last_accessed_at: row.get("last_accessed_at"),
    }
}

pub async fn get_artifact(
    repo: &Repository,
    cache_key: &str,
) -> Result<Option<MediaArtifactRow>, sqlx::Error> {
    let row = sqlx::query("SELECT * FROM media_compatibility_artifacts WHERE cache_key = ?")
        .bind(cache_key)
        .fetch_optional(repo.pool())
        .await?;
    Ok(row.map(artifact_from_row))
}

pub async fn list_artifacts(
    repo: &Repository,
    document_id: Option<&str>,
) -> Result<Vec<MediaArtifactRow>, sqlx::Error> {
    let rows = if let Some(document_id) = document_id {
        sqlx::query(
            "SELECT * FROM media_compatibility_artifacts
             WHERE document_id = ? ORDER BY last_accessed_at DESC",
        )
        .bind(document_id)
        .fetch_all(repo.pool())
        .await?
    } else {
        sqlx::query(
            "SELECT * FROM media_compatibility_artifacts
             ORDER BY last_accessed_at DESC",
        )
        .fetch_all(repo.pool())
        .await?
    };
    Ok(rows.into_iter().map(artifact_from_row).collect())
}

#[allow(clippy::too_many_arguments)]
pub async fn upsert_artifact(
    repo: &Repository,
    cache_key: &str,
    document_id: &str,
    source_path: &str,
    source_fingerprint: &str,
    inspection_hash: &str,
    plan_json: &str,
    output_path: &str,
    output_container: &str,
    output_size: i64,
    duration_seconds: Option<f64>,
    state: &str,
) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO media_compatibility_artifacts
            (cache_key, document_id, source_path, source_fingerprint, inspection_hash,
             plan_json, output_path, output_container, output_size, duration_seconds,
             timeline_offset_seconds, state, error_code, created_at, last_accessed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
            plan_json = excluded.plan_json,
            output_path = excluded.output_path,
            output_container = excluded.output_container,
            output_size = excluded.output_size,
            duration_seconds = excluded.duration_seconds,
            state = excluded.state,
            error_code = NULL,
            last_accessed_at = excluded.last_accessed_at",
    )
    .bind(cache_key)
    .bind(document_id)
    .bind(source_path)
    .bind(source_fingerprint)
    .bind(inspection_hash)
    .bind(plan_json)
    .bind(output_path)
    .bind(output_container)
    .bind(output_size)
    .bind(duration_seconds)
    .bind(state)
    .bind(&now)
    .bind(&now)
    .execute(repo.pool())
    .await?;
    Ok(())
}

pub async fn mark_artifact_failed(
    repo: &Repository,
    cache_key: &str,
    error_code: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE media_compatibility_artifacts
         SET state = 'failed', error_code = ?, last_accessed_at = ?
         WHERE cache_key = ?",
    )
    .bind(error_code)
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(cache_key)
    .execute(repo.pool())
    .await?;
    Ok(())
}

pub async fn touch_artifact(repo: &Repository, cache_key: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE media_compatibility_artifacts SET last_accessed_at = ? WHERE cache_key = ?",
    )
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(cache_key)
    .execute(repo.pool())
    .await?;
    Ok(())
}

pub async fn delete_artifact_record(repo: &Repository, cache_key: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM media_compatibility_artifacts WHERE cache_key = ?")
        .bind(cache_key)
        .execute(repo.pool())
        .await?;
    Ok(())
}
