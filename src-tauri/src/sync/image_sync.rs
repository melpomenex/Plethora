use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use sqlx::{Pool, Sqlite, Transaction};

use crate::error::{PlethoraError, Result};
use crate::models::ImageAsset;
use crate::plethora_auth::AuthManager;

use super::authenticated::with_bearer_retry;
use super::blobs;
use super::full_state::{register_alias, resolve_alias};
use super::keys::load_master_key;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LocalImagePayload {
    schema_version: u32,
    entity_type: String,
    id: String,
    mime_type: String,
    file_name: Option<String>,
    content_b64: String,
    byte_size: i64,
    sha256: String,
    width: Option<i32>,
    height: Option<i32>,
    created_at: String,
    updated_at: String,
    metadata: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteImagePayload {
    schema_version: u32,
    entity_type: String,
    pub id: String,
    mime_type: String,
    file_name: Option<String>,
    byte_size: i64,
    pub sha256: String,
    width: Option<i32>,
    height: Option<i32>,
    created_at: String,
    updated_at: String,
    metadata: Option<String>,
    pub blob_reference: String,
}

pub fn local_payload(asset: &ImageAsset) -> Result<Vec<u8>> {
    let payload = LocalImagePayload {
        schema_version: 2,
        entity_type: "image_asset".into(),
        id: asset.id.clone(),
        mime_type: asset.mime_type.clone(),
        file_name: asset.file_name.clone(),
        content_b64: base64::engine::general_purpose::STANDARD.encode(&asset.content),
        byte_size: asset.byte_size,
        sha256: asset.sha256.clone(),
        width: asset.width,
        height: asset.height,
        created_at: asset.created_at.to_rfc3339(),
        updated_at: asset.updated_at.to_rfc3339(),
        metadata: asset.metadata.clone(),
    };
    serde_json::to_vec(&payload)
        .map_err(|e| PlethoraError::Internal(format!("Image sync payload encode failed: {e}")))
}

pub async fn prepare_payload_for_push(
    auth: &AuthManager,
    master_key: &[u8; 32],
    local_payload: &[u8],
) -> Result<Vec<u8>> {
    let local: LocalImagePayload = serde_json::from_slice(local_payload)
        .map_err(|e| PlethoraError::Internal(format!("Image outbox payload decode failed: {e}")))?;
    let content = base64::engine::general_purpose::STANDARD
        .decode(local.content_b64.as_bytes())
        .map_err(|e| PlethoraError::Internal(format!("Image outbox content decode failed: {e}")))?;
    let actual_hash = format!("{:x}", sha2::Sha256::digest(&content));
    if actual_hash != local.sha256 {
        return Err(PlethoraError::Internal(
            "Image outbox content hash mismatch; refusing to upload".into(),
        ));
    }

    let blob_reference = with_bearer_retry(auth, |token| {
        blobs::upload_blob_if_missing(token, master_key, &content, &local.mime_type)
    })
    .await?;
    let remote = RemoteImagePayload {
        schema_version: 2,
        entity_type: "image_asset".into(),
        id: local.id,
        mime_type: local.mime_type,
        file_name: local.file_name,
        byte_size: local.byte_size,
        sha256: local.sha256,
        width: local.width,
        height: local.height,
        created_at: local.created_at,
        updated_at: local.updated_at,
        metadata: local.metadata,
        blob_reference,
    };
    serde_json::to_vec(&remote)
        .map_err(|e| PlethoraError::Internal(format!("Image wire payload encode failed: {e}")))
}

pub fn decode_remote(payload: &[u8]) -> Option<RemoteImagePayload> {
    serde_json::from_slice(payload).ok()
}

pub async fn index_local_identities(pool: &Pool<Sqlite>) -> Result<usize> {
    let rows =
        sqlx::query_as::<_, (String, String)>("SELECT id, sha256 FROM image_assets ORDER BY id")
            .fetch_all(pool)
            .await?;
    let mut tx = pool.begin().await?;
    for (id, sha256) in &rows {
        register_alias(
            &mut tx,
            "image_asset",
            id,
            id,
            Some(&format!("sha256:{}", sha256.to_ascii_lowercase())),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(rows.len())
}

pub async fn prepare_target(
    tx: &mut Transaction<'_, Sqlite>,
    payload: &RemoteImagePayload,
) -> Result<String> {
    if let Some(alias) = sqlx::query_scalar::<_, String>(
        "SELECT canonical_id FROM sync_entity_aliases WHERE entity_type = 'image_asset' AND source_id = ?1",
    )
    .bind(&payload.id)
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(alias);
    }

    let identity = format!("sha256:{}", payload.sha256.to_ascii_lowercase());
    let candidate: Option<String> = sqlx::query_scalar(
        "SELECT canonical_id FROM sync_entity_aliases WHERE entity_type = 'image_asset' AND identity_key = ?1 ORDER BY canonical_id LIMIT 1",
    )
    .bind(&identity)
    .fetch_optional(&mut **tx)
    .await?;
    let candidate =
        match candidate {
            Some(id) => Some(id),
            None => sqlx::query_scalar(
                "SELECT id FROM image_assets WHERE sha256 = ?1 AND id != ?2 ORDER BY id LIMIT 1",
            )
            .bind(&payload.sha256)
            .bind(&payload.id)
            .fetch_optional(&mut **tx)
            .await?,
        };

    let target = candidate.unwrap_or_else(|| payload.id.clone());
    register_alias(tx, "image_asset", &payload.id, &target, Some(&identity)).await?;
    Ok(target)
}

pub async fn apply_remote(
    tx: &mut Transaction<'_, Sqlite>,
    payload: &RemoteImagePayload,
) -> Result<String> {
    let target_id = prepare_target(tx, payload).await?;
    let created_at = chrono::DateTime::parse_from_rfc3339(&payload.created_at)
        .map(|value| value.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now());
    let updated_at = chrono::DateTime::parse_from_rfc3339(&payload.updated_at)
        .map(|value| value.with_timezone(&chrono::Utc))
        .unwrap_or(created_at);

    sqlx::query(
        r#"
        INSERT INTO image_assets (
            id, mime_type, file_name, content, byte_size, sha256,
            width, height, created_at, updated_at, metadata, sync_blob_reference
        ) VALUES (?1, ?2, ?3, X'', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            mime_type = excluded.mime_type,
            file_name = excluded.file_name,
            byte_size = excluded.byte_size,
            width = excluded.width,
            height = excluded.height,
            updated_at = excluded.updated_at,
            metadata = excluded.metadata,
            sync_blob_reference = excluded.sync_blob_reference
        "#,
    )
    .bind(&target_id)
    .bind(&payload.mime_type)
    .bind(&payload.file_name)
    .bind(payload.byte_size)
    .bind(&payload.sha256)
    .bind(payload.width)
    .bind(payload.height)
    .bind(created_at)
    .bind(updated_at)
    .bind(&payload.metadata)
    .bind(&payload.blob_reference)
    .execute(&mut **tx)
    .await?;

    Ok(target_id)
}

pub async fn delete_remote(tx: &mut Transaction<'_, Sqlite>, source_id: &str) -> Result<()> {
    let target = resolve_alias(tx, "image_asset", source_id).await?;
    sqlx::query("DELETE FROM image_assets WHERE id = ?1")
        .bind(target)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn hydrate_if_needed(
    pool: &Pool<Sqlite>,
    auth: &AuthManager,
    asset_id: &str,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    let target = resolve_alias(&mut tx, "image_asset", asset_id).await?;
    let row = sqlx::query_as::<_, (i64, String, String)>(
        r#"
        SELECT LENGTH(content), sha256, sync_blob_reference
        FROM image_assets
        WHERE id = ?1 AND sync_blob_reference IS NOT NULL
        "#,
    )
    .bind(&target)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;

    let Some((content_len, expected_sha256, blob_reference)) = row else {
        return Ok(());
    };
    if content_len > 0 {
        return Ok(());
    }

    let master_key = load_master_key()
        .await?
        .ok_or_else(|| PlethoraError::Internal("Sync encryption key not configured".into()))?;
    let download = with_bearer_retry(auth, |token| {
        blobs::request_download_url(token, &blob_reference)
    })
    .await?;
    let plaintext =
        blobs::download_and_decrypt(&download.download_url, &blob_reference, &master_key).await?;
    let actual_sha256 = format!("{:x}", sha2::Sha256::digest(&plaintext));
    if actual_sha256 != expected_sha256 {
        return Err(PlethoraError::Internal(
            "Hydrated image failed plaintext integrity verification".into(),
        ));
    }

    // Cache hydration is device-local materialization, not a user mutation:
    // write bytes without creating a new sync outbox record.
    sqlx::query("UPDATE image_assets SET content = ?1 WHERE id = ?2")
        .bind(plaintext)
        .bind(target)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("memory database");
        run_migrations(&pool).await.expect("migrations");
        pool
    }

    #[tokio::test]
    async fn remote_metadata_aliases_to_existing_plaintext_hash() {
        let pool = test_pool().await;
        sqlx::query(
            r#"
            INSERT INTO image_assets (
                id, mime_type, file_name, content, byte_size, sha256,
                width, height, created_at, updated_at
            ) VALUES ('local-image', 'image/png', 'local.png', X'0102', 2,
                      'abc123', 10, 20, datetime('now'), datetime('now'))
            "#,
        )
        .execute(&pool)
        .await
        .expect("local image");

        let remote = RemoteImagePayload {
            schema_version: 2,
            entity_type: "image_asset".into(),
            id: "remote-image".into(),
            mime_type: "image/png".into(),
            file_name: Some("remote.png".into()),
            byte_size: 2,
            sha256: "abc123".into(),
            width: Some(10),
            height: Some(20),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            metadata: Some(r#"{"caption":"synced"}"#.into()),
            blob_reference: format!("b1:{}", "a".repeat(64)),
        };

        let mut tx = pool.begin().await.expect("begin");
        let target = apply_remote(&mut tx, &remote).await.expect("apply");
        tx.commit().await.expect("commit");
        assert_eq!(target, "local-image");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM image_assets")
            .fetch_one(&pool)
            .await
            .expect("count");
        assert_eq!(count, 1);
        let alias: String = sqlx::query_scalar(
            "SELECT canonical_id FROM sync_entity_aliases WHERE entity_type = 'image_asset' AND source_id = 'remote-image'",
        )
        .fetch_one(&pool)
        .await
        .expect("alias");
        assert_eq!(alias, "local-image");
        let blob: String = sqlx::query_scalar(
            "SELECT sync_blob_reference FROM image_assets WHERE id = 'local-image'",
        )
        .fetch_one(&pool)
        .await
        .expect("blob reference");
        assert_eq!(blob, remote.blob_reference);
    }
}
