//! Persisted, collection-scoped automatic recovery of overdue queue schedules.

use crate::commands::queue_bulk::{journal_queue_fields, QueueEntityKind};
use crate::database::Repository;
use crate::error::Result;
use crate::models::collection::DEFAULT_COLLECTION_ID;
use crate::sync::journal::notify_after_commit;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{Row, Sqlite};
use tauri::State;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AutoPostponeEntityType {
    LearningItem,
    Document,
    Extract,
    VideoExtract,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoPostponeCandidate {
    pub id: String,
    pub entity_type: AutoPostponeEntityType,
    pub due_date: Option<String>,
    pub last_review_date: Option<String>,
    pub interval: Option<f64>,
    pub priority_score: Option<f64>,
    pub stability: Option<f64>,
    pub difficulty: Option<f64>,
    pub review_count: i32,
    pub lapses: i32,
    pub is_suspended: bool,
    pub is_archived: bool,
    pub is_dismissed: bool,
    pub is_inactive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoPostponeCandidateSet {
    pub candidates: Vec<AutoPostponeCandidate>,
    /// Raw persisted dates for active scheduled items inside the planning window.
    /// The client groups these with Schedule's local-calendar date semantics.
    pub scheduled_dates: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoPostponePlanItem {
    pub id: String,
    pub entity_type: AutoPostponeEntityType,
    pub expected_due_date: String,
    pub target_due_date: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AutoPostponeOutcomeStatus {
    Postponed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoPostponeItemOutcome {
    pub id: String,
    pub status: AutoPostponeOutcomeStatus,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoPostponeApplyResult {
    pub outcomes: Vec<AutoPostponeItemOutcome>,
}

fn is_default_collection(collection_id: &str) -> bool {
    collection_id.is_empty() || collection_id == "default" || collection_id == DEFAULT_COLLECTION_ID
}

fn collection_predicate(column: &str, collection_id: Option<&str>) -> String {
    match collection_id {
        None => "1 = 1".to_string(),
        Some(cid) if is_default_collection(cid) => format!(
            "({column} IS NULL OR {column} = '' OR {column} = 'default' OR {column} = '{}')",
            DEFAULT_COLLECTION_ID
        ),
        Some(_) => format!("{column} = ?"),
    }
}

fn bind_collection<'q>(
    query: sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>>,
    collection_id: Option<&'q str>,
) -> sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    match collection_id {
        Some(cid) if !is_default_collection(cid) => query.bind(cid),
        _ => query,
    }
}

fn decode_candidate(
    row: &sqlx::sqlite::SqliteRow,
    entity_type: AutoPostponeEntityType,
) -> Result<AutoPostponeCandidate> {
    Ok(AutoPostponeCandidate {
        id: row.try_get("id")?,
        entity_type,
        due_date: row.try_get("due_date")?,
        last_review_date: row.try_get("last_review_date")?,
        interval: optional_number(row, "interval"),
        priority_score: optional_number(row, "priority_score"),
        stability: optional_number(row, "stability"),
        difficulty: optional_number(row, "difficulty"),
        review_count: row.try_get("review_count").unwrap_or(0),
        lapses: row.try_get("lapses").unwrap_or(0),
        is_suspended: row.try_get::<i32, _>("is_suspended").unwrap_or(0) != 0,
        is_archived: row.try_get::<i32, _>("is_archived").unwrap_or(0) != 0,
        is_dismissed: row.try_get::<i32, _>("is_dismissed").unwrap_or(0) != 0,
        is_inactive: row.try_get::<i32, _>("is_inactive").unwrap_or(0) != 0,
    })
}

fn optional_number(row: &sqlx::sqlite::SqliteRow, column: &str) -> Option<f64> {
    row.try_get::<Option<f64>, _>(column)
        .ok()
        .flatten()
        .or_else(|| {
            row.try_get::<Option<i64>, _>(column)
                .ok()
                .flatten()
                .map(|value| value as f64)
        })
}

async fn append_candidates(
    repo: &Repository,
    collection_id: Option<&str>,
    horizon_end: &str,
    candidates: &mut Vec<AutoPostponeCandidate>,
) -> Result<()> {
    let scope = collection_predicate("li.collection_id", collection_id);
    let parent_scope = collection_predicate("parent.collection_id", collection_id);
    let sql = format!(
        "SELECT li.id, li.due_date, li.last_review_date, li.interval, li.priority_score, \
                li.memory_state_stability AS stability, li.difficulty, li.review_count, li.lapses, \
                li.is_suspended, 0 AS is_archived, 0 AS is_dismissed, \
                CASE WHEN li.document_id IS NOT NULL AND li.document_id != '' AND d.id IS NULL THEN 1 \
                     WHEN COALESCE(d.is_archived, 0) != 0 OR COALESCE(d.is_dismissed, 0) != 0 THEN 1 \
                     WHEN li.document_id IS NOT NULL AND li.document_id != '' AND NOT EXISTS (\
                         SELECT 1 FROM documents parent WHERE parent.id = li.document_id AND {parent_scope}) THEN 1 \
                     ELSE 0 END AS is_inactive \
         FROM learning_items li LEFT JOIN documents d ON d.id = li.document_id \
         WHERE li.due_date IS NOT NULL AND (li.due_date < ? OR date(li.due_date) IS NULL) AND {scope}"
    );
    let mut query = sqlx::query(&sql);
    query = bind_collection(query, collection_id);
    query = query.bind(horizon_end);
    query = bind_collection(query, collection_id);
    for row in query.fetch_all(repo.pool()).await? {
        candidates.push(decode_candidate(
            &row,
            AutoPostponeEntityType::LearningItem,
        )?);
    }

    let scope = collection_predicate("d.collection_id", collection_id);
    let sql = format!(
        "SELECT d.id, d.next_reading_date AS due_date, d.date_last_reviewed AS last_review_date, \
                0.0 AS interval, d.priority_score, d.stability, d.difficulty, d.reps AS review_count, \
                0 AS lapses, 0 AS is_suspended, d.is_archived, d.is_dismissed, 0 AS is_inactive \
         FROM documents d WHERE d.next_reading_date IS NOT NULL \
           AND (d.next_reading_date < ? OR date(d.next_reading_date) IS NULL) \
           AND {scope}"
    );
    let mut query = sqlx::query(&sql).bind(horizon_end);
    query = bind_collection(query, collection_id);
    for row in query.fetch_all(repo.pool()).await? {
        candidates.push(decode_candidate(&row, AutoPostponeEntityType::Document)?);
    }

    let scope = collection_predicate("e.collection_id", collection_id);
    let parent_scope = collection_predicate("parent.collection_id", collection_id);
    let sql = format!(
        "SELECT e.id, e.next_review_date AS due_date, e.last_review_date, 0.0 AS interval, \
                e.priority_score, e.memory_state_stability AS stability, e.memory_state_difficulty AS difficulty, \
                e.review_count, 0 AS lapses, 0 AS is_suspended, COALESCE(d.is_archived, 0) AS is_archived, \
                CASE WHEN COALESCE(e.is_dismissed, 0) != 0 OR COALESCE(d.is_dismissed, 0) != 0 THEN 1 ELSE 0 END AS is_dismissed, \
                CASE WHEN d.id IS NULL THEN 1 \
                     WHEN NOT EXISTS (SELECT 1 FROM documents parent WHERE parent.id = e.document_id AND {parent_scope}) THEN 1 \
                     ELSE 0 END AS is_inactive \
         FROM extracts e LEFT JOIN documents d ON d.id = e.document_id \
         WHERE e.next_review_date IS NOT NULL \
           AND (e.next_review_date < ? OR date(e.next_review_date) IS NULL) \
           AND {scope}"
    );
    let mut query = sqlx::query(&sql);
    query = bind_collection(query, collection_id);
    query = query.bind(horizon_end);
    query = bind_collection(query, collection_id);
    for row in query.fetch_all(repo.pool()).await? {
        candidates.push(decode_candidate(&row, AutoPostponeEntityType::Extract)?);
    }

    // Video extracts have a persisted due date but no first-class sync entity.
    // Return them so the planner can report an explicit skip rather than silently
    // losing them from the discovered overdue count.
    let scope = collection_predicate("d.collection_id", collection_id);
    let sql = format!(
        "SELECT v.id, v.next_review_date AS due_date, v.last_review_date, 0.0 AS interval, \
                NULL AS priority_score, NULL AS stability, NULL AS difficulty, v.review_count, \
                0 AS lapses, 0 AS is_suspended, COALESCE(d.is_archived, 0) AS is_archived, \
                COALESCE(d.is_dismissed, 0) AS is_dismissed, CASE WHEN d.id IS NULL THEN 1 ELSE 0 END AS is_inactive \
         FROM video_extracts v LEFT JOIN documents d ON d.id = v.document_id \
         WHERE v.next_review_date IS NOT NULL \
           AND (v.next_review_date < ? OR date(v.next_review_date) IS NULL) \
           AND {scope}"
    );
    let mut query = sqlx::query(&sql).bind(horizon_end);
    query = bind_collection(query, collection_id);
    for row in query.fetch_all(repo.pool()).await? {
        candidates.push(decode_candidate(
            &row,
            AutoPostponeEntityType::VideoExtract,
        )?);
    }

    Ok(())
}

async fn append_scheduled_dates(
    repo: &Repository,
    collection_id: Option<&str>,
    window_start: &str,
    window_end: &str,
    dates: &mut Vec<String>,
) -> Result<()> {
    for (table, column, scope_column, filter) in [
        (
            "learning_items",
            "due_date",
            "collection_id",
            "is_suspended = 0 AND (document_id IS NULL OR document_id = '' OR EXISTS (\
                SELECT 1 FROM documents d WHERE d.id = learning_items.document_id \
                AND d.is_archived = 0 AND d.is_dismissed = 0))",
        ),
        (
            "documents",
            "next_reading_date",
            "collection_id",
            "is_archived = 0 AND is_dismissed = 0",
        ),
        (
            "extracts",
            "next_review_date",
            "collection_id",
            "is_dismissed = 0",
        ),
    ] {
        let scope = collection_predicate(scope_column, collection_id);
        let linked_parent_scope = match table {
            "learning_items" => format!(
                " AND (learning_items.document_id IS NULL OR learning_items.document_id = '' OR EXISTS (\
                     SELECT 1 FROM documents parent WHERE parent.id = learning_items.document_id AND {}))",
                collection_predicate("parent.collection_id", collection_id)
            ),
            "extracts" => format!(
                " AND EXISTS (SELECT 1 FROM documents parent WHERE parent.id = extracts.document_id AND {})",
                collection_predicate("parent.collection_id", collection_id)
            ),
            _ => String::new(),
        };
        let sql = format!(
            "SELECT {column} AS due_date FROM {table} WHERE {column} IS NOT NULL \
             AND {column} >= ? AND {column} < ? AND {filter}{linked_parent_scope} AND {scope}"
        );
        let mut query = sqlx::query(&sql).bind(window_start).bind(window_end);
        if matches!(table, "learning_items" | "extracts") {
            query = bind_collection(query, collection_id);
        }
        query = bind_collection(query, collection_id);
        for row in query.fetch_all(repo.pool()).await? {
            if let Ok(date) = row.try_get::<String, _>("due_date") {
                dates.push(date);
            }
        }
    }

    let scope = collection_predicate("d.collection_id", collection_id);
    let sql = format!(
        "SELECT v.next_review_date AS due_date FROM video_extracts v \
         JOIN documents d ON d.id = v.document_id \
         WHERE v.next_review_date IS NOT NULL AND v.next_review_date >= ? AND v.next_review_date < ? \
           AND d.is_archived = 0 AND d.is_dismissed = 0 AND {scope}"
    );
    let mut query = sqlx::query(&sql).bind(window_start).bind(window_end);
    query = bind_collection(query, collection_id);
    for row in query.fetch_all(repo.pool()).await? {
        if let Ok(date) = row.try_get::<String, _>("due_date") {
            dates.push(date);
        }
    }
    Ok(())
}

/// Return compact persisted candidates and existing workload for one collection.
#[tauri::command]
pub async fn get_auto_postpone_candidates(
    collection_id: Option<String>,
    window_start: String,
    window_end: String,
    repo: State<'_, Repository>,
) -> Result<AutoPostponeCandidateSet> {
    let mut candidates = Vec::new();
    append_candidates(
        repo.inner(),
        collection_id.as_deref(),
        &window_end,
        &mut candidates,
    )
    .await?;
    let mut scheduled_dates = Vec::new();
    append_scheduled_dates(
        repo.inner(),
        collection_id.as_deref(),
        &window_start,
        &window_end,
        &mut scheduled_dates,
    )
    .await?;
    Ok(AutoPostponeCandidateSet {
        candidates,
        scheduled_dates,
    })
}

async fn apply_one_plan_item(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    item: &AutoPostponePlanItem,
    collection_id: Option<&str>,
    now: &str,
) -> Result<bool> {
    let (sql, kind) = match item.entity_type {
        AutoPostponeEntityType::LearningItem => (
            "UPDATE learning_items SET due_date = ?, date_modified = ? \
             WHERE id = ? AND due_date = ? AND is_suspended = 0 \
               AND (document_id IS NULL OR document_id = '' OR EXISTS (SELECT 1 FROM documents d \
                    WHERE d.id = learning_items.document_id AND d.is_archived = 0 AND d.is_dismissed = 0))",
            QueueEntityKind::LearningItem,
        ),
        AutoPostponeEntityType::Document => (
            "UPDATE documents SET next_reading_date = ?, date_modified = ? \
             WHERE id = ? AND next_reading_date = ? AND is_archived = 0 AND is_dismissed = 0",
            QueueEntityKind::Document,
        ),
        AutoPostponeEntityType::Extract => (
            "UPDATE extracts SET next_review_date = ?, date_modified = ? \
             WHERE id = ? AND next_review_date = ? AND is_dismissed = 0 \
               AND EXISTS (SELECT 1 FROM documents d WHERE d.id = extracts.document_id \
                    AND d.is_archived = 0 AND d.is_dismissed = 0)",
            QueueEntityKind::Extract,
        ),
        AutoPostponeEntityType::VideoExtract => return Ok(false),
    };
    let scope_column = match item.entity_type {
        AutoPostponeEntityType::LearningItem => "collection_id",
        AutoPostponeEntityType::Document => "collection_id",
        AutoPostponeEntityType::Extract => "collection_id",
        AutoPostponeEntityType::VideoExtract => return Ok(false),
    };

    let scope_sql = match collection_id {
        None => String::new(),
        Some(cid) if is_default_collection(cid) => format!(
            " AND ({scope_column} IS NULL OR {scope_column} = '' OR {scope_column} = 'default' OR {scope_column} = '{}')",
            DEFAULT_COLLECTION_ID
        ),
        Some(_) => format!(" AND {scope_column} = ?"),
    };
    let linked_collection_scope = match item.entity_type {
        AutoPostponeEntityType::LearningItem => format!(
            " AND (learning_items.document_id IS NULL OR learning_items.document_id = '' OR EXISTS (\
                 SELECT 1 FROM documents parent WHERE parent.id = learning_items.document_id AND {}))",
            collection_predicate("parent.collection_id", collection_id)
        ),
        AutoPostponeEntityType::Extract => format!(
            " AND EXISTS (SELECT 1 FROM documents parent WHERE parent.id = extracts.document_id AND {})",
            collection_predicate("parent.collection_id", collection_id)
        ),
        AutoPostponeEntityType::Document | AutoPostponeEntityType::VideoExtract => String::new(),
    };
    let scoped_sql = format!("{sql}{linked_collection_scope}{scope_sql}");
    let mut query = sqlx::query(&scoped_sql)
        .bind(&item.target_due_date)
        .bind(now)
        .bind(&item.id)
        .bind(&item.expected_due_date);
    if matches!(
        item.entity_type,
        AutoPostponeEntityType::LearningItem | AutoPostponeEntityType::Extract
    ) {
        if let Some(cid) = collection_id.filter(|cid| !is_default_collection(cid)) {
            query = query.bind(cid);
        }
    }
    if let Some(cid) = collection_id.filter(|cid| !is_default_collection(cid)) {
        // Keep the fixed update and its active-collection guard in one statement.
        query = query.bind(cid);
    }

    let result = query.execute(&mut **tx).await?;
    if result.rows_affected() != 1 {
        return Ok(false);
    }
    journal_queue_fields(tx, kind, &item.id, &["schedule"]).await?;
    Ok(true)
}

/// Apply a planned recovery as a conditional, journaled database transaction.
#[tauri::command]
pub async fn apply_auto_postpone_plan(
    collection_id: Option<String>,
    plan: Vec<AutoPostponePlanItem>,
    repo: State<'_, Repository>,
) -> Result<AutoPostponeApplyResult> {
    let now = Utc::now().to_rfc3339();
    let mut outcomes = Vec::with_capacity(plan.len());
    let mut tx = repo.pool().begin().await?;

    for item in &plan {
        let applied = apply_one_plan_item(&mut tx, item, collection_id.as_deref(), &now).await?;
        outcomes.push(AutoPostponeItemOutcome {
            id: item.id.clone(),
            status: if applied {
                AutoPostponeOutcomeStatus::Postponed
            } else {
                AutoPostponeOutcomeStatus::Skipped
            },
            reason: (!applied).then(|| "changed-or-inactive-before-commit".to_string()),
        });
    }

    let changed_any = outcomes
        .iter()
        .any(|outcome| matches!(outcome.status, AutoPostponeOutcomeStatus::Postponed));
    tx.commit().await?;
    if changed_any {
        notify_after_commit();
    }
    Ok(AutoPostponeApplyResult { outcomes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::models::{Document, Extract, FileType, ItemType, LearningItem, VideoExtract};
    use chrono::Duration;
    use std::path::PathBuf;

    async fn setup_repo() -> Repository {
        let database = Database::new(PathBuf::from(":memory:"))
            .await
            .expect("database");
        database.migrate().await.expect("migrations");
        Repository::new(database.pool().clone())
    }

    async fn make_document(repo: &Repository, title: &str) -> String {
        repo.create_document(&Document::new(
            title.to_string(),
            format!("/tmp/{title}.pdf"),
            FileType::Pdf,
        ))
        .await
        .expect("document")
        .id
    }

    #[tokio::test]
    async fn candidate_read_finds_mixed_overdue_records_and_reports_video_extracts() {
        let repo = setup_repo().await;
        let document_id = make_document(&repo, "overdue").await;
        let item = LearningItem::new(ItemType::Basic, "question".into());
        let item_id = repo
            .create_learning_item(&item)
            .await
            .expect("learning item")
            .id;
        let extract = Extract::new(document_id.clone(), "text extract".into());
        let extract_id = repo.create_extract(&extract).await.expect("extract").id;
        let video = VideoExtract::new(document_id.clone(), 0.0, 10.0, "video segment".into());
        let video_id = repo
            .create_video_extract(&video)
            .await
            .expect("video extract")
            .id;
        let other_collection_document = make_document(&repo, "other collection").await;
        let archived_document = make_document(&repo, "archived").await;
        let suspended_item = LearningItem::new(ItemType::Basic, "suspended question".into());
        let suspended_item_id = repo
            .create_learning_item(&suspended_item)
            .await
            .expect("suspended learning item")
            .id;
        let archived_child = LearningItem::new(ItemType::Basic, "archived child question".into());
        let archived_child_id = repo
            .create_learning_item(&archived_child)
            .await
            .expect("archived child learning item")
            .id;
        let dismissed_extract = Extract::new(document_id.clone(), "dismissed extract".into());
        let dismissed_extract_id = repo
            .create_extract(&dismissed_extract)
            .await
            .expect("dismissed extract")
            .id;
        let overdue = (Utc::now() - Duration::days(40)).to_rfc3339();
        let due_today = Utc::now().to_rfc3339();
        for (table, column, id) in [
            ("documents", "next_reading_date", document_id.as_str()),
            ("learning_items", "due_date", item_id.as_str()),
            ("extracts", "next_review_date", extract_id.as_str()),
            ("video_extracts", "next_review_date", video_id.as_str()),
            (
                "documents",
                "next_reading_date",
                other_collection_document.as_str(),
            ),
            ("documents", "next_reading_date", archived_document.as_str()),
            ("learning_items", "due_date", suspended_item_id.as_str()),
            (
                "extracts",
                "next_review_date",
                dismissed_extract_id.as_str(),
            ),
        ] {
            let sql = format!("UPDATE {table} SET {column} = ? WHERE id = ?");
            sqlx::query(&sql)
                .bind(&overdue)
                .bind(id)
                .execute(repo.pool())
                .await
                .unwrap();
        }
        sqlx::query("UPDATE documents SET collection_id = 'other' WHERE id = ?")
            .bind(&other_collection_document)
            .execute(repo.pool())
            .await
            .unwrap();
        sqlx::query("UPDATE documents SET is_archived = 1 WHERE id = ?")
            .bind(&archived_document)
            .execute(repo.pool())
            .await
            .unwrap();
        let archived_child_due = (Utc::now() + Duration::days(5)).to_rfc3339();
        sqlx::query("UPDATE learning_items SET document_id = ?, due_date = ? WHERE id = ?")
            .bind(&archived_document)
            .bind(&archived_child_due)
            .bind(&archived_child_id)
            .execute(repo.pool())
            .await
            .unwrap();
        sqlx::query("UPDATE learning_items SET is_suspended = 1 WHERE id = ?")
            .bind(&suspended_item_id)
            .execute(repo.pool())
            .await
            .unwrap();
        sqlx::query("UPDATE extracts SET is_dismissed = 1 WHERE id = ?")
            .bind(&dismissed_extract_id)
            .execute(repo.pool())
            .await
            .unwrap();
        let today_document = make_document(&repo, "today").await;
        sqlx::query("UPDATE documents SET next_reading_date = ? WHERE id = ?")
            .bind(&due_today)
            .bind(&today_document)
            .execute(repo.pool())
            .await
            .unwrap();

        let mut candidates = Vec::new();
        append_candidates(
            &repo,
            Some(DEFAULT_COLLECTION_ID),
            &(Utc::now() + Duration::days(32)).to_rfc3339(),
            &mut candidates,
        )
        .await
        .unwrap();
        let candidate_ids: std::collections::HashSet<_> =
            candidates.iter().map(|item| item.id.as_str()).collect();
        assert!(candidate_ids.contains(document_id.as_str()));
        assert!(candidate_ids.contains(item_id.as_str()));
        assert!(candidate_ids.contains(extract_id.as_str()));
        assert!(candidate_ids.contains(video_id.as_str()));
        assert!(!candidate_ids.contains(other_collection_document.as_str()));
        let suspended = candidates
            .iter()
            .find(|candidate| candidate.id == suspended_item_id)
            .unwrap();
        assert!(suspended.is_suspended);
        let archived = candidates
            .iter()
            .find(|candidate| candidate.id == archived_document)
            .unwrap();
        assert!(archived.is_archived);
        let dismissed = candidates
            .iter()
            .find(|candidate| candidate.id == dismissed_extract_id)
            .unwrap();
        assert!(dismissed.is_dismissed);
        // Candidate lookup is deliberately broad; the pure planner applies
        // the strict local-calendar "before today" rule.
        assert!(candidate_ids.contains(today_document.as_str()));
        assert_eq!(
            candidates
                .iter()
                .find(|candidate| candidate.id == video_id)
                .unwrap()
                .entity_type,
            AutoPostponeEntityType::VideoExtract,
        );
        let mut scheduled_dates = Vec::new();
        append_scheduled_dates(
            &repo,
            Some(DEFAULT_COLLECTION_ID),
            &(Utc::now() + Duration::days(1)).to_rfc3339(),
            &(Utc::now() + Duration::days(32)).to_rfc3339(),
            &mut scheduled_dates,
        )
        .await
        .unwrap();
        assert!(!scheduled_dates.contains(&archived_child_due));
    }

    #[tokio::test]
    async fn non_default_collection_scope_is_bound_for_candidate_reads_and_batch_writes() {
        let repo = setup_repo().await;
        let document_id = make_document(&repo, "other collection document").await;
        let learning_item = LearningItem::new(ItemType::Basic, "other collection question".into());
        let learning_item_id = repo
            .create_learning_item(&learning_item)
            .await
            .expect("learning item")
            .id;
        let extract = Extract::new(document_id.clone(), "other collection extract".into());
        let extract_id = repo.create_extract(&extract).await.expect("extract").id;
        let old_due = (Utc::now() - Duration::days(40)).to_rfc3339();
        let target = (Utc::now() + Duration::days(4)).to_rfc3339();
        sqlx::query(
            "UPDATE documents SET collection_id = 'other', next_reading_date = ? WHERE id = ?",
        )
        .bind(&old_due)
        .bind(&document_id)
        .execute(repo.pool())
        .await
        .unwrap();
        sqlx::query("UPDATE learning_items SET collection_id = 'other', document_id = ?, due_date = ? WHERE id = ?")
            .bind(&document_id)
            .bind(&old_due)
            .bind(&learning_item_id)
            .execute(repo.pool())
            .await
            .unwrap();
        sqlx::query(
            "UPDATE extracts SET collection_id = 'other', next_review_date = ? WHERE id = ?",
        )
        .bind(&old_due)
        .bind(&extract_id)
        .execute(repo.pool())
        .await
        .unwrap();

        let mut candidates = Vec::new();
        append_candidates(
            &repo,
            Some("other"),
            &(Utc::now() + Duration::days(32)).to_rfc3339(),
            &mut candidates,
        )
        .await
        .unwrap();
        let candidate_ids: std::collections::HashSet<_> = candidates
            .iter()
            .map(|candidate| candidate.id.as_str())
            .collect();
        assert!(candidate_ids.contains(document_id.as_str()));
        assert!(candidate_ids.contains(learning_item_id.as_str()));
        assert!(candidate_ids.contains(extract_id.as_str()));

        let now = Utc::now().to_rfc3339();
        let mut tx = repo.pool().begin().await.unwrap();
        for (id, entity_type) in [
            (document_id.as_str(), AutoPostponeEntityType::Document),
            (
                learning_item_id.as_str(),
                AutoPostponeEntityType::LearningItem,
            ),
            (extract_id.as_str(), AutoPostponeEntityType::Extract),
        ] {
            let applied = apply_one_plan_item(
                &mut tx,
                &AutoPostponePlanItem {
                    id: id.to_string(),
                    entity_type,
                    expected_due_date: old_due.clone(),
                    target_due_date: target.clone(),
                },
                Some("other"),
                &now,
            )
            .await
            .unwrap();
            assert!(
                applied,
                "{entity_type:?} should match the active collection"
            );
        }
        tx.commit().await.unwrap();

        let mut wrong_collection_dates = Vec::new();
        append_scheduled_dates(
            &repo,
            Some("other"),
            &(Utc::now() + Duration::days(1)).to_rfc3339(),
            &(Utc::now() + Duration::days(32)).to_rfc3339(),
            &mut wrong_collection_dates,
        )
        .await
        .unwrap();
        assert_eq!(wrong_collection_dates.len(), 3);
    }

    #[tokio::test]
    async fn typed_batch_apply_preserves_review_state_and_skips_stale_plan_items() {
        let repo = setup_repo().await;
        let document_id = make_document(&repo, "scheduled").await;
        let item = LearningItem::new(ItemType::Basic, "question".into());
        let item_id = repo
            .create_learning_item(&item)
            .await
            .expect("learning item")
            .id;
        let extract = Extract::new(document_id.clone(), "text extract".into());
        let extract_id = repo.create_extract(&extract).await.expect("extract").id;
        let old_due = (Utc::now() - Duration::days(40)).to_rfc3339();
        let changed_due = (Utc::now() - Duration::days(39)).to_rfc3339();
        let target = (Utc::now() + Duration::days(5)).to_rfc3339();
        let last_review = (Utc::now() - Duration::days(50)).to_rfc3339();
        sqlx::query("UPDATE documents SET next_reading_date = ?, date_last_reviewed = ?, reps = 9, stability = 14.0, difficulty = 5.0 WHERE id = ?")
            .bind(&old_due).bind(&last_review).bind(&document_id).execute(repo.pool()).await.unwrap();
        sqlx::query("UPDATE learning_items SET due_date = ?, last_review_date = ?, interval = 23.0, review_count = 7, lapses = 2, memory_state_stability = 18.0 WHERE id = ?")
            .bind(&old_due).bind(&last_review).bind(&item_id).execute(repo.pool()).await.unwrap();
        sqlx::query("UPDATE extracts SET next_review_date = ?, last_review_date = ?, review_count = 4, memory_state_stability = 12.0 WHERE id = ?")
            .bind(&old_due).bind(&last_review).bind(&extract_id).execute(repo.pool()).await.unwrap();

        let plan = vec![
            AutoPostponePlanItem {
                id: document_id.clone(),
                entity_type: AutoPostponeEntityType::Document,
                expected_due_date: old_due.clone(),
                target_due_date: target.clone(),
            },
            AutoPostponePlanItem {
                id: item_id.clone(),
                entity_type: AutoPostponeEntityType::LearningItem,
                expected_due_date: old_due.clone(),
                target_due_date: target.clone(),
            },
            AutoPostponePlanItem {
                id: extract_id.clone(),
                entity_type: AutoPostponeEntityType::Extract,
                expected_due_date: old_due.clone(),
                target_due_date: target.clone(),
            },
            AutoPostponePlanItem {
                id: document_id.clone(),
                entity_type: AutoPostponeEntityType::Document,
                expected_due_date: changed_due,
                target_due_date: target.clone(),
            },
        ];
        let now = Utc::now().to_rfc3339();
        let mut tx = repo.pool().begin().await.unwrap();
        let mut applied = Vec::new();
        for item in &plan {
            applied.push(
                apply_one_plan_item(&mut tx, item, Some(DEFAULT_COLLECTION_ID), &now)
                    .await
                    .unwrap(),
            );
        }
        tx.commit().await.unwrap();
        assert_eq!(applied, vec![true, true, true, false]);

        let document = repo.get_document(&document_id).await.unwrap().unwrap();
        assert_eq!(document.next_reading_date.unwrap().to_rfc3339(), target);
        assert_eq!(
            document.date_last_reviewed.unwrap().to_rfc3339(),
            last_review
        );
        assert_eq!(document.reps, Some(9));
        assert_eq!(document.stability, Some(14.0));
        let item = repo
            .get_learning_item_by_id(&item_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(item.due_date.to_rfc3339(), target);
        assert_eq!(item.last_review_date.unwrap().to_rfc3339(), last_review);
        assert_eq!(item.interval, 23.0);
        assert_eq!(item.review_count, 7);
        assert_eq!(item.lapses, 2);
        let extract = repo.get_extract(&extract_id).await.unwrap().unwrap();
        assert_eq!(extract.next_review_date.unwrap().to_rfc3339(), target);
        assert_eq!(extract.last_review_date.unwrap().to_rfc3339(), last_review);
        assert_eq!(extract.review_count, 4);
    }

    #[tokio::test]
    async fn transaction_rolls_back_earlier_schedule_changes_after_a_later_write_fails() {
        let repo = setup_repo().await;
        let document_id = make_document(&repo, "reject schedule").await;
        let learning_item = LearningItem::new(ItemType::Basic, "question".into());
        let item_id = repo
            .create_learning_item(&learning_item)
            .await
            .expect("learning item")
            .id;
        let old_due = (Utc::now() - Duration::days(30)).to_rfc3339();
        let target = (Utc::now() + Duration::days(3)).to_rfc3339();
        sqlx::query("UPDATE learning_items SET due_date = ? WHERE id = ?")
            .bind(&old_due)
            .bind(&item_id)
            .execute(repo.pool())
            .await
            .unwrap();
        sqlx::query("UPDATE documents SET next_reading_date = ? WHERE id = ?")
            .bind(&old_due)
            .bind(&document_id)
            .execute(repo.pool())
            .await
            .unwrap();
        sqlx::query(
            "CREATE TRIGGER reject_auto_postpone_document BEFORE UPDATE OF next_reading_date ON documents \
             BEGIN SELECT RAISE(ABORT, 'forced schedule failure'); END",
        )
        .execute(repo.pool())
        .await
        .unwrap();

        let now = Utc::now().to_rfc3339();
        let mut tx = repo.pool().begin().await.unwrap();
        let first = AutoPostponePlanItem {
            id: item_id.clone(),
            entity_type: AutoPostponeEntityType::LearningItem,
            expected_due_date: old_due.clone(),
            target_due_date: target.clone(),
        };
        let second = AutoPostponePlanItem {
            id: document_id.clone(),
            entity_type: AutoPostponeEntityType::Document,
            expected_due_date: old_due.clone(),
            target_due_date: target,
        };
        assert!(
            apply_one_plan_item(&mut tx, &first, Some(DEFAULT_COLLECTION_ID), &now)
                .await
                .unwrap()
        );
        assert!(
            apply_one_plan_item(&mut tx, &second, Some(DEFAULT_COLLECTION_ID), &now)
                .await
                .is_err()
        );
        tx.rollback().await.unwrap();

        let unchanged = repo
            .get_learning_item_by_id(&item_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(unchanged.due_date.to_rfc3339(), old_due);
    }
}
