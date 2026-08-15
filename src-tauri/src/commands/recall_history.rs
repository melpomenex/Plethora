//! Recall prompt history commands (design D19, task 5.2).
//!
//! Every recall prompt shown to a reader is recorded in
//! `recall_prompt_history` (migration `085_ai_learning_system`) with a
//! normalized fingerprint so near-duplicate questions are never re-asked
//! inside the 30-day deduplication window (the fingerprint/near-duplicate
//! decision itself lives in TS — `src/lib/ai/recall/fingerprint.ts` — this
//! table is the shared store).
//!
//! Pruning: rows older than 90 days are deleted by a cheap `DELETE` inside
//! `record_recall_prompt` — no background job, no timer; a write is the
//! natural moment to prune because a prompt is only recorded when the
//! feature is in active use.
//!
//! Commands are registered next to the review commands (this is reading /
//! review infrastructure), NOT in the rag/ai_learning command groups.

use crate::error::Result;
use sqlx::{Pool, Row, Sqlite};
use tauri::State;

/// One `recall_prompt_history` row.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallPromptRecord {
    pub id: String,
    pub document_id: Option<String>,
    /// JSON-encoded chunk id array (semantic chunk ids or `approx-*` ids).
    pub chunk_ids: Vec<String>,
    pub fingerprint: String,
    pub question: String,
    /// RFC 3339 timestamp.
    pub asked_at: String,
    /// `asked` | `answered` | `dismissed` | `promoted`.
    pub outcome: String,
}

/// Days a recall prompt stays in the deduplication window (design D19).
pub const RECALL_DEDUP_WINDOW_DAYS: i64 = 30;
/// Days after which recall history rows are pruned.
pub const RECALL_PRUNE_DAYS: i64 = 90;

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn row_to_record(row: &sqlx::sqlite::SqliteRow) -> Result<RecallPromptRecord> {
    let chunk_ids_json: String = row.try_get("chunk_ids")?;
    let chunk_ids: Vec<String> = serde_json::from_str(&chunk_ids_json).unwrap_or_default();
    Ok(RecallPromptRecord {
        id: row.try_get("id")?,
        document_id: row.try_get("document_id").ok(),
        chunk_ids,
        fingerprint: row.try_get("fingerprint")?,
        question: row.try_get("question")?,
        asked_at: row.try_get("asked_at")?,
        outcome: row.try_get("outcome")?,
    })
}

/// Delete recall history older than `days`. Cheap, idempotent; invoked from
/// `record_recall_prompt` so no separate pruning job is needed.
pub async fn prune_recall_history(pool: &Pool<Sqlite>, days: i64) -> Result<u64> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
    let result = sqlx::query("DELETE FROM recall_prompt_history WHERE asked_at < ?1")
        .bind(&cutoff)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

/// Record a shown recall prompt and prune rows past the retention window.
#[tauri::command]
pub async fn record_recall_prompt(
    document_id: Option<String>,
    chunk_ids: Vec<String>,
    fingerprint: String,
    question: String,
    outcome: Option<String>,
    repo: State<'_, crate::database::Repository>,
) -> Result<RecallPromptRecord> {
    let pool = repo.pool();
    let record = RecallPromptRecord {
        id: uuid::Uuid::new_v4().to_string(),
        document_id,
        chunk_ids,
        fingerprint,
        question,
        asked_at: now_rfc3339(),
        outcome: outcome.unwrap_or_else(|| "asked".to_string()),
    };

    sqlx::query(
        r#"
        INSERT INTO recall_prompt_history (id, document_id, chunk_ids, fingerprint, question, asked_at, outcome)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
    )
    .bind(&record.id)
    .bind(&record.document_id)
    .bind(serde_json::to_string(&record.chunk_ids).unwrap_or_else(|_| "[]".into()))
    .bind(&record.fingerprint)
    .bind(&record.question)
    .bind(&record.asked_at)
    .bind(&record.outcome)
    .execute(pool)
    .await?;

    // Cheap retention prune piggybacked on every write.
    let _ = prune_recall_history(pool, RECALL_PRUNE_DAYS).await?;

    Ok(record)
}

/// Update the outcome of an already-recorded prompt (`asked` →
/// `answered`/`dismissed`/`promoted`) without inserting a new row.
#[tauri::command]
pub async fn set_recall_prompt_outcome(
    prompt_id: String,
    outcome: String,
    repo: State<'_, crate::database::Repository>,
) -> Result<bool> {
    let result = sqlx::query("UPDATE recall_prompt_history SET outcome = ?2 WHERE id = ?1")
        .bind(&prompt_id)
        .bind(&outcome)
        .execute(repo.pool())
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Recent recall prompts, newest first, for the deduplication window.
///
/// `document_id` scopes to one document (the common viewer case); without it
/// the query covers the whole library so cross-document duplicates are also
/// suppressed.
#[tauri::command]
pub async fn get_recent_recall_prompts(
    document_id: Option<String>,
    since_days: Option<i64>,
    repo: State<'_, crate::database::Repository>,
) -> Result<Vec<RecallPromptRecord>> {
    let pool = repo.pool();
    let days = since_days.unwrap_or(RECALL_DEDUP_WINDOW_DAYS).max(0);
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();

    let rows = match &document_id {
        Some(doc) => {
            sqlx::query(
                r#"
                SELECT id, document_id, chunk_ids, fingerprint, question, asked_at, outcome
                FROM recall_prompt_history
                WHERE document_id = ?1 AND asked_at >= ?2
                ORDER BY asked_at DESC
                "#,
            )
            .bind(doc)
            .bind(&cutoff)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query(
                r#"
                SELECT id, document_id, chunk_ids, fingerprint, question, asked_at, outcome
                FROM recall_prompt_history
                WHERE asked_at >= ?1
                ORDER BY asked_at DESC
                "#,
            )
            .bind(&cutoff)
            .fetch_all(pool)
            .await?
        }
    };

    rows.iter().map(row_to_record).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// In-memory pool through the shared `ai_learning` test-support pattern
    /// (full migration chain, including `recall_prompt_history`).
    async fn test_pool() -> sqlx::SqlitePool {
        crate::ai_learning::test_support::test_pool().await
    }

    async fn insert(
        pool: &sqlx::SqlitePool,
        id: &str,
        document_id: Option<&str>,
        fingerprint: &str,
        question: &str,
        asked_at: &str,
        outcome: &str,
    ) {
        sqlx::query(
            r#"
            INSERT INTO recall_prompt_history (id, document_id, chunk_ids, fingerprint, question, asked_at, outcome)
            VALUES (?1, ?2, '["chunk-1"]', ?3, ?4, ?5, ?6)
            "#,
        )
        .bind(id)
        .bind(document_id)
        .bind(fingerprint)
        .bind(question)
        .bind(asked_at)
        .bind(outcome)
        .execute(pool)
        .await
        .expect("insert recall prompt");
    }

    async fn fetch_recent(pool: &sqlx::SqlitePool, document_id: Option<&str>) -> Vec<RecallPromptRecord> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(RECALL_DEDUP_WINDOW_DAYS)).to_rfc3339();
        let rows = match document_id {
            Some(doc) => {
                sqlx::query(
                    "SELECT id, document_id, chunk_ids, fingerprint, question, asked_at, outcome \
                     FROM recall_prompt_history WHERE document_id = ?1 AND asked_at >= ?2 ORDER BY asked_at DESC",
                )
                .bind(doc)
                .bind(&cutoff)
                .fetch_all(pool)
                .await
                .unwrap()
            }
            None => {
                sqlx::query(
                    "SELECT id, document_id, chunk_ids, fingerprint, question, asked_at, outcome \
                     FROM recall_prompt_history WHERE asked_at >= ?1 ORDER BY asked_at DESC",
                )
                .bind(&cutoff)
                .fetch_all(pool)
                .await
                .unwrap()
            }
        };
        rows.iter().map(row_to_record).collect::<Result<_>>().unwrap()
    }

    #[tokio::test]
    async fn test_round_trip_and_json_chunk_ids() {
        let pool = test_pool().await;
        insert(&pool, "r1", Some("doc-1"), "fp-a", "Why can virtual memory exceed RAM?", &now_rfc3339(), "asked").await;

        let recent = fetch_recent(&pool, Some("doc-1")).await;
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, "r1");
        assert_eq!(recent[0].document_id.as_deref(), Some("doc-1"));
        assert_eq!(recent[0].chunk_ids, vec!["chunk-1".to_string()]);
        assert_eq!(recent[0].fingerprint, "fp-a");
        assert_eq!(recent[0].outcome, "asked");
    }

    #[tokio::test]
    async fn test_document_filter_and_window() {
        let pool = test_pool().await;
        insert(&pool, "r-doc1", Some("doc-1"), "fp-1", "Q1", &now_rfc3339(), "asked").await;
        insert(&pool, "r-doc2", Some("doc-2"), "fp-2", "Q2", &now_rfc3339(), "asked").await;

        // Document scoping.
        let doc1 = fetch_recent(&pool, Some("doc-1")).await;
        assert_eq!(doc1.len(), 1);
        assert_eq!(doc1[0].id, "r-doc1");

        // Library-wide query sees both.
        let all = fetch_recent(&pool, None).await;
        assert_eq!(all.len(), 2);

        // A row older than the dedup window drops out of the query…
        let old = (chrono::Utc::now() - chrono::Duration::days(RECALL_DEDUP_WINDOW_DAYS + 5)).to_rfc3339();
        insert(&pool, "r-old", Some("doc-1"), "fp-old", "Old question", &old, "asked").await;
        let doc1_after = fetch_recent(&pool, Some("doc-1")).await;
        assert_eq!(doc1_after.len(), 1);
        assert_eq!(doc1_after[0].id, "r-doc1");

        // …but is still younger than the 90-day prune horizon, so it survives.
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recall_prompt_history WHERE id = 'r-old'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn test_prune_deletes_only_old_rows() {
        let pool = test_pool().await;
        insert(&pool, "r-fresh", Some("doc-1"), "fp-f", "Fresh", &now_rfc3339(), "asked").await;
        let ancient = (chrono::Utc::now() - chrono::Duration::days(RECALL_PRUNE_DAYS + 10)).to_rfc3339();
        insert(&pool, "r-ancient", Some("doc-1"), "fp-a", "Ancient", &ancient, "answered").await;

        let deleted = prune_recall_history(&pool, RECALL_PRUNE_DAYS).await.unwrap();
        assert_eq!(deleted, 1);

        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM recall_prompt_history ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(ids, vec!["r-fresh".to_string()]);
    }

    #[tokio::test]
    async fn test_outcome_update() {
        let pool = test_pool().await;
        insert(&pool, "r-out", Some("doc-1"), "fp-o", "Q", &now_rfc3339(), "asked").await;

        let updated = sqlx::query("UPDATE recall_prompt_history SET outcome = 'answered' WHERE id = 'r-out'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(updated.rows_affected(), 1);

        let outcome: String = sqlx::query_scalar("SELECT outcome FROM recall_prompt_history WHERE id = 'r-out'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(outcome, "answered");
    }

    #[tokio::test]
    async fn test_malformed_chunk_ids_json_degrades_to_empty() {
        let pool = test_pool().await;
        sqlx::query(
            "INSERT INTO recall_prompt_history (id, document_id, chunk_ids, fingerprint, question, asked_at, outcome) \
             VALUES ('r-bad', NULL, 'not json', 'fp-x', 'Q', ?1, 'asked')",
        )
        .bind(now_rfc3339())
        .execute(&pool)
        .await
        .unwrap();

        let recent = fetch_recent(&pool, None).await;
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].chunk_ids, Vec::<String>::new());
    }
}
