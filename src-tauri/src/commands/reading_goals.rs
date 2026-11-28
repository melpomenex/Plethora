//! Reading goals, streaks, and motivation milestone commands.
//!
//! Backed by SQLite tables `reading_goals`, `reading_goal_progress`,
//! `motivation_preferences`, and `motivation_milestones` (migration 173).

use crate::database::Repository;
use crate::models::reading_goal::{
    Achievement, AchievementCategory, GoalProgress, GoalType, ReadingGoal, ReadingStreak,
};
use chrono::{DateTime, Datelike, Duration, NaiveDate, Utc};
use sqlx::{Pool, Row, Sqlite};
use std::collections::HashSet;
use tauri::State;

fn parse_dt(raw: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn milestone_icon(key: &str) -> &'static str {
    match key {
        "first_goal" => "🎯",
        "week_warrior" => "🔥",
        "monthly_master" => "⚡",
        "century_club" => "💎",
        _ => "🏆",
    }
}

fn milestone_category(raw: &str) -> AchievementCategory {
    match raw {
        "consistency" => AchievementCategory::Streaks,
        "mastery_outcome" => AchievementCategory::Milestones,
        "activity" => AchievementCategory::Goals,
        _ => AchievementCategory::Special,
    }
}

fn row_to_reading_goal(row: &sqlx::sqlite::SqliteRow) -> Result<ReadingGoal, String> {
    let goal_type_str: String = row.try_get("goal_type").map_err(|e| e.to_string())?;
    let goal_type = GoalType::from_str(&goal_type_str)
        .ok_or_else(|| format!("Invalid stored goal_type: {}", goal_type_str))?;
    let target_value: i64 = row.try_get("target_value").map_err(|e| e.to_string())?;
    let is_active: i64 = row.try_get("is_active").map_err(|e| e.to_string())?;
    let created_at: String = row.try_get("created_at").map_err(|e| e.to_string())?;
    let modified_at: String = row.try_get("modified_at").map_err(|e| e.to_string())?;

    Ok(ReadingGoal {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        goal_type,
        target_value: target_value.max(0) as u32,
        is_active: is_active != 0,
        created_at: parse_dt(&created_at),
        modified_at: parse_dt(&modified_at),
    })
}

fn row_to_goal_progress(row: &sqlx::sqlite::SqliteRow) -> Result<GoalProgress, String> {
    let current_value: f64 = row.try_get("current_value").map_err(|e| e.to_string())?;
    let is_completed: i64 = row.try_get("is_completed").map_err(|e| e.to_string())?;
    let updated_at: String = row.try_get("updated_at").map_err(|e| e.to_string())?;

    Ok(GoalProgress {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        goal_id: row.try_get("goal_id").map_err(|e| e.to_string())?,
        date: row.try_get("date").map_err(|e| e.to_string())?,
        current_value: current_value as f32,
        is_completed: is_completed != 0,
        updated_at: parse_dt(&updated_at),
    })
}

pub async fn create_reading_goal_in_pool(
    pool: &Pool<Sqlite>,
    goal_type: String,
    target_value: u32,
) -> Result<ReadingGoal, String> {
    if target_value == 0 {
        return Err("target_value must be greater than 0".to_string());
    }
    let goal_type_enum = GoalType::from_str(&goal_type)
        .ok_or_else(|| format!("Invalid goal type: {}", goal_type))?;

    let goal = ReadingGoal::new(goal_type_enum, target_value);
    let now = goal.created_at.to_rfc3339();

    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE reading_goals SET is_active = 0, modified_at = ?1 WHERE is_active = 1")
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO reading_goals (id, goal_type, target_value, is_active, created_at, modified_at)
         VALUES (?1, ?2, ?3, 1, ?4, ?5)",
    )
    .bind(&goal.id)
    .bind(goal.goal_type.as_str())
    .bind(goal.target_value as i64)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(goal)
}

pub async fn get_active_reading_goal_in_pool(
    pool: &Pool<Sqlite>,
) -> Result<Option<ReadingGoal>, String> {
    let row = sqlx::query(
        "SELECT id, goal_type, target_value, is_active, created_at, modified_at
         FROM reading_goals
         WHERE is_active = 1
         ORDER BY modified_at DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    row.as_ref().map(row_to_reading_goal).transpose()
}

pub async fn update_reading_goal_in_pool(
    pool: &Pool<Sqlite>,
    goal_id: String,
    target_value: u32,
    is_active: bool,
) -> Result<ReadingGoal, String> {
    if target_value == 0 {
        return Err("target_value must be greater than 0".to_string());
    }
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE reading_goals
         SET target_value = ?1, is_active = ?2, modified_at = ?3
         WHERE id = ?4",
    )
    .bind(target_value as i64)
    .bind(if is_active { 1 } else { 0 })
    .bind(&now)
    .bind(&goal_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    if res.rows_affected() == 0 {
        return Err(format!("Reading goal not found: {}", goal_id));
    }

    let row = sqlx::query(
        "SELECT id, goal_type, target_value, is_active, created_at, modified_at
         FROM reading_goals WHERE id = ?1",
    )
    .bind(&goal_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    row_to_reading_goal(&row)
}

pub async fn get_goal_progress_in_pool(
    pool: &Pool<Sqlite>,
    goal_id: String,
    date: String,
) -> Result<GoalProgress, String> {
    let row = sqlx::query(
        "SELECT id, goal_id, date, current_value, is_completed, updated_at
         FROM reading_goal_progress
         WHERE goal_id = ?1 AND date = ?2",
    )
    .bind(&goal_id)
    .bind(&date)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    match row {
        Some(r) => row_to_goal_progress(&r),
        None => Ok(GoalProgress::new(goal_id, date)),
    }
}

async fn insert_milestone_if_missing(
    pool: &Pool<Sqlite>,
    milestone_key: &str,
    category: &str,
    achievement: &Achievement,
) -> Result<bool, String> {
    let now = achievement.unlocked_at.to_rfc3339();
    let res = sqlx::query(
        "INSERT OR IGNORE INTO motivation_milestones (
            id, milestone_key, category, title, description, achieved_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&achievement.id)
    .bind(milestone_key)
    .bind(category)
    .bind(&achievement.name)
    .bind(&achievement.description)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(res.rows_affected() > 0)
}

pub async fn update_goal_progress_in_pool(
    pool: &Pool<Sqlite>,
    goal_id: String,
    date: String,
    current_value: f32,
) -> Result<GoalProgress, String> {
    let target_row = sqlx::query("SELECT target_value FROM reading_goals WHERE id = ?1")
        .bind(&goal_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Reading goal not found: {}", goal_id))?;

    let target_value: i64 = target_row.try_get("target_value").map_err(|e| e.to_string())?;
    let clamped = current_value.max(0.0);
    let is_completed = clamped >= target_value as f32;
    let now = Utc::now().to_rfc3339();
    let new_id = uuid::Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO reading_goal_progress (id, goal_id, date, current_value, is_completed, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(goal_id, date) DO UPDATE SET
            current_value = excluded.current_value,
            is_completed = excluded.is_completed,
            updated_at = excluded.updated_at",
    )
    .bind(&new_id)
    .bind(&goal_id)
    .bind(&date)
    .bind(clamped as f64)
    .bind(if is_completed { 1 } else { 0 })
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    if is_completed {
        let first_goal = Achievement::first_goal();
        let _ = insert_milestone_if_missing(pool, "first_goal", "activity", &first_goal).await;
    }

    get_goal_progress_in_pool(pool, goal_id, date).await
}

pub async fn get_reading_streak_in_pool(pool: &Pool<Sqlite>) -> Result<ReadingStreak, String> {
    let pref_row = sqlx::query(
        "SELECT rest_days_mask, streak_grace_days_per_week
         FROM motivation_preferences WHERE id = 'default'",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    let (rest_days_mask, grace_per_week): (u32, u32) = match pref_row {
        Some(r) => (
            r.try_get::<i64, _>("rest_days_mask").unwrap_or(0).max(0) as u32,
            r.try_get::<i64, _>("streak_grace_days_per_week")
                .unwrap_or(1)
                .max(0) as u32,
        ),
        None => (0, 1),
    };

    let progress_dates: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT date FROM reading_goal_progress
         WHERE current_value > 0 OR is_completed = 1",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let event_dates: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT substr(occurred_at, 1, 10) FROM learning_events
         WHERE retracted_by_event_id IS NULL",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut active_dates = HashSet::new();
    for raw in progress_dates.into_iter().chain(event_dates.into_iter()) {
        if let Ok(d) = NaiveDate::parse_from_str(&raw, "%Y-%m-%d") {
            active_dates.insert(d);
        }
    }

    if active_dates.is_empty() {
        return Ok(ReadingStreak::new());
    }

    let mut sorted_dates: Vec<NaiveDate> = active_dates.iter().copied().collect();
    sorted_dates.sort();
    let last_activity_date = sorted_dates.last().map(|d| d.format("%Y-%m-%d").to_string());

    // Compute longest streak across sorted active dates (bridging rest/grace days).
    let mut longest_streak: u32 = 0;
    let mut run: u32 = 0;
    let mut prev: Option<NaiveDate> = None;
    for d in &sorted_dates {
        if let Some(p) = prev {
            let gap = (*d - p).num_days();
            if gap == 1 {
                run += 1;
            } else {
                // Check if all intervening days were planned rest days or within grace budget
                let mut grace_used = 0u32;
                let mut bridged = true;
                for offset in 1..gap {
                    let mid = p + Duration::days(offset);
                    let weekday_bit = 1u32 << mid.weekday().num_days_from_sunday();
                    if (rest_days_mask & weekday_bit) == 0 {
                        grace_used += 1;
                        if grace_used > grace_per_week {
                            bridged = false;
                            break;
                        }
                    }
                }
                if bridged {
                    run += 1;
                } else {
                    run = 1;
                }
            }
        } else {
            run = 1;
        }
        if run > longest_streak {
            longest_streak = run;
        }
        prev = Some(*d);
    }

    // Compute current streak walking backward from today.
    let today = Utc::now().date_naive();
    let earliest = *sorted_dates.first().unwrap();
    let mut current_streak: u32 = 0;
    let mut cursor = today;
    let mut grace_used_in_week: u32 = 0;
    let mut current_iso_week = cursor.iso_week();

    while cursor >= earliest {
        if cursor.iso_week() != current_iso_week {
            current_iso_week = cursor.iso_week();
            grace_used_in_week = 0;
        }

        if active_dates.contains(&cursor) {
            current_streak += 1;
        } else {
            let weekday_bit = 1u32 << cursor.weekday().num_days_from_sunday();
            let is_rest = (rest_days_mask & weekday_bit) != 0;
            if is_rest {
                // Planned rest day bridges streak without incrementing
            } else if cursor == today {
                // Today hasn't finished yet; don't break streak before day ends
            } else if grace_used_in_week < grace_per_week {
                grace_used_in_week += 1;
            } else {
                break;
            }
        }

        match cursor.pred_opt() {
            Some(prev_day) => cursor = prev_day,
            None => break,
        }
    }

    if current_streak > longest_streak {
        longest_streak = current_streak;
    }

    Ok(ReadingStreak {
        current_streak,
        longest_streak,
        last_activity_date,
        is_active: current_streak > 0,
    })
}

pub async fn get_achievements_in_pool(pool: &Pool<Sqlite>) -> Result<Vec<Achievement>, String> {
    let rows = sqlx::query(
        "SELECT id, milestone_key, category, title, description, achieved_at
         FROM motivation_milestones
         WHERE revoked_at IS NULL
         ORDER BY achieved_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let key: String = row.try_get("milestone_key").map_err(|e| e.to_string())?;
        let cat: String = row.try_get("category").map_err(|e| e.to_string())?;
        let achieved_at: String = row.try_get("achieved_at").map_err(|e| e.to_string())?;
        out.push(Achievement {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            name: row.try_get("title").map_err(|e| e.to_string())?,
            description: row.try_get("description").map_err(|e| e.to_string())?,
            icon: milestone_icon(&key).to_string(),
            category: milestone_category(&cat),
            unlocked_at: parse_dt(&achieved_at),
        });
    }
    Ok(out)
}

pub async fn check_and_unlock_achievements_in_pool(
    pool: &Pool<Sqlite>,
) -> Result<Vec<Achievement>, String> {
    let mut newly_unlocked = Vec::new();

    let completed_goals: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM reading_goal_progress WHERE is_completed = 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    if completed_goals > 0 {
        let ach = Achievement::first_goal();
        if insert_milestone_if_missing(pool, "first_goal", "activity", &ach).await? {
            newly_unlocked.push(ach);
        }
    }

    let streak = get_reading_streak_in_pool(pool).await?;
    let best = streak.current_streak.max(streak.longest_streak);

    if best >= 7 {
        let ach = Achievement::week_warrior();
        if insert_milestone_if_missing(pool, "week_warrior", "consistency", &ach).await? {
            newly_unlocked.push(ach);
        }
    }
    if best >= 30 {
        let ach = Achievement::monthly_master();
        if insert_milestone_if_missing(pool, "monthly_master", "consistency", &ach).await? {
            newly_unlocked.push(ach);
        }
    }
    if best >= 100 {
        let ach = Achievement::century_club();
        if insert_milestone_if_missing(pool, "century_club", "consistency", &ach).await? {
            newly_unlocked.push(ach);
        }
    }

    Ok(newly_unlocked)
}

#[tauri::command]
pub async fn create_reading_goal(
    goal_type: String,
    target_value: u32,
    repo: State<'_, Repository>,
) -> Result<ReadingGoal, String> {
    create_reading_goal_in_pool(repo.pool(), goal_type, target_value).await
}

#[tauri::command]
pub async fn get_active_reading_goal(
    repo: State<'_, Repository>,
) -> Result<Option<ReadingGoal>, String> {
    get_active_reading_goal_in_pool(repo.pool()).await
}

#[tauri::command]
pub async fn update_reading_goal(
    goal_id: String,
    target_value: u32,
    is_active: bool,
    repo: State<'_, Repository>,
) -> Result<ReadingGoal, String> {
    update_reading_goal_in_pool(repo.pool(), goal_id, target_value, is_active).await
}

#[tauri::command]
pub async fn get_goal_progress(
    goal_id: String,
    date: String,
    repo: State<'_, Repository>,
) -> Result<GoalProgress, String> {
    get_goal_progress_in_pool(repo.pool(), goal_id, date).await
}

#[tauri::command]
pub async fn update_goal_progress(
    goal_id: String,
    date: String,
    current_value: f32,
    repo: State<'_, Repository>,
) -> Result<GoalProgress, String> {
    update_goal_progress_in_pool(repo.pool(), goal_id, date, current_value).await
}

#[tauri::command]
pub async fn get_reading_streak(repo: State<'_, Repository>) -> Result<ReadingStreak, String> {
    get_reading_streak_in_pool(repo.pool()).await
}

#[tauri::command]
pub async fn get_achievements(repo: State<'_, Repository>) -> Result<Vec<Achievement>, String> {
    get_achievements_in_pool(repo.pool()).await
}

#[tauri::command]
pub async fn check_and_unlock_achievements(
    repo: State<'_, Repository>,
) -> Result<Vec<Achievement>, String> {
    check_and_unlock_achievements_in_pool(repo.pool()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::migrations::run_migrations;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn reading_goals_crud_progress_streak_and_achievements_persist() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();

        let goal = create_reading_goal_in_pool(&pool, "daily_minutes".to_string(), 20)
            .await
            .expect("create goal");
        assert!(goal.is_active);
        assert_eq!(goal.target_value, 20);

        let active = get_active_reading_goal_in_pool(&pool)
            .await
            .unwrap()
            .expect("active goal");
        assert_eq!(active.id, goal.id);

        let today = Utc::now().date_naive().format("%Y-%m-%d").to_string();
        let progress = update_goal_progress_in_pool(&pool, goal.id.clone(), today.clone(), 25.0)
            .await
            .expect("update progress");
        assert!(progress.is_completed);
        assert_eq!(progress.current_value, 25.0);

        let fetched = get_goal_progress_in_pool(&pool, goal.id.clone(), today)
            .await
            .unwrap();
        assert_eq!(fetched.id, progress.id);

        let streak = get_reading_streak_in_pool(&pool).await.unwrap();
        assert!(streak.current_streak >= 1);
        assert!(streak.is_active);

        let achievements = get_achievements_in_pool(&pool).await.unwrap();
        assert_eq!(achievements.len(), 1);
        assert_eq!(achievements[0].name, "First Step");

        // Idempotent unlock check should not duplicate First Step
        let newly = check_and_unlock_achievements_in_pool(&pool).await.unwrap();
        assert!(newly.is_empty());

        let updated = update_reading_goal_in_pool(&pool, goal.id.clone(), 30, false)
            .await
            .unwrap();
        assert!(!updated.is_active);
        assert_eq!(updated.target_value, 30);
    }
}
