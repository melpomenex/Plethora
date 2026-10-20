//! Passage extract-worthiness score cache (design D23, task 6.6; change
//! `complete-reader-extract-worthiness-integration`).
//!
//! `passage_scores` (migration `085_ai_learning_system`, extended by `124`) is
//! a pure derived cache keyed by the full versioned passage digest
//! (normalization + normalized text + classifier prompt/schema revision +
//! actual provider/model revision). The classification task runs on demand for
//! read viewport content only (never pre-computed for whole documents), and
//! this table makes a scored passage free on re-read. Wiping it loses nothing
//! but re-scoring time.
//!
//! Privacy/correctness invariants enforced at this boundary:
//! - no source text, titles, geometry or document ids in `passage_scores`;
//! - invalid passage type / suggested action / NaN / out-of-range scores are
//!   rejected, not silently stored;
//! - legacy rows (NULL classifier/model metadata) stay readable and are
//!   treated as cache misses by the reader;
//! - dismissal keys are opaque and cascade with their document; they contain
//!   no text and are unique per (document, revision, passage, classifier).
//!
//! Registered with the knowledge-infrastructure commands (concept links /
//! element tree), NOT the rag/ai_learning groups.

use crate::error::{PlethoraError, Result};
use sqlx::Row;
use tauri::State;

pub const MAX_SCORE_HASH_LEN: usize = 256;
pub const MAX_REASON_LEN: usize = 1_000;
pub const MAX_REVISION_LEN: usize = 256;
pub const MAX_DISMISSAL_KEY_LEN: usize = 512;
pub const MAX_CACHE_ROWS: i64 = 100_000;

const PASSAGE_TYPES: &[&str] = &[
    "fundamental-claim",
    "definition",
    "important-example",
    "key-argument",
    "formula",
    "process",
    "comparison",
    "supporting-detail",
    "transition",
    "bibliography",
    "low-value",
];

const SUGGESTED_ACTIONS: &[&str] = &["none", "extract", "flashcard", "highlight"];

/// One `passage_scores` row.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageScore {
    pub chunk_hash: String,
    pub passage_type: String,
    pub extract_worthiness: f64,
    pub suggested_action: Option<String>,
    pub model: Option<String>,
    pub reason: Option<String>,
    pub classifier_version: Option<String>,
    pub model_revision: Option<String>,
    pub normalization_version: Option<String>,
    pub created_at: String,
}

/// One durable passage dismissal (opaque ids only; no text).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PassageScoreDismissal {
    pub document_id: String,
    pub source_revision: String,
    pub passage_id: String,
    pub classifier_version: String,
    pub dismissed_at: String,
}

fn optional_text(row: &sqlx::sqlite::SqliteRow, column: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(column).ok().flatten()
}

fn row_to_score(row: &sqlx::sqlite::SqliteRow) -> PassageScore {
    PassageScore {
        chunk_hash: row.try_get("chunk_hash").unwrap_or_default(),
        passage_type: row.try_get("passage_type").unwrap_or_default(),
        extract_worthiness: row.try_get("extract_worthiness").unwrap_or(0.0),
        suggested_action: optional_text(row, "suggested_action"),
        model: optional_text(row, "model"),
        reason: optional_text(row, "reason"),
        classifier_version: optional_text(row, "classifier_version"),
        model_revision: optional_text(row, "model_revision"),
        normalization_version: optional_text(row, "normalization_version"),
        created_at: row.try_get("created_at").unwrap_or_default(),
    }
}

fn row_to_dismissal(row: &sqlx::sqlite::SqliteRow) -> PassageScoreDismissal {
    PassageScoreDismissal {
        document_id: row.try_get("document_id").unwrap_or_default(),
        source_revision: row.try_get("source_revision").unwrap_or_default(),
        passage_id: row.try_get("passage_id").unwrap_or_default(),
        classifier_version: row.try_get("classifier_version").unwrap_or_default(),
        dismissed_at: row.try_get("dismissed_at").unwrap_or_default(),
    }
}

const SCORE_COLUMNS: &str =
    "chunk_hash, passage_type, extract_worthiness, suggested_action, model, \
     reason, classifier_version, model_revision, normalization_version, created_at";

fn bounded_optional(value: Option<&str>, label: &str, max: usize) -> Result<Option<String>> {
    match value {
        None => Ok(None),
        Some(raw) => {
            if raw.len() > max {
                return Err(PlethoraError::Validation(format!(
                    "{label} exceeds {max} characters"
                )));
            }
            Ok(Some(raw.to_string()))
        }
    }
}

/// Validate model-supplied fields before they reach SQLite. NaN/infinity and
/// out-of-range scores are rejected rather than clamped silently.
pub fn validate_score_input(
    chunk_hash: &str,
    passage_type: &str,
    extract_worthiness: f64,
    suggested_action: Option<&str>,
) -> Result<()> {
    if chunk_hash.trim().is_empty() || chunk_hash.len() > MAX_SCORE_HASH_LEN {
        return Err(PlethoraError::Validation(
            "passage score hash must be a non-empty bounded digest".into(),
        ));
    }
    if !PASSAGE_TYPES.contains(&passage_type) {
        return Err(PlethoraError::Validation(format!(
            "invalid passage type: {passage_type}"
        )));
    }
    if !extract_worthiness.is_finite() || !(0.0..=1.0).contains(&extract_worthiness) {
        return Err(PlethoraError::Validation(
            "extract worthiness must be finite and within [0, 1]".into(),
        ));
    }
    if let Some(action) = suggested_action {
        if !SUGGESTED_ACTIONS.contains(&action) {
            return Err(PlethoraError::Validation(format!(
                "invalid suggested action: {action}"
            )));
        }
    }
    Ok(())
}

fn validate_metadata(
    reason: Option<&str>,
    classifier_version: Option<&str>,
    model_revision: Option<&str>,
    normalization_version: Option<&str>,
) -> Result<()> {
    if let Some(reason) = reason {
        if reason.len() > MAX_REASON_LEN {
            return Err(PlethoraError::Validation(format!(
                "reason exceeds {MAX_REASON_LEN} characters"
            )));
        }
    }
    for (label, value) in [
        ("classifier version", classifier_version),
        ("model revision", model_revision),
        ("normalization version", normalization_version),
    ] {
        if let Some(value) = value {
            if value.len() > MAX_REVISION_LEN {
                return Err(PlethoraError::Validation(format!(
                    "{label} exceeds {MAX_REVISION_LEN} characters"
                )));
            }
        }
    }
    Ok(())
}

fn validate_dismissal_key(
    document_id: &str,
    source_revision: &str,
    passage_id: &str,
    classifier_version: &str,
) -> Result<()> {
    for (label, value) in [
        ("document id", document_id),
        ("source revision", source_revision),
        ("passage id", passage_id),
        ("classifier version", classifier_version),
    ] {
        if value.trim().is_empty() || value.len() > MAX_DISMISSAL_KEY_LEN {
            return Err(PlethoraError::Validation(format!(
                "invalid dismissal {label}"
            )));
        }
    }
    Ok(())
}

/// Pool-level get (shared by the command and tests).
async fn get_score(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    chunk_hash: &str,
) -> Result<Option<PassageScore>> {
    let row = sqlx::query(&format!(
        "SELECT {SCORE_COLUMNS} FROM passage_scores WHERE chunk_hash = ?1"
    ))
    .bind(chunk_hash)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| row_to_score(&r)))
}

#[allow(clippy::too_many_arguments)]
async fn put_score_full(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    chunk_hash: &str,
    passage_type: &str,
    extract_worthiness: f64,
    suggested_action: Option<&str>,
    model: Option<&str>,
    reason: Option<&str>,
    classifier_version: Option<&str>,
    model_revision: Option<&str>,
    normalization_version: Option<&str>,
) -> Result<PassageScore> {
    validate_score_input(
        chunk_hash,
        passage_type,
        extract_worthiness,
        suggested_action,
    )?;
    validate_metadata(
        reason,
        classifier_version,
        model_revision,
        normalization_version,
    )?;
    let reason = bounded_optional(reason, "reason", MAX_REASON_LEN)?;
    let model = bounded_optional(model, "model", MAX_REVISION_LEN)?;
    let classifier_version =
        bounded_optional(classifier_version, "classifier version", MAX_REVISION_LEN)?;
    let model_revision = bounded_optional(model_revision, "model revision", MAX_REVISION_LEN)?;
    let normalization_version = bounded_optional(
        normalization_version,
        "normalization version",
        MAX_REVISION_LEN,
    )?;

    sqlx::query(
        r#"
        INSERT INTO passage_scores (
            chunk_hash, passage_type, extract_worthiness, suggested_action, model,
            reason, classifier_version, model_revision, normalization_version
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(chunk_hash) DO UPDATE SET
            passage_type = excluded.passage_type,
            extract_worthiness = excluded.extract_worthiness,
            suggested_action = excluded.suggested_action,
            model = excluded.model,
            reason = excluded.reason,
            classifier_version = excluded.classifier_version,
            model_revision = excluded.model_revision,
            normalization_version = excluded.normalization_version,
            created_at = datetime('now')
        "#,
    )
    .bind(chunk_hash)
    .bind(passage_type)
    .bind(extract_worthiness)
    .bind(suggested_action)
    .bind(model.as_deref())
    .bind(reason)
    .bind(classifier_version)
    .bind(model_revision)
    .bind(normalization_version)
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

/// Legacy pool-level put used by older tests: clamps the score (the command
/// boundary above rejects invalid values instead).
async fn put_score(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    chunk_hash: &str,
    passage_type: &str,
    extract_worthiness: f64,
    suggested_action: Option<&str>,
    model: Option<&str>,
) -> Result<PassageScore> {
    let clamped = extract_worthiness.clamp(0.0, 1.0);
    put_score_full(
        pool,
        chunk_hash,
        passage_type,
        clamped,
        suggested_action,
        model,
        None,
        None,
        None,
        None,
    )
    .await
}

/// Delete all but the newest `keep_rows` derived scores (LRU by creation time).
async fn cleanup_scores(pool: &sqlx::Pool<sqlx::Sqlite>, keep_rows: i64) -> Result<i64> {
    let keep = keep_rows.clamp(0, MAX_CACHE_ROWS);
    let result = sqlx::query(
        r#"
        DELETE FROM passage_scores
        WHERE chunk_hash NOT IN (
            SELECT chunk_hash FROM passage_scores
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?1
        )
        "#,
    )
    .bind(keep)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() as i64)
}

async fn get_dismissals(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    document_id: &str,
) -> Result<Vec<PassageScoreDismissal>> {
    let rows = sqlx::query(
        r#"
        SELECT document_id, source_revision, passage_id, classifier_version, dismissed_at
        FROM passage_score_dismissals
        WHERE document_id = ?1
        ORDER BY dismissed_at DESC
        LIMIT 1000
        "#,
    )
    .bind(document_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_dismissal).collect())
}

async fn put_dismissal(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    document_id: &str,
    source_revision: &str,
    passage_id: &str,
    classifier_version: &str,
) -> Result<PassageScoreDismissal> {
    validate_dismissal_key(document_id, source_revision, passage_id, classifier_version)?;
    sqlx::query(
        r#"
        INSERT INTO passage_score_dismissals
            (document_id, source_revision, passage_id, classifier_version)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(document_id, source_revision, passage_id, classifier_version)
        DO UPDATE SET dismissed_at = datetime('now')
        "#,
    )
    .bind(document_id)
    .bind(source_revision)
    .bind(passage_id)
    .bind(classifier_version)
    .execute(pool)
    .await?;

    let row = sqlx::query(
        r#"
        SELECT document_id, source_revision, passage_id, classifier_version, dismissed_at
        FROM passage_score_dismissals
        WHERE document_id = ?1 AND source_revision = ?2 AND passage_id = ?3
          AND classifier_version = ?4
        "#,
    )
    .bind(document_id)
    .bind(source_revision)
    .bind(passage_id)
    .bind(classifier_version)
    .fetch_one(pool)
    .await?;
    Ok(row_to_dismissal(&row))
}

/// Cached classification for one full versioned digest, if scored before.
#[tauri::command]
pub async fn get_passage_score(
    chunk_hash: String,
    state: State<'_, crate::database::Repository>,
) -> Result<Option<PassageScore>> {
    get_score(state.pool(), &chunk_hash).await
}

/// Cache a classification (newest verdict for a digest wins).
///
/// Invalid enum/NaN/range input is rejected here, not silently stored. The
/// caller owns digest construction; this command never invents an identity.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn put_passage_score(
    chunk_hash: String,
    passage_type: String,
    extract_worthiness: f64,
    suggested_action: Option<String>,
    model: Option<String>,
    reason: Option<String>,
    classifier_version: Option<String>,
    model_revision: Option<String>,
    normalization_version: Option<String>,
    state: State<'_, crate::database::Repository>,
) -> Result<PassageScore> {
    validate_score_input(
        &chunk_hash,
        &passage_type,
        extract_worthiness,
        suggested_action.as_deref(),
    )?;
    validate_metadata(
        reason.as_deref(),
        classifier_version.as_deref(),
        model_revision.as_deref(),
        normalization_version.as_deref(),
    )?;
    put_score_full(
        state.pool(),
        &chunk_hash,
        &passage_type,
        extract_worthiness,
        suggested_action.as_deref(),
        model.as_deref(),
        reason.as_deref(),
        classifier_version.as_deref(),
        model_revision.as_deref(),
        normalization_version.as_deref(),
    )
    .await
}

/// Trim the derived score cache to its documented LRU budget. Never touches
/// user content (documents, extracts, highlights, cards).
#[tauri::command]
pub async fn cleanup_passage_scores(
    keep_rows: i64,
    state: State<'_, crate::database::Repository>,
) -> Result<i64> {
    cleanup_scores(state.pool(), keep_rows).await
}

/// Durable dismissals for one document (reopen survives; revisions are
/// filtered by the reader).
#[tauri::command]
pub async fn get_passage_score_dismissals(
    document_id: String,
    state: State<'_, crate::database::Repository>,
) -> Result<Vec<PassageScoreDismissal>> {
    get_dismissals(state.pool(), &document_id).await
}

/// Record one dismissal key. Unique per (document, revision, passage,
/// classifier); repeated dismissal refreshes the timestamp.
#[tauri::command]
pub async fn put_passage_score_dismissal(
    document_id: String,
    source_revision: String,
    passage_id: String,
    classifier_version: String,
    state: State<'_, crate::database::Repository>,
) -> Result<PassageScoreDismissal> {
    put_dismissal(
        state.pool(),
        &document_id,
        &source_revision,
        &passage_id,
        &classifier_version,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    async fn pool() -> sqlx::SqlitePool {
        crate::ai_learning::test_support::test_pool().await
    }

    async fn fk_pool() -> sqlx::SqlitePool {
        let pool = pool().await;
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .expect("enable foreign keys");
        pool
    }

    async fn seed_document(pool: &sqlx::SqlitePool, id: &str) {
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified) \
             VALUES (?1, 'Fixture', '/fixture.md', 'markdown', datetime('now'), datetime('now'))",
        )
        .bind(id)
        .execute(pool)
        .await
        .expect("seed document");
    }

    #[tokio::test]
    async fn test_put_get_round_trip_and_replace() {
        let pool = pool().await;

        let stored = put_score_full(
            &pool,
            "hash-abc",
            "definition",
            0.9,
            Some("extract"),
            Some("gemini-nano"),
            Some("Defines the core term."),
            Some("passage-classifier-v1:abc"),
            Some("ondevice#nano"),
            Some("passage-normalization-v1"),
        )
        .await
        .unwrap();
        assert_eq!(stored.chunk_hash, "hash-abc");
        assert_eq!(stored.passage_type, "definition");
        assert!((stored.extract_worthiness - 0.9).abs() < 1e-9);
        assert_eq!(stored.reason.as_deref(), Some("Defines the core term."));
        assert_eq!(
            stored.classifier_version.as_deref(),
            Some("passage-classifier-v1:abc")
        );
        assert_eq!(stored.model_revision.as_deref(), Some("ondevice#nano"));
        assert!(!stored.created_at.is_empty());

        let got = get_score(&pool, "hash-abc")
            .await
            .unwrap()
            .expect("cached score");
        assert_eq!(got.passage_type, "definition");
        assert_eq!(got.suggested_action.as_deref(), Some("extract"));
        assert_eq!(got.model.as_deref(), Some("gemini-nano"));
        assert_eq!(
            got.normalization_version.as_deref(),
            Some("passage-normalization-v1")
        );

        // Re-scoring the same content replaces the verdict.
        put_score(
            &pool,
            "hash-abc",
            "supporting-detail",
            1.7,
            None,
            Some("new-model"),
        )
        .await
        .unwrap();
        let replaced = get_score(&pool, "hash-abc").await.unwrap().unwrap();
        assert_eq!(replaced.passage_type, "supporting-detail");
        assert!((replaced.extract_worthiness - 1.0).abs() < 1e-9);
        assert_eq!(replaced.model.as_deref(), Some("new-model"));

        // Unknown hash → None.
        assert!(get_score(&pool, "missing").await.unwrap().is_none());

        // Distinct hashes stay distinct.
        put_score(&pool, "hash-other", "transition", 0.1, None, None)
            .await
            .unwrap();
        let other = get_score(&pool, "hash-other").await.unwrap().unwrap();
        assert_eq!(other.passage_type, "transition");
        assert_eq!(
            get_score(&pool, "hash-abc")
                .await
                .unwrap()
                .unwrap()
                .passage_type,
            "supporting-detail"
        );
    }

    #[test]
    fn rejects_invalid_enum_nan_and_range() {
        assert!(validate_score_input("h", "definition", 0.9, Some("extract")).is_ok());
        assert!(validate_score_input("", "definition", 0.9, None).is_err());
        assert!(validate_score_input("h", "not-a-type", 0.9, None).is_err());
        assert!(validate_score_input("h", "definition", f64::NAN, None).is_err());
        assert!(validate_score_input("h", "definition", f64::INFINITY, None).is_err());
        assert!(validate_score_input("h", "definition", -0.01, None).is_err());
        assert!(validate_score_input("h", "definition", 1.01, None).is_err());
        assert!(validate_score_input("h", "definition", 0.9, Some("invent")).is_err());
        assert!(validate_score_input("h", "definition", 0.0, Some("none")).is_ok());
        assert!(validate_score_input("h", "definition", 1.0, None).is_ok());
        assert!(
            validate_metadata(Some(&"x".repeat(MAX_REASON_LEN + 1)), None, None, None).is_err()
        );
        assert!(
            validate_metadata(None, Some(&"x".repeat(MAX_REVISION_LEN + 1)), None, None).is_err()
        );
    }

    #[tokio::test]
    async fn rejects_invalid_input_at_pool_level_too() {
        let pool = pool().await;
        assert!(put_score_full(
            &pool,
            "",
            "definition",
            0.9,
            None,
            None,
            None,
            None,
            None,
            None
        )
        .await
        .is_err());
        assert!(
            put_score_full(&pool, "h", "nope", 0.9, None, None, None, None, None, None)
                .await
                .is_err()
        );
        assert!(put_score_full(
            &pool,
            "h",
            "definition",
            f64::NAN,
            None,
            None,
            None,
            None,
            None,
            None
        )
        .await
        .is_err());
    }

    #[tokio::test]
    async fn legacy_rows_remain_readable_as_misses() {
        let pool = pool().await;
        // Simulate a pre-124 row: the older columns only.
        sqlx::query(
            "INSERT INTO passage_scores (chunk_hash, passage_type, extract_worthiness, suggested_action, model) \
             VALUES ('legacy-hash', 'definition', 0.88, 'extract', 'legacy-model')",
        )
        .execute(&pool)
        .await
        .expect("seed legacy score");

        let row = get_score(&pool, "legacy-hash").await.unwrap().unwrap();
        assert_eq!(row.passage_type, "definition");
        assert!((row.extract_worthiness - 0.88).abs() < 1e-9);
        assert!(row.reason.is_none());
        assert!(row.classifier_version.is_none());
        assert!(row.model_revision.is_none());
        assert!(row.normalization_version.is_none());
    }

    #[tokio::test]
    async fn cleanup_keeps_newest_rows_and_never_touches_documents() {
        let pool = pool().await;
        seed_document(&pool, "doc-cleanup").await;
        for index in 0..5 {
            put_score_full(
                &pool,
                &format!("hash-{index}"),
                "definition",
                0.9,
                Some("extract"),
                None,
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();
            // Ensure distinct, orderable creation timestamps.
            sqlx::query(
                "UPDATE passage_scores SET created_at = datetime('now', ?1) WHERE chunk_hash = ?2",
            )
            .bind(format!("+{} seconds", index))
            .bind(format!("hash-{index}"))
            .execute(&pool)
            .await
            .unwrap();
        }
        let removed = cleanup_scores(&pool, 2).await.unwrap();
        assert_eq!(removed, 3);
        let remaining: Vec<(String,)> =
            sqlx::query_as("SELECT chunk_hash FROM passage_scores ORDER BY created_at DESC")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(remaining.len(), 2);
        assert_eq!(remaining[0].0, "hash-4");
        assert_eq!(remaining[1].0, "hash-3");

        let (documents,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM documents WHERE id = 'doc-cleanup'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(documents, 1, "cache cleanup must not delete user content");

        // Negative/huge budgets stay bounded.
        assert!(cleanup_scores(&pool, -5).await.is_ok());
        let (rows,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM passage_scores")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[tokio::test]
    async fn dismissal_is_unique_and_cascades_with_document() {
        let pool = fk_pool().await;
        seed_document(&pool, "doc-dismiss").await;

        let first = put_dismissal(
            &pool,
            "doc-dismiss",
            "rev-1",
            "pdf:1:0-120",
            "classifier-v1",
        )
        .await
        .unwrap();
        assert_eq!(first.document_id, "doc-dismiss");
        // Repeating the same key is an update, not a duplicate row.
        put_dismissal(
            &pool,
            "doc-dismiss",
            "rev-1",
            "pdf:1:0-120",
            "classifier-v1",
        )
        .await
        .unwrap();
        put_dismissal(
            &pool,
            "doc-dismiss",
            "rev-2",
            "pdf:1:0-120",
            "classifier-v1",
        )
        .await
        .unwrap();
        let rows = get_dismissals(&pool, "doc-dismiss").await.unwrap();
        assert_eq!(rows.len(), 2, "different revisions stay distinct");

        assert!(put_dismissal(&pool, "", "rev-1", "p", "c").await.is_err());
        assert!(put_dismissal(&pool, "doc-dismiss", "", "p", "c")
            .await
            .is_err());

        // Document deletion cascades (no orphaned dismissal rows).
        sqlx::query("DELETE FROM documents WHERE id = 'doc-dismiss'")
            .execute(&pool)
            .await
            .unwrap();
        let rows = get_dismissals(&pool, "doc-dismiss").await.unwrap();
        assert!(rows.is_empty(), "dismissals cascade with the document");
    }

    #[tokio::test]
    async fn dismissal_table_contains_no_text_columns() {
        let pool = pool().await;
        let columns = sqlx::query("PRAGMA table_info(passage_score_dismissals)")
            .fetch_all(&pool)
            .await
            .unwrap();
        let names: Vec<String> = columns
            .iter()
            .map(|row| row.get::<String, _>("name"))
            .collect();
        assert_eq!(
            names,
            vec![
                "document_id",
                "source_revision",
                "passage_id",
                "classifier_version",
                "dismissed_at"
            ]
        );
    }
}
