use crate::error::{PlethoraError, Result};
use sqlx::{Pool, Sqlite};

pub async fn get_server_cursor(pool: &Pool<Sqlite>) -> Result<u64> {
    let cursor: Option<i64> =
        sqlx::query_scalar("SELECT last_server_cursor FROM sync_cursor WHERE id = 1")
            .fetch_optional(pool)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to read sync cursor: {e}")))?;
    Ok(cursor.unwrap_or(0).max(0) as u64)
}

pub async fn set_server_cursor(pool: &Pool<Sqlite>, cursor: u64) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO sync_cursor (id, last_server_cursor, device_id)
        VALUES (1, ?1, COALESCE((SELECT device_id FROM sync_cursor WHERE id = 1), ''))
        ON CONFLICT(id) DO UPDATE SET last_server_cursor = excluded.last_server_cursor
        "#,
    )
    .bind(cursor as i64)
    .execute(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to write sync cursor: {e}")))?;
    Ok(())
}

pub async fn touch_successful_sync(pool: &Pool<Sqlite>) -> Result<()> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"
        INSERT INTO sync_cursor (id, last_server_cursor, last_successful_sync, device_id)
        VALUES (1, 0, ?1, '')
        ON CONFLICT(id) DO UPDATE SET last_successful_sync = excluded.last_successful_sync
        "#,
    )
    .bind(now_ms)
    .execute(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to update last_successful_sync: {e}")))?;
    Ok(())
}
