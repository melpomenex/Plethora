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

    let next_physical = physical_ms.max(last_physical);
    let next_logical = if physical_ms <= last_physical {
        logical.saturating_add(1)
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
    .bind(next_physical)
    .execute(&mut **tx)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to advance sync clock: {e}")))?;

    Ok(format!("{next_physical}:{next_logical}"))
}


/// Observe a remote HLC before committing its mutation so the next local clock
/// is causally after every record this device has applied.
pub async fn observe_hlc(tx: &mut Transaction<'_, Sqlite>, remote_hlc: &str) -> Result<()> {
    let mut parts = remote_hlc.split(':');
    let remote_physical = parts
        .next()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let remote_logical = parts
        .next()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);

    let row = sqlx::query_as::<_, (i64, i64)>(
        "SELECT logical_time, last_physical_ms FROM sync_clock WHERE id = 1",
    )
    .fetch_optional(&mut **tx)
    .await?;
    let (local_logical, local_physical) = row.unwrap_or((0, 0));

    let physical = local_physical.max(remote_physical);
    let logical = if remote_physical > local_physical {
        remote_logical
    } else if remote_physical == local_physical {
        local_logical.max(remote_logical)
    } else {
        local_logical
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
    .bind(logical)
    .bind(physical)
    .execute(&mut **tx)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to observe remote sync clock: {e}")))?;

    Ok(())
}
