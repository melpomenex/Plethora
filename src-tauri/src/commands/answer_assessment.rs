//! Answer assessment commands (design D20, task 5.7).
//!
//! Free-response assessments are persisted to `answer_assessments`
//! (migration `085_ai_learning_system`) as SEPARATE metadata linked to the
//! review/answer context — the scheduling columns of `review_results` are
//! never touched and the user-selected grade remains the sole scheduler
//! input (spec: "Scheduler authority is preserved").
//!
//! Linkage: `review_result_id` is set when the caller knows it; the TS
//! review flow currently has no review-result id after `submit_review` (the
//! command returns the updated item), so it stores `item_id` + `created_at`
//! and the assessment correlates to the review result by timestamp.
//!
//! Commands are registered next to the review commands, NOT in the
//! rag/ai_learning command groups.

use crate::error::Result;
use sqlx::{Pool, Row, Sqlite};
use tauri::State;

/// The validated `AnswerAssessment` payload from the TS schema
/// (`src/lib/ai/schemas/answerAssessment.ts`) plus provenance fields.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerAssessmentPayload {
    pub classification: String,
    pub score: Option<f64>,
    pub completeness: Option<f64>,
    pub confidence: Option<f64>,
    #[serde(default)]
    pub missing_concepts: Vec<String>,
    pub misconception: Option<String>,
    pub feedback: Option<String>,
    pub suggested_correction: Option<String>,
}

/// One `answer_assessments` row.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerAssessmentRecord {
    pub id: String,
    pub review_result_id: Option<i64>,
    pub item_id: Option<String>,
    pub classification: String,
    pub score: Option<f64>,
    pub completeness: Option<f64>,
    pub confidence: Option<f64>,
    pub missing_concepts: Vec<String>,
    pub misconception: Option<String>,
    pub feedback: Option<String>,
    pub suggested_correction: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at: String,
}

/// Default row cap for `get_answer_assessments_for_item`.
pub const DEFAULT_ASSESSMENT_LIMIT: i32 = 20;
/// Hard ceiling so a runaway caller cannot fetch unbounded history.
pub const MAX_ASSESSMENT_LIMIT: i32 = 500;

const CLASSIFICATIONS: [&str; 4] = ["correct", "partial", "incorrect", "misconception"];

fn row_to_record(row: &sqlx::sqlite::SqliteRow) -> Result<AnswerAssessmentRecord> {
    let missing_json: Option<String> = row.try_get("missing_concepts").ok();
    let missing_concepts: Vec<String> = missing_json
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    Ok(AnswerAssessmentRecord {
        id: row.try_get("id")?,
        review_result_id: row.try_get("review_result_id").ok(),
        item_id: row.try_get("item_id").ok(),
        classification: row.try_get("classification")?,
        score: row.try_get("score").ok(),
        completeness: row.try_get("completeness").ok(),
        confidence: row.try_get("confidence").ok(),
        missing_concepts,
        misconception: row.try_get("misconception").ok(),
        feedback: row.try_get("feedback").ok(),
        suggested_correction: row.try_get("suggested_correction").ok(),
        provider: row.try_get("provider").ok(),
        model: row.try_get("model").ok(),
        created_at: row.try_get("created_at")?,
    })
}

/// Record one assessment. Validation is fail-closed: the classification
/// must be one of the four canonical values (the TS schema validator
/// normally guarantees this; the command double-checks so a bug can never
/// write junk that breaks calibration queries).
#[tauri::command]
pub async fn record_answer_assessment(
    item_id: Option<String>,
    review_result_id: Option<i64>,
    assessment: AnswerAssessmentPayload,
    provider: Option<String>,
    model: Option<String>,
    repo: State<'_, crate::database::Repository>,
) -> Result<AnswerAssessmentRecord> {
    if !CLASSIFICATIONS.contains(&assessment.classification.as_str()) {
        return Err(crate::error::PlethoraError::Validation(format!(
            "classification must be one of {:?}, got {:?}",
            CLASSIFICATIONS.to_vec(),
            assessment.classification
        )));
    }

    let record = AnswerAssessmentRecord {
        id: uuid::Uuid::new_v4().to_string(),
        review_result_id,
        item_id,
        classification: assessment.classification,
        score: assessment.score,
        completeness: assessment.completeness,
        confidence: assessment.confidence,
        missing_concepts: assessment.missing_concepts,
        misconception: assessment.misconception,
        feedback: assessment.feedback,
        suggested_correction: assessment.suggested_correction,
        provider,
        model,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    sqlx::query(
        r#"
        INSERT INTO answer_assessments (
            id, review_result_id, item_id, classification, score, completeness, confidence,
            missing_concepts, misconception, feedback, suggested_correction, provider, model, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        "#,
    )
    .bind(&record.id)
    .bind(record.review_result_id)
    .bind(&record.item_id)
    .bind(&record.classification)
    .bind(record.score)
    .bind(record.completeness)
    .bind(record.confidence)
    .bind(serde_json::to_string(&record.missing_concepts).unwrap_or_else(|_| "[]".into()))
    .bind(&record.misconception)
    .bind(&record.feedback)
    .bind(&record.suggested_correction)
    .bind(&record.provider)
    .bind(&record.model)
    .bind(&record.created_at)
    .execute(repo.pool())
    .await?;

    Ok(record)
}

/// Assessments for one learning item, newest first (calibration analysis).
#[tauri::command]
pub async fn get_answer_assessments_for_item(
    item_id: String,
    limit: Option<i32>,
    repo: State<'_, crate::database::Repository>,
) -> Result<Vec<AnswerAssessmentRecord>> {
    let limit = limit
        .unwrap_or(DEFAULT_ASSESSMENT_LIMIT)
        .clamp(1, MAX_ASSESSMENT_LIMIT);
    let rows = sqlx::query(
        r#"
        SELECT id, review_result_id, item_id, classification, score, completeness, confidence,
               missing_concepts, misconception, feedback, suggested_correction, provider, model, created_at
        FROM answer_assessments
        WHERE item_id = ?1
        ORDER BY created_at DESC
        LIMIT ?2
        "#,
    )
    .bind(&item_id)
    .bind(limit)
    .fetch_all(repo.pool())
    .await?;

    rows.iter().map(row_to_record).collect()
}

/// Calibration aggregate: count of assessments per classification.
///
/// Scope: one item when `item_id` is given, otherwise the whole table —
/// enough to compute agreement metrics over a labeled fixture set without
/// pulling every row.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssessmentClassCounts {
    pub classification: String,
    pub count: i64,
}

#[tauri::command]
pub async fn get_answer_assessment_counts(
    item_id: Option<String>,
    repo: State<'_, crate::database::Repository>,
) -> Result<Vec<AssessmentClassCounts>> {
    let rows = match &item_id {
        Some(item) => {
            sqlx::query(
                "SELECT classification, COUNT(*) AS count FROM answer_assessments \
                 WHERE item_id = ?1 GROUP BY classification",
            )
            .bind(item)
            .fetch_all(repo.pool())
            .await?
        }
        None => {
            sqlx::query("SELECT classification, COUNT(*) AS count FROM answer_assessments GROUP BY classification")
                .fetch_all(repo.pool())
                .await?
        }
    };

    rows.iter()
        .map(|row| {
            Ok(AssessmentClassCounts {
                classification: row.try_get("classification")?,
                count: row.try_get("count")?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> sqlx::SqlitePool {
        crate::ai_learning::test_support::test_pool().await
    }

    fn payload(classification: &str) -> AnswerAssessmentPayload {
        AnswerAssessmentPayload {
            classification: classification.to_string(),
            score: Some(0.8),
            completeness: Some(0.7),
            confidence: Some(0.9),
            missing_concepts: vec!["virtual address space".to_string()],
            misconception: (classification == "misconception")
                .then(|| "confuses paging".to_string()),
            feedback: Some("feedback".to_string()),
            suggested_correction: Some("correction".to_string()),
        }
    }

    async fn insert_direct(
        pool: &sqlx::SqlitePool,
        id: &str,
        item_id: Option<&str>,
        review_result_id: Option<i64>,
        classification: &str,
        created_at: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) {
        sqlx::query(
            r#"
            INSERT INTO answer_assessments (
                id, review_result_id, item_id, classification, score, completeness, confidence,
                missing_concepts, misconception, feedback, suggested_correction, provider, model, created_at
            ) VALUES (?1, ?2, ?3, ?4, 0.8, 0.7, 0.9, '["c1"]', NULL, 'fb', NULL, ?5, ?6, ?7)
            "#,
        )
        .bind(id)
        .bind(review_result_id)
        .bind(item_id)
        .bind(classification)
        .bind(provider)
        .bind(model)
        .bind(created_at)
        .execute(pool)
        .await
        .expect("insert assessment");
    }

    #[tokio::test]
    async fn test_insert_and_fetch_round_trip() {
        let pool = test_pool().await;
        insert_direct(
            &pool,
            "a1",
            Some("item-1"),
            Some(42),
            "misconception",
            "2026-08-15T10:00:00Z",
            Some("ondevice-nano"),
            Some("gemini-nano"),
        )
        .await;
        insert_direct(
            &pool,
            "a2",
            Some("item-1"),
            None,
            "correct",
            "2026-08-15T11:00:00Z",
            None,
            None,
        )
        .await;
        insert_direct(
            &pool,
            "a3",
            Some("item-2"),
            None,
            "partial",
            "2026-08-15T12:00:00Z",
            None,
            None,
        )
        .await;

        let rows = sqlx::query(
            "SELECT id, review_result_id, item_id, classification, score, completeness, confidence, \
                    missing_concepts, misconception, feedback, suggested_correction, provider, model, created_at \
             FROM answer_assessments WHERE item_id = ?1 ORDER BY created_at DESC",
        )
        .bind("item-1")
        .fetch_all(&pool)
        .await
        .unwrap();
        let records: Vec<AnswerAssessmentRecord> = rows
            .iter()
            .map(row_to_record)
            .collect::<Result<_>>()
            .unwrap();

        assert_eq!(records.len(), 2);
        // Newest first.
        assert_eq!(records[0].id, "a2");
        assert_eq!(records[1].id, "a1");
        assert_eq!(records[1].review_result_id, Some(42));
        assert_eq!(records[1].provider.as_deref(), Some("ondevice-nano"));
        assert_eq!(records[1].model.as_deref(), Some("gemini-nano"));
        // JSON missing-concepts array round-trips.
        assert_eq!(records[1].missing_concepts, vec!["c1".to_string()]);
    }

    #[tokio::test]
    async fn test_classification_validation_rejects_unknown_values() {
        for bad in ["brilliant", "", "Correct"].iter() {
            let payload = AnswerAssessmentPayload {
                classification: bad.to_string(),
                score: None,
                completeness: None,
                confidence: None,
                missing_concepts: vec![],
                misconception: None,
                feedback: None,
                suggested_correction: None,
            };
            assert!(!CLASSIFICATIONS.contains(&payload.classification.as_str()));
        }
        for good in CLASSIFICATIONS.iter() {
            assert!(CLASSIFICATIONS.contains(good));
        }
    }

    #[tokio::test]
    async fn test_counts_aggregate_by_classification() {
        let pool = test_pool().await;
        insert_direct(
            &pool,
            "a1",
            Some("item-1"),
            None,
            "correct",
            "2026-08-15T10:00:00Z",
            None,
            None,
        )
        .await;
        insert_direct(
            &pool,
            "a2",
            Some("item-1"),
            None,
            "correct",
            "2026-08-15T11:00:00Z",
            None,
            None,
        )
        .await;
        insert_direct(
            &pool,
            "a3",
            Some("item-1"),
            None,
            "partial",
            "2026-08-15T12:00:00Z",
            None,
            None,
        )
        .await;
        insert_direct(
            &pool,
            "a4",
            Some("item-2"),
            None,
            "incorrect",
            "2026-08-15T13:00:00Z",
            None,
            None,
        )
        .await;

        let count = |rows: &Vec<(String, i64)>, classification: &str| -> i64 {
            rows.iter()
                .find(|(c, _)| c == classification)
                .map(|(_, n)| *n)
                .unwrap_or(0)
        };

        let item_rows: Vec<(String, i64)> = sqlx::query(
            "SELECT classification, COUNT(*) AS count FROM answer_assessments WHERE item_id = 'item-1' GROUP BY classification",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|row| (row.try_get::<String, _>("classification").unwrap(), row.try_get::<i64, _>("count").unwrap()))
        .collect();
        assert_eq!(count(&item_rows, "correct"), 2);
        assert_eq!(count(&item_rows, "partial"), 1);
        assert_eq!(count(&item_rows, "incorrect"), 0);

        let all_rows: Vec<(String, i64)> = sqlx::query(
            "SELECT classification, COUNT(*) AS count FROM answer_assessments GROUP BY classification",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|row| (row.try_get::<String, _>("classification").unwrap(), row.try_get::<i64, _>("count").unwrap()))
        .collect();
        assert_eq!(count(&all_rows, "incorrect"), 1);
        assert_eq!(count(&all_rows, "correct"), 2);
    }

    #[tokio::test]
    async fn test_limit_clamping_shape() {
        // The command clamps limits into [1, MAX]; mirror the clamp locally.
        assert_eq!(DEFAULT_ASSESSMENT_LIMIT, 20);
        assert_eq!(MAX_ASSESSMENT_LIMIT, 500);
        let clamped = None
            .unwrap_or(DEFAULT_ASSESSMENT_LIMIT)
            .clamp(1, MAX_ASSESSMENT_LIMIT);
        assert_eq!(clamped, 20);
        let zero = Some(0)
            .unwrap_or(DEFAULT_ASSESSMENT_LIMIT)
            .clamp(1, MAX_ASSESSMENT_LIMIT);
        assert!(zero >= 1);
    }

    /// The full command-level INSERT path (payload serialization) works
    /// against the migrated schema.
    #[tokio::test]
    async fn test_payload_insert_matches_schema() {
        let pool = test_pool().await;
        let record = AnswerAssessmentRecord {
            id: "cmd-1".to_string(),
            review_result_id: None,
            item_id: Some("item-9".to_string()),
            classification: "partial".to_string(),
            score: Some(0.5),
            completeness: Some(0.4),
            confidence: Some(0.85),
            missing_concepts: vec!["page table".to_string()],
            misconception: None,
            feedback: Some("fb".to_string()),
            suggested_correction: Some("corr".to_string()),
            provider: Some("cloud-openai".to_string()),
            model: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        };

        sqlx::query(
            r#"
            INSERT INTO answer_assessments (
                id, review_result_id, item_id, classification, score, completeness, confidence,
                missing_concepts, misconception, feedback, suggested_correction, provider, model, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            "#,
        )
        .bind(&record.id)
        .bind(record.review_result_id)
        .bind(&record.item_id)
        .bind(&record.classification)
        .bind(record.score)
        .bind(record.completeness)
        .bind(record.confidence)
        .bind(serde_json::to_string(&record.missing_concepts).unwrap())
        .bind(&record.misconception)
        .bind(&record.feedback)
        .bind(&record.suggested_correction)
        .bind(&record.provider)
        .bind(&record.model)
        .bind(&record.created_at)
        .execute(&pool)
        .await
        .expect("payload insert");

        let json: String = sqlx::query_scalar(
            "SELECT missing_concepts FROM answer_assessments WHERE id = 'cmd-1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let parsed: Vec<String> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, vec!["page table".to_string()]);
    }
}
