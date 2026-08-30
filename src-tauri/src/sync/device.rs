use crate::error::{PlethoraError, Result};
use sqlx::{Sqlite, Transaction};
use uuid::Uuid;

const DEVICE_ID_KEY: &str = "device_id";

/// Returns the persisted sync device id, creating sync_cursor + device id on first use.
pub async fn ensure_device_id(tx: &mut Transaction<'_, Sqlite>) -> Result<String> {
    if let Some(row) =
        sqlx::query_as::<_, (String,)>("SELECT device_id FROM sync_cursor WHERE id = 1")
            .fetch_optional(&mut **tx)
            .await?
    {
        if !row.0.is_empty() {
            return Ok(row.0);
        }
    }

    let device_id = Uuid::new_v4().to_string();
    let now_ms = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO sync_cursor (id, last_server_cursor, last_successful_sync, device_id)
        VALUES (1, 0, NULL, ?1)
        ON CONFLICT(id) DO UPDATE SET device_id = excluded.device_id
        "#,
    )
    .bind(&device_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to persist sync device id: {e}")))?;

    sqlx::query(
        "INSERT INTO sync_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(DEVICE_ID_KEY)
    .bind(&device_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to persist sync meta device id: {e}")))?;

    let _ = now_ms;
    Ok(device_id)
}

/// Adopt the server-issued device identity as this client's sync device id.
/// The sync transport authenticates every record against the device id embedded
/// in the access token, so the locally generated UUID must yield to the
/// identity the account issued at sign-in. Outbox rows are re-stamped at push
/// time and pull cursors never rewind, so the swap is seamless.
pub async fn adopt_device_id(
    tx: &mut Transaction<'_, Sqlite>,
    auth_device_id: &str,
) -> Result<String> {
    let auth_device_id = auth_device_id.trim();
    if auth_device_id.is_empty() {
        return ensure_device_id(tx).await;
    }
    let current = ensure_device_id(tx).await?;
    if current == auth_device_id {
        return Ok(current);
    }
    sqlx::query("UPDATE sync_cursor SET device_id = ?1 WHERE id = 1")
        .bind(auth_device_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to adopt sync device id: {e}")))?;
    sqlx::query(
        "INSERT INTO sync_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(DEVICE_ID_KEY)
    .bind(auth_device_id)
    .execute(&mut **tx)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to adopt sync device id: {e}")))?;
    Ok(auth_device_id.to_string())
}
