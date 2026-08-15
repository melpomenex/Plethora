//! Passage extract-worthiness score cache (design D23, task 6.6).
//!
//! `passage_scores` (migration `085_ai_learning_system`) is a pure cache
//! keyed by chunk content hash: the classification task runs on demand for
//! read viewport content only (never pre-computed for whole documents), and
//! this table makes a scored chunk free on re-read. Wiping it loses nothing
//! but re-scoring time.
//!
//! Registered with the knowledge-infrastructure commands (concept links /
//! element tree), NOT the rag/ai_learning groups.

use crate::error::Result;
use sqlx::Row;
use tauri::State;

/// One `passage_scores` row.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageScore {
    pub chunk_hash: String,
    pub passage_type: String,
    pub extract_worthiness: f64,
    pub suggested_action: Option<String>,
    pub model: Option<String>,
    pub created_at: String,
}

fn row_to_score(row: &sqlx::sqlite::SqliteRow) -> PassageScore {
    PassageScore {
        chunk_hash: row.try_get("chunk_hash").unwrap_or_default(),
        passage_type: row.try_get("passage_type").unwrap_or_default(),
        extract_worthiness: row.try_get("extract_worthiness").unwrap_or(0.0),
        suggested_action: row.try_get("suggested_action").ok(),
        model: row.try_get("model").ok(),
        created_at: row.try_get("created_at").unwrap_or_default(),
    }
}

const SCORE_COLUMNS: &str =
    "chunk_hash, passage_type, extract_worthiness, suggested_action, model, created_at";

/// Pool-level get (shared by the command and tests).
async fn get_score(pool: &sqlx::Pool<sqlx::Sqlite>, chunk_hash: &str) -> Result<Option<PassageScore>> {
    let row = sqlx::query(&format!(
        "SELECT {SCORE_COLUMNS} FROM passage_scores WHERE chunk_hash = ?1"
    ))
    .bind(chunk_hash)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| row_to_score(&r)))
}

/// Pool-level put (shared by the command and tests).
async fn put_score(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    chunk_hash: &str,
    passage_type: &str,
    extract_worthiness: f64,
    suggested_action: Option<&str>,
    model: Option<&str>,
) -> Result<PassageScore> {
    let clamped = extract_worthiness.clamp(0.0, 1.0);
    sqlx::query(
        r#"
        INSERT INTO passage_scores (chunk_hash, passage_type, extract_worthiness, suggested_action, model)
        VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(chunk_hash) DO UPDATE SET
            passage_type = excluded.passage_type,
            extract_worthiness = excluded.extract_worthiness,
            suggested_action = excluded.suggested_action,
            model = excluded.model,
            created_at = datetime('now')
        "#,
    )
    .bind(chunk_hash)
    .bind(passage_type)
    .bind(clamped)
    .bind(suggested_action)
    .bind(model)
    .execute(pool)
    .await?;

    let row = sqlx::query(&format!(
        "SELECT {SCORE_COLUMNS} FROM passage_scores WHERE chunk_hash = ?1"
    ))
    .bind(chunk_hash)
    .fetch_one(pool)
    .await?;
    Ok(row_to_score(&row))
}

/// Cached classification for one chunk content hash, if scored before.
#[tauri::command]
pub async fn get_passage_score(
    chunk_hash: String,
    state: State<'_, crate::database::Repository>,
) -> Result<Option<PassageScore>> {
    get_score(state.pool(), &chunk_hash).await
}

/// Cache a classification (INSERT OR REPLACE — the newest model verdict for
/// a content hash wins; content-addressed, so staleness is impossible).
#[tauri::command]
pub async fn put_passage_score(
    chunk_hash: String,
    passage_type: String,
    extract_worthiness: f64,
    suggested_action: Option<String>,
    model: Option<String>,
    state: State<'_, crate::database::Repository>,
) -> Result<PassageScore> {
    put_score(
        state.pool(),
        &chunk_hash,
        &passage_type,
        extract_worthiness,
        suggested_action.as_deref(),
        model.as_deref(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> sqlx::SqlitePool {
        crate::ai_learning::test_support::test_pool().await
    }

    #[tokio::test]
    async fn test_put_get_round_trip_and_replace() {
        let pool = pool().await;

        let stored = put_score(
            &pool, "hash-abc", "definition", 0.9,
            Some("extract"), Some("gemini-nano"),
        )
        .await
        .unwrap();
        assert_eq!(stored.chunk_hash, "hash-abc");
        assert_eq!(stored.passage_type, "definition");
        assert!((stored.extract_worthiness - 0.9).abs() < 1e-9);
        assert!(!stored.created_at.is_empty());

        let got = get_score(&pool, "hash-abc").await.unwrap().expect("cached score");
        assert_eq!(got.passage_type, "definition");
        assert_eq!(got.suggested_action.as_deref(), Some("extract"));
        assert_eq!(got.model.as_deref(), Some("gemini-nano"));

        // Re-scoring the same content replaces the verdict.
        put_score(&pool, "hash-abc", "supporting-detail", 1.7, None, Some("new-model"))
            .await
            .unwrap();
        let replaced = get_score(&pool, "hash-abc").await.unwrap().unwrap();
        assert_eq!(replaced.passage_type, "supporting-detail");
        assert!((replaced.extract_worthiness - 1.0).abs() < 1e-9);
        assert_eq!(replaced.model.as_deref(), Some("new-model"));

        // Unknown hash → None.
        assert!(get_score(&pool, "missing").await.unwrap().is_none());

        // Distinct hashes stay distinct.
        put_score(&pool, "hash-other", "transition", 0.1, None, None).await.unwrap();
        let other = get_score(&pool, "hash-other").await.unwrap().unwrap();
        assert_eq!(other.passage_type, "transition");
        assert_eq!(get_score(&pool, "hash-abc").await.unwrap().unwrap().passage_type, "supporting-detail");
    }
}
