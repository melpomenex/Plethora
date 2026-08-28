use crate::error::{PlethoraError, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTelemetryEvent {
    pub event_type: String,
    pub duration_ms: Option<u64>,
    pub accepted: Option<usize>,
    pub pulled: Option<usize>,
    pub conflicts: Option<usize>,
    pub failures: Option<u32>,
    pub created_at: i64,
}

pub async fn record_event(
    pool: &Pool<Sqlite>,
    event_type: &str,
    duration_ms: Option<u64>,
    accepted: Option<usize>,
    pulled: Option<usize>,
    conflicts: Option<usize>,
    failures: Option<u32>,
) -> Result<()> {
    let payload = SyncTelemetryEvent {
        event_type: event_type.to_string(),
        duration_ms,
        accepted,
        pulled,
        conflicts,
        failures,
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    let json = serde_json::to_string(&payload)
        .map_err(|e| PlethoraError::Internal(format!("telemetry encode failed: {e}")))?;
    sqlx::query(
        "INSERT INTO sync_telemetry (event_type, payload_json, created_at) VALUES (?1, ?2, ?3)",
    )
    .bind(event_type)
    .bind(json)
    .bind(payload.created_at)
    .execute(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("telemetry insert failed: {e}")))?;
    Ok(())
}

pub async fn recent_events(pool: &Pool<Sqlite>, limit: i64) -> Result<Vec<SyncTelemetryEvent>> {
    let rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT payload_json, created_at FROM sync_telemetry ORDER BY created_at DESC LIMIT ?1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("telemetry read failed: {e}")))?;

    Ok(rows
        .into_iter()
        .filter_map(|(json, _)| serde_json::from_str::<SyncTelemetryEvent>(&json).ok())
        .collect())
}
