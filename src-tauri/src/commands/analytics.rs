//! Analytics commands for dashboard statistics

use crate::database::Repository;
use chrono::{Duration, NaiveDate, Utc};
use sqlx::Row;
use tauri::State;

/// Statistics overview for the dashboard
#[derive(Debug, Clone, serde::Serialize)]
pub struct DashboardStats {
    pub total_cards: i32,
    pub cards_due_today: i32,
    pub cards_learned: i32,
    pub reviews_today: i32,
    pub study_streak: i32,
    pub retention_rate: f64,
    pub average_difficulty: f64,
    pub total_documents: i32,
    pub total_extracts: i32,
}

/// Activity data for a single day
#[derive(Debug, Clone, serde::Serialize)]
pub struct ActivityDay {
    pub date: String,
    pub reviews_count: i32,
    pub cards_learned: i32,
    pub time_spent_minutes: i32,
    pub retention_rate: f64,
}

/// Memory statistics
#[derive(Debug, Clone, serde::Serialize)]
pub struct MemoryStats {
    pub average_stability: f64,
    pub average_difficulty: f64,
    pub mature_cards: i32,
    pub young_cards: i32,
    pub new_cards: i32,
}

/// Category breakdown
#[derive(Debug, Clone, serde::Serialize)]
pub struct CategoryStats {
    pub category: String,
    pub card_count: i32,
    pub reviews_count: i32,
    pub retention_rate: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LeechItem {
    pub id: String,
    pub question: String,
    pub lapses: i32,
    pub review_count: i32,
    pub suggested_actions: Vec<String>,
}

/// Get overall dashboard statistics
#[tauri::command]
pub async fn get_dashboard_stats(
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<DashboardStats, String> {
    let pool = repo.pool();
    let cid = collection_id
        .unwrap_or_else(|| crate::models::collection::DEFAULT_COLLECTION_ID.to_string());

    let now = Utc::now();
    let today_start = now
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .expect("invalid time 0:0:0")
        .and_utc();
    let today_end = now
        .date_naive()
        .and_hms_opt(23, 59, 59)
        .expect("invalid time 23:59:59")
        .and_utc();

    // Total cards
    let total_cards: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM learning_items WHERE is_suspended = false AND collection_id = ?",
    )
    .bind(&cid)
    .fetch_one(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    // Cards due today
    let cards_due_today: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM learning_items WHERE due_date <= ? AND is_suspended = false AND collection_id = ?"
    )
    .bind(now)
    .bind(&cid)
    .fetch_one(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    // Cards learned (reviewed at least once)
    let cards_learned: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM learning_items WHERE review_count > 0 AND is_suspended = false AND collection_id = ?"
    )
    .bind(&cid)
    .fetch_one(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    // Reviews today (from review count vs last_review_date)
    // This is an approximation - we'll use items reviewed today
    let reviews_today: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM learning_items WHERE last_review_date >= ? AND last_review_date <= ? AND is_suspended = false AND collection_id = ?"
    )
    .bind(today_start)
    .bind(today_end)
    .bind(&cid)
    .fetch_one(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    // Study streak calculation
    let study_streak = calculate_study_streak(pool).await?;

    // Retention rate (cards reviewed with Good/Easy vs total reviews)
    // Approximation: cards with interval > 0 and low lapse rate
    let retention_row: Option<f64> = sqlx::query_scalar(
        "SELECT CAST(COUNT(*) AS REAL) / (SELECT COUNT(*) FROM learning_items WHERE review_count > 0 AND is_suspended = false AND collection_id = ?)
         FROM learning_items WHERE lapses = 0 AND review_count > 0 AND is_suspended = false AND collection_id = ?"
    )
    .bind(&cid)
    .bind(&cid)
    .fetch_optional(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;
    let retention_rate = retention_row.unwrap_or(0.0) * 100.0;

    // Average difficulty
    let avg_diff_row: Option<f64> = sqlx::query_scalar(
        "SELECT AVG(memory_state_difficulty) FROM learning_items WHERE memory_state_difficulty IS NOT NULL AND is_suspended = false AND collection_id = ?"
    )
    .bind(&cid)
    .fetch_optional(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;
    let average_difficulty = avg_diff_row.unwrap_or(0.0);

    // Total documents
    let total_documents: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM documents WHERE collection_id = ?")
            .bind(&cid)
            .fetch_one(pool)
            .await
            .map_err(|e: sqlx::Error| e.to_string())?;

    // Total extracts
    let total_extracts: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM extracts WHERE collection_id = ?")
            .bind(&cid)
            .fetch_one(pool)
            .await
            .map_err(|e: sqlx::Error| e.to_string())?;

    Ok(DashboardStats {
        total_cards: total_cards as i32,
        cards_due_today: cards_due_today as i32,
        cards_learned: cards_learned as i32,
        reviews_today: reviews_today as i32,
        study_streak,
        retention_rate,
        average_difficulty,
        total_documents: total_documents as i32,
        total_extracts: total_extracts as i32,
    })
}

/// Calculate study streak (consecutive days with reviews)
async fn calculate_study_streak(pool: &sqlx::Pool<sqlx::Sqlite>) -> Result<i32, String> {
    let mut streak = 0;
    let mut current_date = Utc::now().date_naive();

    let today_start = current_date
        .and_hms_opt(0, 0, 0)
        .expect("invalid time 0:0:0")
        .and_utc();
    let today_end = current_date
        .and_hms_opt(23, 59, 59)
        .expect("invalid time 23:59:59")
        .and_utc();

    let reviews_today: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM learning_items WHERE last_review_date >= ? AND last_review_date <= ? AND is_suspended = false"
    )
    .bind(today_start)
    .bind(today_end)
    .fetch_one(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    // If no reviews today, check from yesterday
    if reviews_today == 0 {
        current_date = current_date.pred_opt().expect("no previous date");
    }

    // Count consecutive days backwards
    loop {
        let day_start = current_date
            .and_hms_opt(0, 0, 0)
            .expect("invalid time 0:0:0")
            .and_utc();
        let day_end = current_date
            .and_hms_opt(23, 59, 59)
            .expect("invalid time 23:59:59")
            .and_utc();

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM learning_items WHERE last_review_date >= ? AND last_review_date <= ? AND is_suspended = false"
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_one(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

        if count > 0 {
            streak += 1;
            current_date = current_date.pred_opt().expect("no previous date");
        } else {
            break;
        }

        // Safety limit to prevent infinite loops
        if streak > 3650 {
            break;
        }
    }

    Ok(streak)
}

/// Get memory statistics
#[tauri::command]
pub async fn get_memory_stats(repo: State<'_, Repository>) -> Result<MemoryStats, String> {
    let pool = repo.pool();

    let avg_stability_row: Option<f64> = sqlx::query_scalar(
        "SELECT AVG(memory_state_stability) FROM learning_items WHERE memory_state_stability IS NOT NULL AND is_suspended = false"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;
    let average_stability = avg_stability_row.unwrap_or(0.0);

    let avg_difficulty_row: Option<f64> = sqlx::query_scalar(
        "SELECT AVG(memory_state_difficulty) FROM learning_items WHERE memory_state_difficulty IS NOT NULL AND is_suspended = false"
    )
    .fetch_optional(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;
    let average_difficulty = avg_difficulty_row.unwrap_or(0.0);

    // Mature cards: interval >= 21 days
    let mature_cards: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM learning_items WHERE interval >= 21 AND is_suspended = false",
    )
    .fetch_one(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    // Young cards: reviewed but interval < 21 days
    let young_cards: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM learning_items WHERE review_count > 0 AND interval < 21 AND is_suspended = false"
    )
    .fetch_one(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    // New cards: never reviewed
    let new_cards: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM learning_items WHERE review_count = 0 AND is_suspended = false",
    )
    .fetch_one(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    Ok(MemoryStats {
        average_stability,
        average_difficulty,
        mature_cards: mature_cards as i32,
        young_cards: young_cards as i32,
        new_cards: new_cards as i32,
    })
}

/// Get activity data for the last N days
#[tauri::command]
pub async fn get_activity_data(
    days: i32,
    repo: State<'_, Repository>,
) -> Result<Vec<ActivityDay>, String> {
    let pool = repo.pool();
    let mut activities = Vec::new();

    for i in 0..days {
        let date = Utc::now().date_naive() - Duration::days(i as i64);
        let day_start = date
            .and_hms_opt(0, 0, 0)
            .expect("invalid time 0:0:0")
            .and_utc();
        let day_end = date
            .and_hms_opt(23, 59, 59)
            .expect("invalid time 23:59:59")
            .and_utc();

        // Reviews count
        let reviews_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM review_results WHERE timestamp >= ? AND timestamp <= ?",
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_one(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

        // Cards learned (first review)
        let cards_learned: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM learning_items WHERE last_review_date >= ? AND last_review_date <= ? AND review_count = 1 AND is_suspended = false"
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_one(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

        // Time spent from review_results
        let total_seconds: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(time_taken), 0) FROM review_results WHERE timestamp >= ? AND timestamp <= ?"
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_one(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;
        let time_spent_minutes = (total_seconds / 60) as i32;

        // Retention overlay for heatmap: Good/Easy ratio for that day
        let correct_reviews: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM review_results WHERE timestamp >= ? AND timestamp <= ? AND rating >= 3"
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_one(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;
        let retention_rate = if reviews_count > 0 {
            (correct_reviews as f64 / reviews_count as f64) * 100.0
        } else {
            0.0
        };

        activities.push(ActivityDay {
            date: date.to_string(),
            reviews_count: reviews_count as i32,
            cards_learned: cards_learned as i32,
            time_spent_minutes,
            retention_rate,
        });
    }

    // Reverse to get chronological order
    activities.reverse();
    Ok(activities)
}

/// Get category statistics.
///
/// Categories come from BOTH extracts and documents (documents gained
/// categories as a free-form field; the Stats breakdown previously grouped
/// extract categories only — issue #44 bug 11). Each card is attributed
/// once: its extract's category when it has one, else its document's.
#[tauri::command]
pub async fn get_category_stats(repo: State<'_, Repository>) -> Result<Vec<CategoryStats>, String> {
    category_stats(repo.pool()).await
}

/// Pure query body of [`get_category_stats`], separated so the grouping is
/// unit-testable without a Tauri app handle.
async fn category_stats(
    pool: &sqlx::SqlitePool,
) -> Result<Vec<CategoryStats>, String> {
    let rows = sqlx::query(
        r#"
        WITH categories AS (
            SELECT DISTINCT NULLIF(TRIM(category), '') AS name FROM extracts
            UNION
            SELECT DISTINCT NULLIF(TRIM(category), '') FROM documents
            UNION
            SELECT 'Uncategorized' WHERE EXISTS (
                SELECT 1 FROM learning_items li
                LEFT JOIN extracts e ON e.id = li.extract_id
                LEFT JOIN documents d ON d.id = li.document_id
                WHERE li.is_suspended = false
                  AND COALESCE(NULLIF(TRIM(e.category), ''), NULLIF(TRIM(d.category), '')) IS NULL
            )
        ),
        attributed AS (
            SELECT
                li.id AS card_id,
                li.review_count AS review_count,
                li.lapses AS lapses,
                COALESCE(NULLIF(TRIM(e.category), ''), NULLIF(TRIM(d.category), ''), 'Uncategorized') AS category
            FROM learning_items li
            LEFT JOIN extracts e ON e.id = li.extract_id
            LEFT JOIN documents d ON d.id = li.document_id
            WHERE li.is_suspended = false
        )
        SELECT
            c.name AS category,
            COUNT(DISTINCT a.card_id) AS card_count,
            COALESCE(SUM(a.review_count), 0) AS reviews_count,
            COALESCE(
                CAST(SUM(CASE WHEN a.review_count > 0 AND a.lapses = 0 THEN 1 ELSE 0 END) AS REAL)
                / NULLIF(SUM(CASE WHEN a.review_count > 0 THEN 1 ELSE 0 END), 0),
                0.0
            ) AS retention_rate
        FROM categories c
        LEFT JOIN attributed a ON a.category = c.name
        GROUP BY c.name
        ORDER BY card_count DESC
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    let mut stats = Vec::new();
    for row in rows {
        let category: String = row.try_get("category").expect("missing category column");
        let card_count: i64 = row
            .try_get("card_count")
            .expect("missing card_count column");
        let reviews_count: i64 = row
            .try_get("reviews_count")
            .expect("missing reviews_count column");
        let retention_rate: f64 = row
            .try_get::<f64, _>("retention_rate")
            .unwrap_or(0.0)
            * 100.0;

        stats.push(CategoryStats {
            category,
            card_count: card_count as i32,
            reviews_count: reviews_count as i32,
            retention_rate,
        });
    }

    Ok(stats)
}

#[tauri::command]
pub async fn get_leech_dashboard(
    threshold: Option<i32>,
    repo: State<'_, Repository>,
) -> Result<Vec<LeechItem>, String> {
    let limit_threshold = threshold.unwrap_or(8).max(1);
    let rows = sqlx::query(
        r#"
        SELECT id, question, lapses, review_count
        FROM learning_items
        WHERE lapses >= ?1 AND is_suspended = false
        ORDER BY lapses DESC, review_count DESC
        "#,
    )
    .bind(limit_threshold)
    .fetch_all(repo.pool())
    .await
    .map_err(|e: sqlx::Error| e.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        let lapses = row.try_get::<i64, _>("lapses").unwrap_or(0) as i32;
        let review_count = row.try_get::<i64, _>("review_count").unwrap_or(0) as i32;
        let mut suggested_actions = vec![
            "Rewrite for clarity".to_string(),
            "Split into smaller cards".to_string(),
        ];
        if lapses >= limit_threshold + 2 {
            suggested_actions.push("Add progressive hints".to_string());
        }
        if review_count > 20 {
            suggested_actions.push("Consider suspend/reset".to_string());
        }
        items.push(LeechItem {
            id: row.try_get("id").unwrap_or_default(),
            question: row.try_get("question").unwrap_or_default(),
            lapses,
            review_count,
            suggested_actions,
        });
    }

    Ok(items)
}

/// Workload data for a single day
#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkloadDay {
    pub date: String,
    pub due_count: i32,
    pub reviewed_count: i32,
    pub new_count: i32,
}

/// Detail of a single item for a specific day
#[derive(Debug, Clone, serde::Serialize)]
pub struct WorkloadDayDetail {
    pub item_id: String,
    pub question: String,
    pub answer: Option<String>,
    pub document_title: String,
    pub item_type: String,
    pub state: String,
    pub review_rating: Option<i32>,
}

/// Get daily workload data for a date range
#[tauri::command]
pub async fn get_workload_data(
    start_date: String,
    end_date: String,
    repo: State<'_, Repository>,
) -> Result<Vec<WorkloadDay>, String> {
    let pool = repo.pool();
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d").map_err(|e| e.to_string())?;

    let mut days = Vec::new();
    let mut current = start;
    while current <= end {
        let day_start = current
            .and_hms_opt(0, 0, 0)
            .expect("invalid time 0:0:0")
            .and_utc();
        let day_end = current
            .and_hms_opt(23, 59, 59)
            .expect("invalid time 23:59:59")
            .and_utc();

        // Due items count (unsuspended learning items with due_date on this day)
        let due_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM learning_items WHERE due_date >= ? AND due_date <= ? AND is_suspended = false"
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_one(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

        // Reviewed count (review_results on this day)
        let reviewed_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM review_results WHERE timestamp >= ? AND timestamp <= ?",
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_one(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

        // New items learned (first review on this day)
        let new_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM learning_items WHERE last_review_date >= ? AND last_review_date <= ? AND review_count = 1 AND is_suspended = false"
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_one(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

        days.push(WorkloadDay {
            date: current.to_string(),
            due_count: due_count as i32,
            reviewed_count: reviewed_count as i32,
            new_count: new_count as i32,
        });

        current = current.succ_opt().expect("no next date");
    }

    Ok(days)
}

/// Get item-level details for a specific day
#[tauri::command]
pub async fn get_workload_day_details(
    date: String,
    repo: State<'_, Repository>,
) -> Result<Vec<WorkloadDayDetail>, String> {
    let pool = repo.pool();
    let target = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let day_start = target
        .and_hms_opt(0, 0, 0)
        .expect("invalid time 0:0:0")
        .and_utc();
    let day_end = target
        .and_hms_opt(23, 59, 59)
        .expect("invalid time 23:59:59")
        .and_utc();
    let now = Utc::now();

    if target < now.date_naive() {
        // Past day: return items that were reviewed on this date
        let rows = sqlx::query(
            r#"
            SELECT
                li.id as item_id,
                li.question,
                li.answer,
                COALESCE(d.title, 'Unknown') as document_title,
                li.item_type,
                li.state,
                rr.rating as review_rating
            FROM review_results rr
            JOIN learning_items li ON rr.item_id = li.id
            LEFT JOIN documents d ON li.document_id = d.id
            WHERE rr.timestamp >= ? AND rr.timestamp <= ?
            ORDER BY rr.timestamp
            "#,
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_all(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

        let mut items = Vec::new();
        for row in rows {
            items.push(WorkloadDayDetail {
                item_id: row.try_get("item_id").unwrap_or_default(),
                question: row.try_get("question").unwrap_or_default(),
                answer: row.try_get("answer").ok(),
                document_title: row.try_get("document_title").unwrap_or_default(),
                item_type: row.try_get("item_type").unwrap_or_default(),
                state: row.try_get("state").unwrap_or_default(),
                review_rating: row.try_get("review_rating").ok(),
            });
        }
        Ok(items)
    } else {
        // Future/today: return items due on this date
        let rows = sqlx::query(
            r#"
            SELECT
                li.id as item_id,
                li.question,
                li.answer,
                COALESCE(d.title, 'Unknown') as document_title,
                li.item_type,
                li.state,
                NULL as review_rating
            FROM learning_items li
            LEFT JOIN documents d ON li.document_id = d.id
            WHERE li.due_date >= ? AND li.due_date <= ? AND li.is_suspended = false
            ORDER BY li.due_date
            "#,
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_all(pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

        let mut items = Vec::new();
        for row in rows {
            items.push(WorkloadDayDetail {
                item_id: row.try_get("item_id").unwrap_or_default(),
                question: row.try_get("question").unwrap_or_default(),
                answer: row.try_get("answer").ok(),
                document_title: row.try_get("document_title").unwrap_or_default(),
                item_type: row.try_get("item_type").unwrap_or_default(),
                state: row.try_get("state").unwrap_or_default(),
                review_rating: row.try_get("review_rating").ok(),
            });
        }
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::models::{Document, Extract, FileType, ItemType, LearningItem};
    use std::path::PathBuf;

    async fn setup_repo() -> Repository {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        Repository::new(db.pool().clone())
    }

    #[tokio::test]
    async fn category_stats_include_document_categories() {
        let repo = setup_repo().await;

        // A document with a category and one card attached via document_id
        // (no extract → previously invisible to the extract-only grouping).
        let mut doc = Document::new(
            "Categorized doc".to_string(),
            "/tmp/categorized.pdf".to_string(),
            FileType::Pdf,
        );
        doc.category = Some("Physics".to_string());
        let created_doc = repo.create_document(&doc).await.expect("doc");

        let mut card = LearningItem::new(ItemType::Flashcard, "physics card".to_string());
        card.document_id = Some(created_doc.id.clone());
        card.review_count = 2;
        repo.create_learning_item(&card).await.expect("card");

        // An extract with a different category and its own card.
        let mut extract = Extract::new(created_doc.id.clone(), "extract content".to_string());
        extract.category = Some("Quotes".to_string());
        let created_extract = repo.create_extract(&extract).await.expect("extract");
        let mut extract_card = LearningItem::new(ItemType::Flashcard, "quote card".to_string());
        extract_card.extract_id = Some(created_extract.id.clone());
        extract_card.document_id = Some(created_doc.id.clone());
        repo.create_learning_item(&extract_card).await.expect("extract card");

        let stats = category_stats(repo.pool()).await.expect("stats");

        let physics = stats.iter().find(|s| s.category == "Physics");
        let quotes = stats.iter().find(|s| s.category == "Quotes");
        assert!(
            physics.is_some(),
            "document categories must appear in the stats (got {:?})",
            stats
        );
        assert_eq!(physics.unwrap().card_count, 1);
        assert!(quotes.is_some(), "extract categories keep appearing");
        assert_eq!(quotes.unwrap().card_count, 1);
    }
}
