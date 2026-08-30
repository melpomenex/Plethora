use crate::error::{PlethoraError, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite, Transaction};
use uuid::Uuid;

use super::wire::WireConflict;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncIssueStatus {
    Open,
    Resolved,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncIssue {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub conflict_kind: String,
    pub local_change_id: Option<String>,
    pub server_revision: i64,
    pub base_revision: i64,
    pub status: String,
    pub created_at: i64,
}

pub async fn record_revision_conflict(pool: &Pool<Sqlite>, conflict: &WireConflict) -> Result<()> {
    let created_at = chrono::Utc::now().timestamp_millis();
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO sync_issues (
            id, entity_type, entity_id, conflict_kind, local_change_id,
            remote_hlc, server_revision, base_revision, status, created_at
        ) VALUES (?1, ?2, ?3, 'revision', ?4, NULL, ?5, ?6, 'open', ?7)
        ON CONFLICT(id) DO NOTHING
        "#,
    )
    .bind(&id)
    .bind(&conflict.entity_type)
    .bind(&conflict.entity_id)
    .bind(&conflict.change_id)
    .bind(conflict.server_revision)
    .bind(conflict.base_revision)
    .bind(created_at)
    .execute(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to record sync issue: {e}")))?;
    Ok(())
}

/// Records a batch of pulled records that failed authenticity verification.
/// Records written by a device that generated its own sync key (instead of
/// importing the account recovery key) are cryptographically unrecoverable for
/// every other device; they are surfaced here instead of aborting the pull.
pub async fn record_undecryptable_records(
    tx: &mut Transaction<'_, Sqlite>,
    device_id: &str,
    min_seq: u64,
    max_seq: u64,
    count: u64,
) -> Result<()> {
    let created_at = chrono::Utc::now().timestamp_millis();
    let id = Uuid::new_v4().to_string();
    let range = format!("seq {min_seq}-{max_seq} x{count}");
    sqlx::query(
        r#"
        INSERT INTO sync_issues (
            id, entity_type, entity_id, conflict_kind, local_change_id,
            remote_hlc, server_revision, base_revision, status, created_at
        ) VALUES (?1, 'sync_record', ?2, 'undecryptable', NULL, ?3, ?4, 0, 'open', ?5)
        ON CONFLICT(id) DO NOTHING
        "#,
    )
    .bind(&id)
    .bind(device_id)
    .bind(&range)
    .bind(max_seq as i64)
    .bind(created_at)
    .execute(&mut **tx)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to record undecryptable sync records: {e}")))?;
    Ok(())
}

pub async fn list_open_issues(pool: &Pool<Sqlite>, limit: i64) -> Result<Vec<SyncIssue>> {
    list_open_issues_ordered(pool, limit, false).await
}

pub async fn list_open_issues_for_resolution(pool: &Pool<Sqlite>, limit: i64) -> Result<Vec<SyncIssue>> {
    list_open_issues_ordered(pool, limit, true).await
}

async fn list_open_issues_ordered(
    pool: &Pool<Sqlite>,
    limit: i64,
    ascending: bool,
) -> Result<Vec<SyncIssue>> {
    let order = if ascending { "ASC" } else { "DESC" };
    let query = format!(
        r#"
        SELECT id, entity_type, entity_id, conflict_kind, local_change_id,
               server_revision, base_revision, status, created_at
        FROM sync_issues
        WHERE status = 'open'
        ORDER BY created_at {order}
        LIMIT ?1
        "#
    );
    let rows = sqlx::query_as::<_, (String, String, String, String, Option<String>, i64, i64, String, i64)>(&query)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to list sync issues: {e}")))?;

    Ok(rows
        .into_iter()
        .map(
            |(id, entity_type, entity_id, conflict_kind, local_change_id, server_revision, base_revision, status, created_at)| {
                SyncIssue {
                    id,
                    entity_type,
                    entity_id,
                    conflict_kind,
                    local_change_id,
                    server_revision,
                    base_revision,
                    status,
                    created_at,
                }
            },
        )
        .collect())
}

pub async fn resolve_issue(pool: &Pool<Sqlite>, issue_id: &str, resolution: &str) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        r#"
        UPDATE sync_issues
        SET status = 'resolved', resolution = ?2, resolved_at = ?3
        WHERE id = ?1 AND status = 'open'
        "#,
    )
    .bind(issue_id)
    .bind(resolution)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to resolve sync issue: {e}")))?;
    Ok(())
}

pub async fn apply_resolution_to_outbox(
    pool: &Pool<Sqlite>,
    issue_id: &str,
    resolution: &str,
) -> Result<()> {
    let row = sqlx::query_as::<_, (Option<String>, String, String)>(
        "SELECT local_change_id, entity_type, entity_id FROM sync_issues WHERE id = ?1",
    )
    .bind(issue_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to load sync issue: {e}")))?;

    let Some((change_id, _entity_type, _entity_id)) = row else {
        return Ok(());
    };

    match resolution {
        "keep_mine" | "both" => {
            if let Some(change_id) = change_id {
                sqlx::query(
                    "UPDATE sync_outbox SET sync_status = 'pending', base_revision = NULL WHERE change_id = ?1",
                )
                .bind(change_id)
                .execute(pool)
                .await?;
            }
        }
        "keep_theirs" => {
            if let Some(change_id) = change_id {
                sqlx::query(
                    "UPDATE sync_outbox SET sync_status = 'acknowledged' WHERE change_id = ?1",
                )
                .bind(change_id)
                .execute(pool)
                .await?;
            }
        }
        _ => {}
    }
    resolve_issue(pool, issue_id, resolution).await
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
    async fn undecryptable_records_are_surfaced_as_open_issues() {
        let pool = test_pool().await;
        let mut tx = pool.begin().await.expect("begin");
        record_undecryptable_records(
            &mut tx,
            "a6ef7ae5-d8bf-4af0-a6a5-3c209d78db49",
            853,
            958,
            106,
        )
        .await
        .expect("record");
        tx.commit().await.expect("commit");

        let issues = list_open_issues(&pool, 20).await.expect("list");
        assert_eq!(issues.len(), 1);
        let issue = &issues[0];
        assert_eq!(issue.conflict_kind, "undecryptable");
        assert_eq!(
            issue.entity_id,
            "a6ef7ae5-d8bf-4af0-a6a5-3c209d78db49".to_string()
        );
        assert_eq!(issue.server_revision, 958);
        assert!(issue.local_change_id.is_none());
    }
}
