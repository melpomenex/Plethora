use crate::error::{PlethoraError, Result};
use sqlx::{Sqlite, Transaction};

/// Hybrid logical clock: `{physical_ms}:{logical_counter}` stored as TEXT.
pub async fn next_hlc(tx: &mut Transaction<'_, Sqlite>) -> Result<String> {
    let row = sqlx::query_as::<_, (i64, i64)>(
        "SELECT logical_time, last_physical_ms FROM sync_clock WHERE id = 1",
    )
    .fetch_optional(&mut **tx)
    .await?;

    let physical_ms = chrono::Utc::now().timestamp_millis();
    let (logical, last_physical) = row.unwrap_or((0, 0));

    let next_logical = if physical_ms <= last_physical {
        logical + 1
    } else {
        0
    };

    sqlx::query(
        r#"
        INSERT INTO sync_clock (id, logical_time, last_physical_ms)
        VALUES (1, ?1, ?2)
        ON CONFLICT(id) DO UPDATE SET
            logical_time = excluded.logical_time,
            last_physical_ms = excluded.last_physical_ms
        "#,
    )
    .bind(next_logical)
    .bind(physical_ms)
    .execute(&mut **tx)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to advance sync clock: {e}")))?;

    Ok(format!("{physical_ms}:{next_logical}"))
}
