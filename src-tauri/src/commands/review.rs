//! Review commands supporting FSRS, Adaptive, Precision, and Classic algorithms

use crate::algorithms::precision::{
    self, ArenaModelId, PrecisionCollectionState, PrecisionState, ARENA_MODEL_IDS,
};
use crate::algorithms::AlgorithmType;
use crate::database::Repository;
use crate::error::Result;
use crate::models::{ItemState, LearningItem, MemoryState, ReviewRating};
use crate::scheduler_identity::normalize_algorithm_type;
use chrono::{Duration, Utc};
use rand::SeedableRng;
use sha2::{Digest, Sha256};
use sqlx::Row;
use tauri::State;

/// Default desired retention rate (0.9 = 90% retention)
const DEFAULT_DESIRED_RETENTION: f32 = 0.9;

/// Graduation interval in days - items with intervals >= this are considered "graduated" to Review state
const GRADUATION_INTERVAL_DAYS: f64 = 1.0;
/// Minimum fallback intervals when FSRS returns a non-positive interval.
const MIN_AGAIN_INTERVAL_DAYS: f64 = 10.0 / 1440.0; // 10 minutes
const MIN_HARD_INTERVAL_DAYS: f64 = 0.5; // 12 hours
const MIN_GOOD_INTERVAL_DAYS: f64 = 1.0; // 1 day
const MIN_EASY_INTERVAL_DAYS: f64 = 2.0; // 2 days
pub const ARENA_SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ArenaSelectionSource {
    Arena,
    Model,
    Custom,
}

impl ArenaSelectionSource {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Arena => "arena",
            Self::Model => "model",
            Self::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct ArenaSelection {
    pub commit_id: String,
    pub preview_id: String,
    pub item_revision: String,
    pub arena_revision: String,
    pub source: ArenaSelectionSource,
    #[serde(default)]
    pub model_id: Option<ArenaModelId>,
    #[serde(default)]
    pub interval_days: Option<f64>,
    #[serde(default)]
    pub decision_time_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct ArenaIntervalChoice {
    pub interval_days: f64,
    pub due_at: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct ArenaModelCandidate {
    pub model_id: ArenaModelId,
    pub label: String,
    pub interval_days: f64,
    pub due_at: String,
    pub weight_percent: f64,
    pub personalized: bool,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct ArenaIntervalRange {
    pub min_days: f64,
    pub max_days: f64,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct ArenaGradePreview {
    pub grade: u8,
    pub recommendation: ArenaIntervalChoice,
    pub candidates: Vec<ArenaModelCandidate>,
    pub range: ArenaIntervalRange,
    pub custom_bounds: ArenaIntervalRange,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct ArenaPreviewSet {
    pub schema_version: u8,
    pub preview_id: String,
    pub item_revision: String,
    pub arena_revision: String,
    pub generated_at: String,
    pub model_order: Vec<ArenaModelId>,
    pub grades: Vec<ArenaGradePreview>,
}

struct AppliedArenaDecision {
    selection: ArenaSelection,
    recommended_interval: f64,
    snapshot: String,
    collection: PrecisionCollectionState,
    expected_item_revision: String,
    expected_arena_revision: String,
}

#[derive(Clone, serde::Serialize)]
pub struct ReviewStreak {
    pub current_streak: i32,
    pub longest_streak: i32,
    pub total_reviews: i32,
    pub last_review_date: Option<String>,
}

/// Resolvable source context for a learning item, used to show "From: <doc>"
/// provenance on review cards (context-retention during review).
#[derive(Clone, serde::Serialize)]
pub struct CardSourceContext {
    pub document_id: String,
    pub document_title: String,
    pub extract_id: Option<String>,
    /// First ~200 chars of the source extract's plain-text content.
    pub extract_snippet: Option<String>,
    pub page_number: Option<i32>,
    pub source_url: Option<String>,
}

/// Resolve the source context for a learning item (document title + extract
/// snippet). Returns `None` when the item has no resolvable source.
#[tauri::command]
pub async fn get_card_source_context(
    item_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<CardSourceContext>> {
    let item = repo
        .get_all_learning_items()
        .await?
        .into_iter()
        .find(|i| i.id == item_id);

    let Some(item) = item else { return Ok(None) };

    // Resolve document.
    let document_id = match item.document_id.as_deref() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return Ok(None),
    };

    let doc = repo.get_document(&document_id).await?;
    let Some(doc) = doc else { return Ok(None) };

    // Resolve extract (optional).
    let (extract_id, extract_snippet, page_number, source_url) =
        if let Some(extract_id) = item.extract_id.as_deref().filter(|s| !s.is_empty()) {
            if let Ok(Some(extract)) = repo.get_extract(extract_id).await {
                let snippet = source_snippet(&extract.content, 200);
                (
                    Some(extract.id),
                    snippet,
                    extract.page_number,
                    extract.source_url,
                )
            } else {
                (None, None, None, None)
            }
        } else {
            (None, None, None, None)
        };

    Ok(Some(CardSourceContext {
        document_id,
        document_title: doc.title,
        extract_id,
        extract_snippet,
        page_number,
        source_url,
    }))
}

/// Build an ellipsized plain-text snippet from extract content.
fn source_snippet(content: &str, max_chars: usize) -> Option<String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= max_chars {
        Some(trimmed.to_string())
    } else {
        let head: String = chars.into_iter().take(max_chars).collect();
        Some(format!("{head}…"))
    }
}

#[tauri::command]
pub async fn get_review_streak(repo: State<'_, Repository>) -> Result<ReviewStreak> {
    let items = repo.get_all_learning_items().await?;

    // Group reviews by date
    let mut review_dates: Vec<String> = Vec::new();
    for item in &items {
        if let Some(lr) = &item.last_review_date {
            review_dates.push(lr.format("%Y-%m-%d").to_string());
        }
    }

    review_dates.sort();
    review_dates.dedup();

    let total_reviews = items.iter().map(|i| i.review_count).sum::<i32>();
    let last_review_date = items
        .iter()
        .filter_map(|i| i.last_review_date.as_ref())
        .max()
        .map(|d| d.format("%Y-%m-%d").to_string());

    // Calculate current streak
    let current_streak = calculate_current_streak(&review_dates);
    let longest_streak = calculate_longest_streak(&review_dates);

    Ok(ReviewStreak {
        current_streak,
        longest_streak,
        total_reviews,
        last_review_date,
    })
}

fn calculate_current_streak(dates: &[String]) -> i32 {
    if dates.is_empty() {
        return 0;
    }

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let yesterday = (Utc::now() - Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();

    let last_date = dates.last().expect("dates is non-empty (checked above)");
    if last_date != &today && last_date != &yesterday {
        return 0;
    }

    let mut streak = 1;
    for i in (0..dates.len() - 1).rev() {
        let current = chrono::NaiveDate::parse_from_str(&dates[i + 1], "%Y-%m-%d")
            .expect("valid date string");
        let prev =
            chrono::NaiveDate::parse_from_str(&dates[i], "%Y-%m-%d").expect("valid date string");

        if current.signed_duration_since(prev).num_days() == 1 {
            streak += 1;
        } else {
            break;
        }
    }

    streak
}

fn calculate_longest_streak(dates: &[String]) -> i32 {
    if dates.len() <= 1 {
        return dates.len() as i32;
    }

    let mut longest = 1;
    let mut current = 1;

    for i in 1..dates.len() {
        let curr_date =
            chrono::NaiveDate::parse_from_str(&dates[i], "%Y-%m-%d").expect("valid date string");
        let prev_date = chrono::NaiveDate::parse_from_str(&dates[i - 1], "%Y-%m-%d")
            .expect("valid date string");

        if curr_date.signed_duration_since(prev_date).num_days() == 1 {
            current += 1;
            longest = longest.max(current);
        } else {
            current = 1;
        }
    }

    longest
}

#[tauri::command]
pub async fn start_review(repo: State<'_, Repository>) -> Result<String> {
    let now = Utc::now();
    let due_items = repo.get_due_learning_items(&now, None).await?;

    if due_items.is_empty() {
        return Ok(String::new()); // No session needed if no items
    }

    let session_id = uuid::Uuid::new_v4().to_string();

    let collection_id = due_items
        .first()
        .map(|item| item.collection_id.as_str())
        .unwrap_or(crate::models::collection::DEFAULT_COLLECTION_ID);
    repo.create_review_session(&session_id, collection_id)
        .await?;

    Ok(session_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn submit_review(
    item_id: String,
    rating: i32,
    time_taken: i32,
    session_id: Option<String>,
    desired_retention: Option<f32>,
    fsrs_weights: Option<Vec<f32>>,
    algorithm: Option<String>,
    no_schedule_update: Option<bool>,
    grade: Option<i32>,
    precision_pure_kernel: Option<bool>,
    sm20_pure_m4: Option<bool>,
    arena_selection: Option<ArenaSelection>,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let precision_pure_kernel = precision_pure_kernel
        .or(sm20_pure_m4)
        .unwrap_or(false);
    tracing::info!(
        item_id = %item_id,
        rating,
        grade = grade.map(|g| g.to_string()).unwrap_or_default(),
        time_taken,
        session_id = session_id.as_deref().unwrap_or(""),
        algorithm = algorithm.as_deref().unwrap_or("fsrs"),
        precision_pure_kernel,
        "submit_review invoked"
    );
    apply_review(
        &repo,
        &item_id,
        rating,
        time_taken,
        session_id.as_deref(),
        desired_retention.unwrap_or(DEFAULT_DESIRED_RETENTION),
        fsrs_weights.as_deref(),
        no_schedule_update.unwrap_or(false),
        algorithm.as_deref(),
        grade,
        precision_pure_kernel,
        arena_selection.as_ref(),
    )
    .await
}

/// Main review dispatcher — routes to the correct algorithm based on the caller's algorithm parameter,
/// falling back to the item's stored algorithm_type.
///
/// `native_grade` is an optional Precision grade (0-5 scale) used only
/// by the Precision path; when present it bypasses the 4-button rating→grade
/// mapping so the UI can offer the algorithm's native grading scale.
#[allow(clippy::too_many_arguments)]
pub async fn apply_review(
    repo: &Repository,
    item_id: &str,
    rating: i32,
    time_taken: i32,
    session_id: Option<&str>,
    desired_retention: f32,
    fsrs_weights: Option<&[f32]>,
    no_schedule_update: bool,
    algorithm: Option<&str>,
    native_grade: Option<i32>,
    precision_pure_kernel: bool,
    arena_selection: Option<&ArenaSelection>,
) -> Result<LearningItem> {
    let mut item = repo.get_learning_item(item_id).await?.ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Learning item {}", item_id))
    })?;
    let prior_state = item.state.clone();

    // A transport retry uses the same logical commit id. Once its review row
    // exists, return the already-updated item without touching scheduler state,
    // counters, or history a second time.
    if let Some(selection) = arena_selection {
        if selection.commit_id.trim().is_empty() {
            return Err(crate::error::PlethoraError::InvalidInput(
                "Arena commit_id must not be empty".to_string(),
            ));
        }
        if let Some(committed_item_id) = repo
            .get_review_item_by_arena_commit_id(&selection.commit_id)
            .await?
        {
            if committed_item_id != item_id {
                return Err(crate::error::PlethoraError::ArenaAlreadyCommitted(
                    "commit_id belongs to another learning item".to_string(),
                ));
            }
            return Ok(item);
        }
    }

    let review_rating = ReviewRating::from(rating);

    if no_schedule_update {
        return Ok(item);
    }

    let now = Utc::now();

    // Use the caller's algorithm parameter if provided, otherwise fall back to item's stored type
    let effective_algorithm = algorithm.unwrap_or(&item.algorithm_type);
    let algo = AlgorithmType::from_str_lossy(effective_algorithm);

    if arena_selection.is_some() && (algo != AlgorithmType::Precision || precision_pure_kernel) {
        return Err(crate::error::PlethoraError::ArenaUnsupported(
            "Arena choices require a normal Precision ensemble review".to_string(),
        ));
    }

    // Update the item's algorithm_type to match the effective algorithm
    item.algorithm_type = effective_algorithm.to_string();

    let arena_decision = match algo {
        AlgorithmType::Fsrs => {
            apply_fsrs_review_inner(
                &mut item,
                review_rating,
                desired_retention,
                fsrs_weights,
                now,
            )?;
            None
        }
        AlgorithmType::Classic => {
            apply_classic_review(&mut item, review_rating, now)?;
            None
        }
        AlgorithmType::Classic5 => {
            apply_classic_5_review(&mut item, review_rating, now)?;
            None
        }
        AlgorithmType::Classic8 => {
            apply_classic_8_review(&mut item, review_rating, now)?;
            None
        }
        AlgorithmType::Classic15 => {
            apply_classic_15_review(&mut item, review_rating, desired_retention, now)?;
            None
        }
        AlgorithmType::Adaptive => {
            apply_adaptive_review(&mut item, review_rating, now)?;
            None
        }
        AlgorithmType::Precision => {
            apply_precision_review(
                &mut item,
                review_rating,
                native_grade,
                now,
                precision_pure_kernel,
                arena_selection,
                repo,
            )
            .await?
        }
    };

    // Track review statistics. With a native Precision grade, pass = grade >= 3;
    // otherwise keep the 4-button convention (Good/Easy are correct).
    let was_correct = match native_grade {
        Some(g) => g >= 3,
        None => rating >= 3,
    };

    let review_result_id = uuid::Uuid::new_v4().to_string();
    let today = now.format("%Y-%m-%d").to_string();
    let (new_cards, learning_cards, review_cards) = match prior_state {
        ItemState::New => (1, 0, 0),
        ItemState::Learning | ItemState::Relearning => (0, 1, 0),
        ItemState::Review => (0, 0, 1),
    };

    if let Some(decision) = arena_decision {
        let provenance = crate::database::repository::ArenaReviewProvenance {
            schedule_source: decision.selection.source.as_str(),
            schedule_model_id: decision.selection.model_id.map(ArenaModelId::as_str),
            arena_commit_id: &decision.selection.commit_id,
            recommended_interval: decision.recommended_interval,
            decision_time_ms: decision.selection.decision_time_ms,
            snapshot: &decision.snapshot,
        };
        let committed = repo
            .commit_precision_arena_review(
                &item,
                &decision.collection,
                &review_result_id,
                session_id,
                rating,
                time_taken,
                &provenance,
                &decision.expected_item_revision,
                &decision.expected_arena_revision,
                &today,
                if was_correct { 1 } else { 0 },
                new_cards,
                learning_cards,
                review_cards,
            )
            .await?;
        if !committed {
            return repo.get_learning_item(item_id).await?.ok_or_else(|| {
                crate::error::PlethoraError::NotFound(format!("Learning item {}", item_id))
            });
        }
        return Ok(item);
    }

    if item.first_reviewed_at.is_none() {
        item.first_reviewed_at = Some(Utc::now());
    }

    repo.update_learning_item(&item).await?;
    repo.create_review_result(
        &review_result_id,
        &item.collection_id,
        session_id,
        item_id,
        rating,
        time_taken,
        &item.due_date,
        item.interval,
        item.ease_factor,
    )
    .await?;

    repo.update_study_statistics(
        &today,
        1,                               // cards_reviewed
        if was_correct { 1 } else { 0 }, // correct_reviews
        time_taken,                      // study_time in seconds
        new_cards,
        learning_cards,
        review_cards,
    )
    .await?;

    if let Some(sid) = session_id {
        repo.update_review_session(
            sid,
            1,                               // items_reviewed
            if was_correct { 1 } else { 0 }, // correct_answers
            time_taken,
            false, // don't end the session yet
        )
        .await?;
    }

    Ok(item)
}

/// FSRS-6 review (original logic extracted into inner function)
fn apply_fsrs_review_inner(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    desired_retention: f32,
    fsrs_weights: Option<&[f32]>,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    let fsrs = if let Some(weights) = fsrs_weights {
        if matches!(weights.len(), 17 | 19 | 21) {
            fsrs::FSRS::new(Some(weights))?
        } else {
            fsrs::FSRS::new(Some(&[]))?
        }
    } else {
        fsrs::FSRS::new(Some(&[]))?
    };

    let elapsed_days = item
        .last_review_date
        .map(|lr| {
            let duration = now - lr;
            duration.num_seconds() as f64 / 86400.0
        })
        .unwrap_or(0.0)
        .max(0.0) as u32;

    let current_memory_state = item.memory_state.clone().and_then(|ms| {
        if ms.stability <= 0.0 || ms.difficulty <= 0.0 {
            None
        } else {
            Some(fsrs::MemoryState {
                stability: ms.stability as f32,
                difficulty: ms.difficulty as f32,
            })
        }
    });

    let next_states = fsrs.next_states(current_memory_state, desired_retention, elapsed_days)?;

    let next_state = match review_rating {
        ReviewRating::Again => &next_states.again,
        ReviewRating::Hard => &next_states.hard,
        ReviewRating::Good => &next_states.good,
        ReviewRating::Easy => &next_states.easy,
    };

    let mut new_interval = next_state.interval as f64;
    if !new_interval.is_finite() || new_interval <= 0.0 {
        new_interval = match review_rating {
            ReviewRating::Again => MIN_AGAIN_INTERVAL_DAYS,
            ReviewRating::Hard => MIN_HARD_INTERVAL_DAYS,
            ReviewRating::Good => MIN_GOOD_INTERVAL_DAYS,
            ReviewRating::Easy => MIN_EASY_INTERVAL_DAYS,
        };
    }

    let interval_seconds = (new_interval * 86400.0).round().max(60.0) as i64;
    item.due_date = now + Duration::seconds(interval_seconds);

    item.review_count += 1;
    item.interval = new_interval;
    item.last_review_date = Some(now);
    item.date_modified = now;

    item.memory_state = Some(MemoryState {
        stability: next_state.memory.stability as f64,
        difficulty: next_state.memory.difficulty as f64,
    });
    if item.ease_factor <= 0.0 {
        item.ease_factor = 2.5;
    }

    item.state = match review_rating {
        ReviewRating::Again => {
            item.lapses += 1;
            ItemState::Relearning
        }
        ReviewRating::Hard | ReviewRating::Good | ReviewRating::Easy => {
            if new_interval >= GRADUATION_INTERVAL_DAYS {
                ItemState::Review
            } else {
                match item.state {
                    ItemState::New => ItemState::Learning,
                    ItemState::Relearning => ItemState::Relearning,
                    _ => ItemState::Learning,
                }
            }
        }
    };

    Ok(())
}

/// Classic review implementation
fn apply_classic_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::classic::{ClassicScheduler, ClassicState};

    let state: ClassicState = item
        .algorithm_state
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let algo = ClassicScheduler::new();
    let new_state = algo.next_state(&state, review_rating);

    let interval_seconds = (new_state.interval * 86400.0).round().max(60.0) as i64;
    item.due_date = now + Duration::seconds(interval_seconds);
    item.interval = new_state.interval;
    item.ease_factor = new_state.ease_factor;
    item.review_count += 1;
    item.last_review_date = Some(now);
    item.date_modified = now;
    item.algorithm_state = Some(serde_json::to_string(&new_state)?);

    if review_rating == ReviewRating::Again {
        item.lapses += 1;
        item.state = ItemState::Relearning;
    } else if new_state.interval >= GRADUATION_INTERVAL_DAYS {
        item.state = ItemState::Review;
    } else {
        item.state = match item.state {
            ItemState::New => ItemState::Learning,
            ItemState::Relearning => ItemState::Relearning,
            _ => ItemState::Learning,
        };
    }

    Ok(())
}

/// Classic 5 review implementation
fn apply_classic_5_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::classic::{Classic5Scheduler, Classic5State};

    let state: Classic5State = item
        .algorithm_state
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let algo = Classic5Scheduler::new();
    let new_state = algo.next_state(&state, review_rating);

    let interval_seconds = (new_state.interval * 86400.0).round().max(60.0) as i64;
    item.due_date = now + Duration::seconds(interval_seconds);
    item.interval = new_state.interval;
    item.ease_factor = new_state.ease_factor;
    item.review_count += 1;
    item.last_review_date = Some(now);
    item.date_modified = now;
    item.algorithm_state = Some(serde_json::to_string(&new_state)?);

    if review_rating == ReviewRating::Again {
        item.lapses += 1;
        item.state = ItemState::Relearning;
    } else if new_state.interval >= GRADUATION_INTERVAL_DAYS {
        item.state = ItemState::Review;
    } else {
        item.state = match item.state {
            ItemState::New => ItemState::Learning,
            ItemState::Relearning => ItemState::Relearning,
            _ => ItemState::Learning,
        };
    }

    Ok(())
}

fn apply_sm5_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    apply_classic_5_review(item, review_rating, now)
}

/// Classic 8 review implementation
fn apply_classic_8_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::classic::{Classic8Scheduler, Classic8State};

    let state: Classic8State = item
        .algorithm_state
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let algo = Classic8Scheduler::new();
    let new_state = algo.next_state(&state, review_rating);

    let interval_seconds = (new_state.interval * 86400.0).round().max(60.0) as i64;
    item.due_date = now + Duration::seconds(interval_seconds);
    item.interval = new_state.interval;
    item.ease_factor = new_state.ease_factor;
    item.review_count += 1;
    item.last_review_date = Some(now);
    item.date_modified = now;
    item.algorithm_state = Some(serde_json::to_string(&new_state)?);

    if review_rating == ReviewRating::Again {
        item.lapses += 1;
        item.state = ItemState::Relearning;
    } else if new_state.interval >= GRADUATION_INTERVAL_DAYS {
        item.state = ItemState::Review;
    } else {
        item.state = match item.state {
            ItemState::New => ItemState::Learning,
            ItemState::Relearning => ItemState::Relearning,
            _ => ItemState::Learning,
        };
    }

    Ok(())
}

fn apply_sm8_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    apply_classic_8_review(item, review_rating, now)
}

/// Classic 15 review implementation
fn apply_classic_15_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    _desired_retention: f32,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::classic::{Classic15Scheduler, Classic15State};

    let state: Classic15State = item
        .algorithm_state
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let algo = Classic15Scheduler::new();
    let new_state = algo.next_state(&state, review_rating);
    let new_interval = algo.next_interval(&new_state) as f64;

    let interval_seconds = (new_interval * 86400.0).round().max(60.0) as i64;
    item.due_date = now + Duration::seconds(interval_seconds);
    item.interval = new_interval;
    item.review_count += 1;
    item.last_review_date = Some(now);
    item.date_modified = now;
    item.algorithm_state = Some(serde_json::to_string(&new_state)?);
    item.memory_state = Some(MemoryState {
        stability: new_state.stability,
        difficulty: new_state.difficulty,
    });

    if review_rating == ReviewRating::Again {
        item.lapses += 1;
        item.state = ItemState::Relearning;
    } else if new_interval >= GRADUATION_INTERVAL_DAYS {
        item.state = ItemState::Review;
    } else {
        item.state = match item.state {
            ItemState::New => ItemState::Learning,
            ItemState::Relearning => ItemState::Relearning,
            _ => ItemState::Learning,
        };
    }

    Ok(())
}

fn apply_sm15_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    desired_retention: f32,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    apply_classic_15_review(item, review_rating, desired_retention, now)
}

/// Adaptive review implementation
fn apply_adaptive_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::adaptive::{AdaptiveScheduler, AdaptiveState};

    // Adaptive grades: 0-2 = failure, 3-5 = pass (SUCCESS_GRADE = 3). Hard must
    // map to 3 (pass with serious difficulty).
    let grade = match review_rating {
        ReviewRating::Again => 0,
        ReviewRating::Hard => 3,
        ReviewRating::Good => 4,
        ReviewRating::Easy => 5,
    };

    let mut state: AdaptiveState = item
        .algorithm_state
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let elapsed_days = item
        .last_review_date
        .map(|lr| {
            let duration = now - lr;
            duration.num_seconds() as f64 / 86400.0
        })
        .unwrap_or(0.0)
        .max(0.0);

    let result = AdaptiveScheduler::review_default(&mut state, grade, elapsed_days);

    let interval_seconds = (result.new_interval * 86400.0).round().max(60.0) as i64;
    item.due_date = now + Duration::seconds(interval_seconds);
    item.interval = result.new_interval;
    item.review_count += 1;
    item.last_review_date = Some(now);
    item.date_modified = now;
    item.algorithm_state = Some(serde_json::to_string(&state)?);
    item.memory_state = Some(MemoryState {
        stability: state.stability,
        difficulty: state.difficulty * 10.0,
    });

    if grade < 3 {
        item.lapses += 1;
        item.state = ItemState::Relearning;
    } else if result.new_interval >= GRADUATION_INTERVAL_DAYS {
        item.state = ItemState::Review;
    } else {
        item.state = match item.state {
            ItemState::New => ItemState::Learning,
            ItemState::Relearning => ItemState::Relearning,
            _ => ItemState::Learning,
        };
    }

    Ok(())
}

fn parse_precision_state(item: &LearningItem) -> PrecisionState {
    item.algorithm_state
        .as_deref()
        .and_then(|state| serde_json::from_str::<PrecisionState>(state).ok())
        .unwrap_or_else(|| {
            let stability = item
                .memory_state
                .as_ref()
                .map(|ms| ms.stability)
                .unwrap_or(1.0)
                .max(1.0);
            let difficulty = item
                .memory_state
                .as_ref()
                .map(|ms| ms.difficulty)
                .unwrap_or(0.3)
                .clamp(0.0, 1.0);
            let difficulty = if (0.05..=0.95).contains(&difficulty) {
                difficulty
            } else {
                PrecisionState::default().difficulty
            };
            #[allow(deprecated)]
            let default = PrecisionState {
                stability,
                difficulty,
                repetition: item.review_count.max(0) as u32,
                lapses: item.lapses.max(0) as u32,
                interval: item.interval.max(1.0),
                retrov: difficulty,
                m1_state: crate::algorithms::precision::model1::M1ItemState {
                    last_review_day: -1,
                    previous_interval: item.interval.max(1.0) as i32,
                    repetitions: item.review_count.max(0) as u32,
                    lapses: item.lapses.max(0) as u32,
                },
                m2_state: crate::algorithms::precision::model2::M2ItemState {
                    last_review_day: -1,
                    previous_interval: item.interval.max(1.0) as i32,
                    repetitions: item.review_count.max(0) as u32,
                    lapses: item.lapses.max(0) as u32,
                    a_factor: 3.0,
                    u_factor: 1.0,
                },
                m3_state: crate::algorithms::precision::model3::M3ItemState {
                    last_review_day: -1,
                    previous_interval: item.interval.max(1.0) as i32,
                    repetitions: item.review_count.max(0) as u32,
                    lapses: item.lapses.max(0) as u32,
                    stability,
                    difficulty,
                    previous_stability: -1.0,
                    previous_stability_index: 0,
                    previous_r_index: 0,
                },
                ..Default::default()
            };
            default
        })
}

/// Load the full Precision collection-wide state: M2 optimizer, M3 matrices,
/// Algorithm Arena weights, and any per-user optimized model parameters.
/// Missing/corrupt rows fall back to fresh defaults (a new collection).
async fn load_precision_collection(
    repo: &Repository,
) -> Result<crate::algorithms::precision::PrecisionCollectionState> {
    use crate::algorithms::precision::{arena::ArenaState, PrecisionCollectionState};

    let m2_optimizer = match repo.get_arena_m2_optimizer().await? {
        Some(bytes) => serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| crate::algorithms::precision::model2::ClassicM2Optimizer::fresh()),
        None => crate::algorithms::precision::model2::ClassicM2Optimizer::fresh(),
    };
    let m3_matrices = repo.get_arena_m3_matrices().await?.unwrap_or_default();
    let arena = repo
        .get_arena_state()
        .await?
        .and_then(|json| serde_json::from_str::<ArenaState>(&json).ok())
        .unwrap_or_default()
        .sanitized();
    let fsrs_params = repo
        .get_arena_model_params("fsrs")
        .await?
        .and_then(|json| serde_json::from_str::<Vec<f32>>(&json).ok())
        .filter(|p| !p.is_empty() && p.iter().all(|v| v.is_finite()));
    let m4_params = repo
        .get_arena_model_params("m4")
        .await?
        .and_then(|json| serde_json::from_str::<Vec<f64>>(&json).ok())
        .filter(|p| p.len() == 35 && p.iter().all(|v| v.is_finite()));

    Ok(PrecisionCollectionState {
        m2_optimizer,
        m3_matrices,
        arena,
        fsrs_params,
        m4_params,
    })
}

fn sha256_json<T: serde::Serialize>(value: &T) -> Result<String> {
    let encoded = serde_json::to_vec(value)?;
    let mut hasher = Sha256::new();
    hasher.update(encoded);
    Ok(hex::encode(hasher.finalize()))
}

pub(crate) fn precision_item_revision(item: &LearningItem) -> Result<String> {
    // Hash only scheduling inputs. Presentation-only edits must not invalidate
    // a decision that is already visible to the learner.
    sha256_json(&(
        &item.id,
        item.interval,
        item.ease_factor,
        item.due_date,
        item.last_review_date,
        item.review_count,
        item.lapses,
        &item.state,
        &item.memory_state,
        &item.algorithm_state,
    ))
}

pub(crate) fn arena_revision(
    collection: &crate::algorithms::precision::PrecisionCollectionState,
) -> Result<String> {
    sha256_json(&(
        &collection.m2_optimizer,
        &collection.m3_matrices,
        &collection.arena,
        &collection.fsrs_params,
        &collection.m4_params,
    ))
}

fn arena_due_at(now: chrono::DateTime<Utc>, interval_days: f64) -> String {
    let seconds = (interval_days.max(0.0) * 86_400.0).round() as i64;
    (now + Duration::seconds(seconds)).to_rfc3339()
}

fn build_arena_preview(
    item: &LearningItem,
    collection: &crate::algorithms::precision::PrecisionCollectionState,
    results: &[precision::PrecisionReviewResult; 6],
    now: chrono::DateTime<Utc>,
) -> Result<ArenaPreviewSet> {
    let item_revision = precision_item_revision(item)?;
    let cur_arena_revision = arena_revision(collection)?;
    let grades = results
        .iter()
        .enumerate()
        .map(|(grade, result)| {
            let candidates: Vec<ArenaModelCandidate> = ARENA_MODEL_IDS
                .iter()
                .enumerate()
                .map(|(index, model_id)| {
                    let interval_days = result.model_intervals[index];
                    ArenaModelCandidate {
                        model_id: *model_id,
                        label: model_id.label().to_string(),
                        interval_days,
                        due_at: arena_due_at(now, interval_days),
                        weight_percent: collection.arena.weights[index],
                        personalized: match model_id {
                            ArenaModelId::M4 => collection.m4_params.is_some(),
                            ArenaModelId::M5 => collection.fsrs_params.is_some(),
                            _ => false,
                        },
                    }
                })
                .collect();
            let (min_days, max_days) = candidates.iter().fold(
                (result.interval_days, result.interval_days),
                |(min_days, max_days), candidate| {
                    (
                        min_days.min(candidate.interval_days),
                        max_days.max(candidate.interval_days),
                    )
                },
            );
            ArenaGradePreview {
                grade: grade as u8,
                recommendation: ArenaIntervalChoice {
                    interval_days: result.interval_days,
                    due_at: arena_due_at(now, result.interval_days),
                },
                candidates,
                range: ArenaIntervalRange { min_days, max_days },
                custom_bounds: ArenaIntervalRange {
                    min_days: 1.0 / 1_440.0,
                    max_days: precision::STABILITY_MAX,
                },
            }
        })
        .collect();

    Ok(ArenaPreviewSet {
        schema_version: ARENA_SCHEMA_VERSION,
        preview_id: uuid::Uuid::new_v4().to_string(),
        item_revision,
        arena_revision: cur_arena_revision,
        generated_at: now.to_rfc3339(),
        model_order: ARENA_MODEL_IDS.to_vec(),
        grades,
    })
}

async fn apply_precision_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    native_grade: Option<i32>,
    now: chrono::DateTime<Utc>,
    precision_pure_m4: bool,
    arena_selection: Option<&ArenaSelection>,
    repo: &Repository,
) -> Result<Option<AppliedArenaDecision>> {
    use crate::algorithms::precision::DEFAULT_FI;

    // Native Precision grade (0-5) when the UI offers the native scale; otherwise
    // map the 4-button rating (Again→0, Hard→3, Good→4, Easy→5).
    let grade = native_grade
        .map(|g| g.clamp(0, 5))
        .unwrap_or_else(|| precision::rating_to_grade(review_rating as i32));

    let state = parse_precision_state(item);
    let elapsed_days = item
        .last_review_date
        .map(|lr| (now - lr).num_seconds() as f64 / 86400.0)
        .unwrap_or(0.0)
        .max(0.0);

    // Load collection-wide state (M2 optimizer, M3 matrices, Arena weights,
    // per-user model parameters).
    let mut collection = load_precision_collection(repo).await?;

    let today = now.timestamp() as i32 / 86400;
    let fi = DEFAULT_FI; // 10% forgetting index → 90% retention

    let arena_context = if let Some(selection) = arena_selection {
        if precision_pure_m4 {
            return Err(crate::error::PlethoraError::ArenaUnsupported(
                "Pure M4 reviews do not expose Algorithm Arena choices".to_string(),
            ));
        }
        if selection.preview_id.trim().is_empty() {
            return Err(crate::error::PlethoraError::ArenaPreviewStale(
                "preview_id is missing".to_string(),
            ));
        }

        let automatic_fallback = selection.preview_id == "automatic-fallback";
        let current_item_revision = precision_item_revision(item)?;
        let current_arena_revision = arena_revision(&collection)?;
        if !automatic_fallback
            && (selection.item_revision != current_item_revision
                || selection.arena_revision != current_arena_revision)
        {
            return Err(crate::error::PlethoraError::ArenaPreviewStale(
                "the card or scheduler changed after this preview was generated".to_string(),
            ));
        }

        // Recompute from current authoritative state. Client interval numbers
        // are never trusted for model or Arena selections.
        let mut preview_rng = rand::rngs::StdRng::seed_from_u64(0);
        let preview_results = precision::preview_grade_results(
            &state,
            elapsed_days,
            fi,
            &collection,
            today,
            &mut preview_rng,
            false,
            0.0,
        );
        let result = &preview_results[grade as usize];
        let authoritative_preview =
            build_arena_preview(item, &collection, &preview_results, now)?;
        let grade_preview = authoritative_preview.grades[grade as usize].clone();

        let chosen_interval = match selection.source {
            ArenaSelectionSource::Arena => result.interval_days,
            ArenaSelectionSource::Model => {
                let model_id = selection.model_id.ok_or_else(|| {
                    crate::error::PlethoraError::ArenaInvalidModel(
                        "model source requires model_id".to_string(),
                    )
                })?;
                result.model_intervals[model_id.index()]
            }
            ArenaSelectionSource::Custom => {
                let interval = selection.interval_days.ok_or_else(|| {
                    crate::error::PlethoraError::ArenaInvalidInterval(
                        "custom source requires interval_days".to_string(),
                    )
                })?;
                let bounds = &grade_preview.custom_bounds;
                if !interval.is_finite() || interval < bounds.min_days || interval > bounds.max_days
                {
                    return Err(crate::error::PlethoraError::ArenaInvalidInterval(
                        format!(
                            "interval must be between {} and {} days",
                            bounds.min_days, bounds.max_days
                        ),
                    ));
                }
                interval
            }
        };

        let snapshot = serde_json::to_string(&serde_json::json!({
            "version": 1,
            "preview_schema_version": authoritative_preview.schema_version,
            "preview_id": selection.preview_id,
            "item_revision": current_item_revision,
            "arena_revision": current_arena_revision,
            "grade": grade,
            "model_order": authoritative_preview.model_order,
            "recommendation": grade_preview.recommendation,
            "candidates": grade_preview.candidates,
            "custom_bounds": grade_preview.custom_bounds,
            "selection_source": selection.source,
            "selection_model_id": selection.model_id,
            "chosen_interval_days": chosen_interval,
            "automatic_fallback": automatic_fallback,
            "prior_item_state": format!("{:?}", item.state).to_lowercase(),
            "undo_collection": {
                "m2_optimizer": &collection.m2_optimizer,
                "m3_matrices": &collection.m3_matrices,
                "arena": &collection.arena,
            },
        }))?;

        Some((
            chosen_interval,
            result.interval_days,
            snapshot,
            current_item_revision,
            current_arena_revision,
        ))
    } else {
        None
    };

    let mut rng = rand::rngs::StdRng::from_entropy();

    let mut response = precision::review(
        &state,
        grade,
        elapsed_days,
        fi,
        &mut collection,
        today,
        true,                      // commit — mutate M2/M3 state
        arena_selection.is_none(), // exact shown interval for Arena decisions
        &mut rng,
        precision_pure_m4,
        0.0,
    );

    // The models learn normally, but fields representing the schedule that was
    // actually assigned follow the learner's explicit choice. Raw slot
    // stabilities remain untouched for fair loss scoring at the next recall.
    if let Some((chosen_interval, _, _, _, _)) = arena_context.as_ref() {
        let rounded_days = chosen_interval.round().max(1.0) as i32;
        response.interval_days = *chosen_interval;
        response.state.interval = *chosen_interval;
        response.state.m1_state.previous_interval = rounded_days;
        if let Some(history) = response.state.m1_history.as_mut() {
            history.stability = *chosen_interval;
        }
        response.state.m2_state.previous_interval = rounded_days;
        response.state.m3_state.previous_interval = rounded_days;
    }

    // Direct/Pure-M4 reviews keep the persistence path. Arena commits
    // hand the mutated collection to one database transaction below.
    if arena_context.is_none() {
        if let Ok(m2_bytes) = serde_json::to_vec(&collection.m2_optimizer) {
            let _ = repo.save_arena_m2_optimizer(&m2_bytes).await;
        }
        let _ = repo.save_arena_m3_matrices(&collection.m3_matrices).await;
        if let Ok(arena_json) = serde_json::to_string(&collection.arena) {
            let _ = repo.save_arena_state(&arena_json).await;
        }
    }

    let interval_seconds = (response.interval_days * 86400.0).round().max(60.0) as i64;
    item.due_date = now + Duration::seconds(interval_seconds);
    item.interval = response.interval_days;
    item.review_count += 1;
    item.last_review_date = Some(now);
    item.date_modified = now;
    item.lapses = response.state.lapses as i32;
    item.algorithm_state = Some(serde_json::to_string(&response.state)?);
    item.memory_state = Some(MemoryState {
        stability: response.state.stability,
        difficulty: response.state.difficulty,
    });
    item.difficulty = (response.state.difficulty * 10.0).round() as i32;

    // Grades 0-2 are fails on the Precision scale → the item lapses into relearning.
    if grade < 3 {
        item.state = ItemState::Relearning;
    } else if response.interval_days >= GRADUATION_INTERVAL_DAYS {
        item.state = ItemState::Review;
    } else {
        item.state = match item.state {
            ItemState::New => ItemState::Learning,
            ItemState::Relearning => ItemState::Relearning,
            _ => ItemState::Learning,
        };
    }

    Ok(arena_context.map(
        |(_, recommended_interval, snapshot, expected_item_revision, expected_arena_revision)| {
            AppliedArenaDecision {
                selection: arena_selection
                    .expect("Arena context requires selection")
                    .clone(),
                recommended_interval,
                snapshot,
                collection,
                expected_item_revision,
                expected_arena_revision,
            }
        },
    ))
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RestoreLearningItemStateRequest {
    pub item_id: String,
    pub due_date: chrono::DateTime<Utc>,
    pub interval: f64,
    pub ease_factor: f64,
    pub last_review_date: Option<chrono::DateTime<Utc>>,
    pub review_count: i32,
    pub lapses: i32,
    pub state: String,
    pub memory_state: Option<MemoryState>,
    pub difficulty: i32,
    #[serde(default)]
    pub algorithm_type: Option<String>,
    #[serde(default)]
    pub algorithm_state: Option<String>,
    #[serde(default)]
    pub arena_commit_id: Option<String>,
}

fn parse_item_state(value: &str) -> ItemState {
    match value.to_lowercase().as_str() {
        "new" => ItemState::New,
        "learning" => ItemState::Learning,
        "review" => ItemState::Review,
        _ => ItemState::Relearning,
    }
}

#[tauri::command]
pub async fn restore_learning_item_state(
    request: RestoreLearningItemStateRequest,
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    let mut item = repo
        .get_learning_item(&request.item_id)
        .await?
        .ok_or_else(|| {
            crate::error::PlethoraError::NotFound(format!("Learning item {}", request.item_id))
        })?;

    item.due_date = request.due_date;
    item.interval = request.interval;
    item.ease_factor = request.ease_factor;
    item.last_review_date = request.last_review_date;
    item.review_count = request.review_count;
    item.lapses = request.lapses;
    item.state = parse_item_state(&request.state);
    item.memory_state = request.memory_state;
    item.difficulty = request.difficulty;
    if let Some(algorithm_type) = request.algorithm_type {
        item.algorithm_type = algorithm_type;
    }
    item.algorithm_state = request.algorithm_state;
    item.date_modified = Utc::now();

    repo.update_learning_item(&item).await?;
    if let Some(commit_id) = request.arena_commit_id.as_deref() {
        repo.undo_arena_review_by_commit_id(commit_id).await?;
    }
    Ok(item)
}

// Helper function to get a single learning item (needed for submit_review)
pub trait RepositoryExt {
    async fn get_learning_item(&self, id: &str) -> Result<Option<LearningItem>>;
}

impl RepositoryExt for Repository {
    async fn get_learning_item(&self, id: &str) -> Result<Option<LearningItem>> {
        // Look up a single item by primary key instead of scanning the whole
        // learning_items table and filtering in Rust.
        self.get_learning_item_by_id(id).await
    }
}

/// Get the next scheduled review time for all items (for queue display)
#[tauri::command]
pub async fn get_next_review_times(repo: State<'_, Repository>) -> Result<Vec<String>> {
    let items = repo.get_all_learning_items().await?;
    let now = Utc::now();

    let due_times: Vec<String> = items
        .iter()
        .filter(|item| !item.is_suspended)
        .map(|item| {
            if item.due_date <= now {
                "Now".to_string()
            } else {
                let duration = item.due_date - now;
                let hours = duration.num_hours();
                if hours < 24 {
                    format!("{}h", hours)
                } else {
                    format!("{}d", duration.num_days())
                }
            }
        })
        .collect();

    Ok(due_times)
}

/// Calculate algorithm parameters for preview (show user what will happen with each rating)
#[tauri::command]
pub async fn preview_review_intervals(
    item_id: String,
    algorithm: Option<String>,
    precision_pure_kernel: Option<bool>,
    sm20_pure_m4: Option<bool>,
    repo: State<'_, Repository>,
) -> Result<PreviewIntervals> {
    let precision_pure_kernel = precision_pure_kernel
        .or(sm20_pure_m4)
        .unwrap_or(false);
    let algo = algorithm.as_deref().unwrap_or("fsrs");
    let normalized = normalize_algorithm_type(algo);

    if normalized == "precision" {
        let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
            crate::error::PlethoraError::NotFound(format!("Learning item {}", item_id))
        })?;
        let now = Utc::now();
        let elapsed_days = item
            .last_review_date
            .map(|lr| (now - lr).num_seconds() as f64 / 86400.0)
            .unwrap_or(0.0)
            .max(0.0);
        let state = parse_precision_state(&item);

        // Load collection state for preview (scratch mode — no mutation)
        let collection = load_precision_collection(&repo).await?;
        let today = now.timestamp() as i32 / 86400;
        let mut rng = rand::rngs::StdRng::seed_from_u64(0);
        let grade_results = precision::preview_grade_results(
            &state,
            elapsed_days,
            crate::algorithms::precision::DEFAULT_FI,
            &collection,
            today,
            &mut rng,
            precision_pure_kernel,
            0.0,
        );
        let grades: [f64; 6] = std::array::from_fn(|index| grade_results[index].interval_days);
        let arena = if precision_pure_kernel {
            None
        } else {
            Some(build_arena_preview(
                &item,
                &collection,
                &grade_results,
                now,
            )?)
        };

        return Ok(PreviewIntervals {
            again: grades[precision::rating_to_grade(1) as usize],
            hard: grades[precision::rating_to_grade(2) as usize],
            good: grades[precision::rating_to_grade(3) as usize],
            easy: grades[precision::rating_to_grade(4) as usize],
            grade_intervals: Some(grades.to_vec()),
            arena,
        });
    }

    if normalized == "adaptive" {
        let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
            crate::error::PlethoraError::NotFound(format!("Learning item {}", item_id))
        })?;

        use crate::algorithms::adaptive::{AdaptiveScheduler, AdaptiveState};
        let now = Utc::now();
        let elapsed_days = item
            .last_review_date
            .map(|lr| (now - lr).num_seconds() as f64 / 86400.0)
            .unwrap_or(0.0)
            .max(0.0);

        let base_state: AdaptiveState = item
            .algorithm_state
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();

        let normalize = |interval: f64| {
            if !interval.is_finite() || interval <= 0.0 {
                1.0
            } else {
                interval
            }
        };

        let grade_intervals: Vec<f64> = (0..=5)
            .map(|grade| {
                let mut scratch = base_state.clone();
                let result = AdaptiveScheduler::review_default(&mut scratch, grade, elapsed_days);
                normalize(result.new_interval)
            })
            .collect();

        return Ok(PreviewIntervals {
            again: grade_intervals[0],
            hard: grade_intervals[3],
            good: grade_intervals[4],
            easy: grade_intervals[5],
            grade_intervals: Some(grade_intervals),
            arena: None,
        });
    }

    if normalized == "classic" {
        let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
            crate::error::PlethoraError::NotFound(format!("Learning item {}", item_id))
        })?;
        use crate::algorithms::classic::{ClassicScheduler, ClassicState};
        let state: ClassicState = item
            .algorithm_state
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        let algo = ClassicScheduler::new();
        return Ok(PreviewIntervals {
            again: algo.next_state(&state, ReviewRating::Again).interval,
            hard: algo.next_state(&state, ReviewRating::Hard).interval,
            good: algo.next_state(&state, ReviewRating::Good).interval,
            easy: algo.next_state(&state, ReviewRating::Easy).interval,
            grade_intervals: None,
            arena: None,
        });
    }

    if normalized == "classic_5" {
        let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
            crate::error::PlethoraError::NotFound(format!("Learning item {}", item_id))
        })?;
        use crate::algorithms::classic::{Classic5Scheduler, Classic5State};
        let state: Classic5State = item
            .algorithm_state
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        let algo = Classic5Scheduler::new();
        return Ok(PreviewIntervals {
            again: algo.next_state(&state, ReviewRating::Again).interval,
            hard: algo.next_state(&state, ReviewRating::Hard).interval,
            good: algo.next_state(&state, ReviewRating::Good).interval,
            easy: algo.next_state(&state, ReviewRating::Easy).interval,
            grade_intervals: None,
            arena: None,
        });
    }

    if normalized == "classic_8" {
        let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
            crate::error::PlethoraError::NotFound(format!("Learning item {}", item_id))
        })?;
        use crate::algorithms::classic::{Classic8Scheduler, Classic8State};
        let state: Classic8State = item
            .algorithm_state
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        let algo = Classic8Scheduler::new();
        return Ok(PreviewIntervals {
            again: algo.next_state(&state, ReviewRating::Again).interval,
            hard: algo.next_state(&state, ReviewRating::Hard).interval,
            good: algo.next_state(&state, ReviewRating::Good).interval,
            easy: algo.next_state(&state, ReviewRating::Easy).interval,
            grade_intervals: None,
            arena: None,
        });
    }

    if normalized == "classic_15" {
        let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
            crate::error::PlethoraError::NotFound(format!("Learning item {}", item_id))
        })?;
        use crate::algorithms::classic::{Classic15Scheduler, Classic15State};
        let state: Classic15State = item
            .algorithm_state
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        let algo = Classic15Scheduler::new();
        return Ok(PreviewIntervals {
            again: algo.next_interval(&algo.next_state(&state, ReviewRating::Again)) as f64,
            hard: algo.next_interval(&algo.next_state(&state, ReviewRating::Hard)) as f64,
            good: algo.next_interval(&algo.next_state(&state, ReviewRating::Good)) as f64,
            easy: algo.next_interval(&algo.next_state(&state, ReviewRating::Easy)) as f64,
            grade_intervals: None,
            arena: None,
        });
    }

    let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Learning item {}", item_id))
    })?;

    let fsrs = fsrs::FSRS::new(Some(&[]))?;
    let now = Utc::now();

    // Calculate elapsed days with fractional precision
    let elapsed_days = item
        .last_review_date
        .map(|lr| {
            let duration = now - lr;
            duration.num_seconds() as f64 / 86400.0
        })
        .unwrap_or(0.0)
        .max(0.0) as u32;

    let current_memory_state = item.memory_state.clone().and_then(|ms| {
        if ms.stability <= 0.0 || ms.difficulty <= 0.0 {
            None
        } else {
            Some(fsrs::MemoryState {
                stability: ms.stability as f32,
                difficulty: ms.difficulty as f32,
            })
        }
    });

    let next_states = fsrs.next_states(
        current_memory_state,
        DEFAULT_DESIRED_RETENTION,
        elapsed_days,
    )?;

    let normalize = |interval: f64, rating: ReviewRating| {
        if !interval.is_finite() || interval <= 0.0 {
            match rating {
                ReviewRating::Again => MIN_AGAIN_INTERVAL_DAYS,
                ReviewRating::Hard => MIN_HARD_INTERVAL_DAYS,
                ReviewRating::Good => MIN_GOOD_INTERVAL_DAYS,
                ReviewRating::Easy => MIN_EASY_INTERVAL_DAYS,
            }
        } else {
            interval
        }
    };

    Ok(PreviewIntervals {
        again: normalize(next_states.again.interval as f64, ReviewRating::Again),
        hard: normalize(next_states.hard.interval as f64, ReviewRating::Hard),
        good: normalize(next_states.good.interval as f64, ReviewRating::Good),
        easy: normalize(next_states.easy.interval as f64, ReviewRating::Easy),
        grade_intervals: None,
        arena: None,
    })
}

#[derive(serde::Serialize)]
pub struct PreviewIntervals {
    /// Intervals in days (can be fractional for learning items)
    pub again: f64,
    pub hard: f64,
    pub good: f64,
    pub easy: f64,
    /// Native per-grade intervals (index = grade 0-5). Only present for
    /// algorithms with a native grade scale (currently Precision).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grade_intervals: Option<Vec<f64>>,
    /// Full deterministic Algorithm Arena choice set. Only available for the
    /// normal Precision ensemble; Pure M4 and every other scheduler omit it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arena: Option<ArenaPreviewSet>,
}

// =============================================================================
// ALGORITHM ARENA + PER-USER OPTIMIZERS
// =============================================================================

/// Snapshot of the Algorithm Arena for the UI.
#[derive(serde::Serialize)]
pub struct ArenaStats {
    /// The five competitors, slot order.
    pub model_names: Vec<String>,
    /// Live blend weights (sum 100).
    pub weights: Vec<f64>,
    /// Mean decayed log-loss per model (None until enough scored reviews).
    pub mean_losses: Option<Vec<f64>>,
    /// R-Metric: % log-loss improvement of the blend over baseline alone.
    pub r_metric: Option<f64>,
    /// Lifetime scored reviews.
    pub total_scored: u64,
    /// Whether per-user optimized parameters are active.
    pub fsrs_optimized: bool,
    pub m4_optimized: bool,
}

/// Current Algorithm Arena weights and R-Metric.
#[tauri::command]
pub async fn get_arena_stats(repo: State<'_, Repository>) -> Result<ArenaStats> {
    let collection = load_precision_collection(&repo).await?;
    let arena = &collection.arena;
    Ok(ArenaStats {
        model_names: crate::algorithms::precision::arena::ARENA_MODEL_NAMES
            .iter()
            .map(|s| s.to_string())
            .collect(),
        weights: arena.weights.to_vec(),
        mean_losses: arena.mean_losses().map(|l| l.to_vec()),
        r_metric: arena.r_metric(),
        total_scored: arena.total_scored,
        fsrs_optimized: collection.fsrs_params.is_some(),
        m4_optimized: collection.m4_params.is_some(),
    })
}

/// Build per-item review sequences `(elapsed_days, grade)` from the revlog.
/// Ratings (1-4) map onto the rating grade scale via the standard mapping.
async fn build_revlog_items(
    repo: &Repository,
) -> Result<Vec<crate::algorithms::precision::optimize::RevlogItem>> {
    use crate::algorithms::precision::optimize::RevlogItem;

    fn parse_ts(s: &str) -> Option<chrono::DateTime<Utc>> {
        chrono::DateTime::parse_from_rfc3339(s)
            .map(|d| d.with_timezone(&Utc))
            .ok()
            .or_else(|| {
                chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f")
                    .ok()
                    .map(|n| n.and_utc())
            })
    }

    let rows = repo.get_revlog_for_training().await?;
    let mut items: Vec<RevlogItem> = Vec::new();
    let mut current_id: Option<String> = None;
    let mut last_ts: Option<chrono::DateTime<Utc>> = None;
    for (item_id, rating, ts) in rows {
        let Some(ts) = parse_ts(&ts) else { continue };
        let grade = precision::rating_to_grade(rating);
        if current_id.as_deref() != Some(item_id.as_str()) {
            current_id = Some(item_id);
            last_ts = None;
            items.push(RevlogItem {
                reviews: Vec::new(),
            });
        }
        let elapsed = match last_ts {
            Some(prev) => ((ts - prev).num_seconds() as f64 / 86400.0).max(0.0),
            None => 0.0,
        };
        last_ts = Some(ts);
        if let Some(item) = items.last_mut() {
            item.reviews.push((elapsed, grade));
        }
    }
    items.retain(|i| !i.reviews.is_empty());
    Ok(items)
}

/// Summary of an FSRS optimization run.
#[derive(serde::Serialize)]
pub struct FsrsOptimizeSummary {
    pub accepted: bool,
    pub items: usize,
    pub train_items: usize,
    pub message: String,
}

/// Fit per-user FSRS parameters for the Arena's competitor using the
/// fsrs crate's own optimizer over the full review log.
#[tauri::command]
pub async fn optimize_arena_fsrs(repo: State<'_, Repository>) -> Result<FsrsOptimizeSummary> {
    use crate::algorithms::precision::optimize::build_fsrs_items;

    let revlog = build_revlog_items(&repo).await?;
    let items_count = revlog.len();
    let train_set = build_fsrs_items(&revlog);
    let train_items = train_set.len();

    let params = tauri::async_runtime::spawn_blocking(move || {
        let engine = fsrs::FSRS::new(Some(&[]))
            .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
        engine
            .compute_parameters(fsrs::ComputeParametersInput {
                train_set,
                progress: None,
                enable_short_term: true,
                num_relearning_steps: None,
            })
            .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
    })
    .await
    .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))??;

    // The crate returns its stock defaults when there is too little history —
    // storing those would just add overhead for no personalization.
    let is_default = params
        .iter()
        .zip(fsrs::DEFAULT_PARAMETERS.iter())
        .all(|(a, b)| (a - b).abs() < 1e-9)
        && params.len() == fsrs::DEFAULT_PARAMETERS.len();

    if is_default {
        return Ok(FsrsOptimizeSummary {
            accepted: false,
            items: items_count,
            train_items,
            message: format!(
                "Not enough review history to personalize FSRS yet ({train_items} training \
                 reviews). Keep reviewing and try again."
            ),
        });
    }

    let meta = serde_json::json!({
        "items": items_count,
        "train_items": train_items,
        "optimized_at": Utc::now().to_rfc3339(),
    });
    repo.save_arena_model_params(
        "fsrs",
        &serde_json::to_string(&params)?,
        Some(&meta.to_string()),
    )
    .await?;

    Ok(FsrsOptimizeSummary {
        accepted: true,
        items: items_count,
        train_items,
        message: format!(
            "Personalized FSRS parameters fitted from {train_items} training reviews across \
             {items_count} items. The Arena's FSRS competitor now uses them."
        ),
    })
}

/// Fit the Precision (Kernel) 35-parameter kernel to the user's review log.
#[tauri::command]
pub async fn optimize_precision_kernel(
    repo: State<'_, Repository>,
) -> Result<crate::algorithms::precision::optimize::M4OptimizeOutcome> {
    use crate::algorithms::precision::optimize::optimize_m4;

    let revlog = build_revlog_items(&repo).await?;
    let outcome = tauri::async_runtime::spawn_blocking(move || optimize_m4(&revlog))
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;

    if outcome.accepted {
        if let Some(params) = &outcome.params {
            let meta = serde_json::json!({
                "items": outcome.items,
                "train_predictions": outcome.train_predictions,
                "val_predictions": outcome.val_predictions,
                "val_loss_before": outcome.val_loss_before,
                "val_loss_after": outcome.val_loss_after,
                "iterations": outcome.iterations,
                "optimized_at": Utc::now().to_rfc3339(),
            });
            repo.save_arena_model_params(
                "m4",
                &serde_json::to_string(params)?,
                Some(&meta.to_string()),
            )
            .await?;
        }
    }
    Ok(outcome)
}

/// Get all review sessions for a specific collection
#[tauri::command]
pub async fn get_review_sessions_by_collection(
    collection_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        r#"SELECT id, collection_id, start_time, end_time, items_reviewed, correct_answers, total_time
           FROM review_sessions WHERE collection_id = ?1"#
    )
    .bind(&collection_id)
    .fetch_all(repo.pool())
    .await
    .map_err(crate::error::PlethoraError::Database)?;

    Ok(rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<String, _>("id"),
                "collectionId": row.get::<String, _>("collection_id"),
                "startTime": row.get::<String, _>("start_time"),
                "endTime": row.get::<Option<String>, _>("end_time"),
                "itemsReviewed": row.get::<i32, _>("items_reviewed"),
                "correctAnswers": row.get::<i32, _>("correct_answers"),
                "totalTime": row.get::<i32, _>("total_time"),
            })
        })
        .collect())
}

/// Get all review results (used for export)
#[tauri::command]
pub async fn get_all_review_results(repo: State<'_, Repository>) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        r#"SELECT id, collection_id, session_id, item_id, rating, time_taken,
                  new_due_date, new_interval, new_ease_factor, timestamp,
                  schedule_source, schedule_model_id, arena_commit_id,
                  arena_recommended_interval, arena_decision_time_ms, arena_snapshot
           FROM review_results"#,
    )
    .fetch_all(repo.pool())
    .await
    .map_err(crate::error::PlethoraError::Database)?;

    Ok(rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<String, _>("id"),
                "collectionId": row.get::<String, _>("collection_id"),
                "reviewSessionId": row.get::<Option<String>, _>("session_id"),
                "itemId": row.get::<String, _>("item_id"),
                "rating": row.get::<i32, _>("rating"),
                "timeTaken": row.get::<i32, _>("time_taken"),
                "newDueDate": row.get::<Option<String>, _>("new_due_date"),
                "newInterval": row.get::<f64, _>("new_interval"),
                "newEaseFactor": row.get::<f64, _>("new_ease_factor"),
                "timestamp": row.get::<String, _>("timestamp"),
                "scheduleSource": row.get::<Option<String>, _>("schedule_source"),
                "scheduleModelId": row.get::<Option<String>, _>("schedule_model_id"),
                "arenaCommitId": row.get::<Option<String>, _>("arena_commit_id"),
                "arenaRecommendedInterval": row.get::<Option<f64>, _>("arena_recommended_interval"),
                "arenaDecisionTimeMs": row.get::<Option<i64>, _>("arena_decision_time_ms"),
                "arenaSnapshot": row.get::<Option<String>, _>("arena_snapshot"),
            })
        })
        .collect())
}

/// Get review results for a specific set of review sessions.
///
/// This is the server-side-filtered variant of `get_all_review_results`: it
/// pushes the session-id filter into SQL (parameterized `IN (...)`) so we only
/// ship the matching rows across IPC instead of the whole table. The returned
/// row shape is identical to `get_all_review_results` (used by the collection
/// archive view, which previously filtered the full table client-side).
///
/// `session_ids` are chunked (900 at a time) to respect SQLite's bind limit
/// (SQLITE_MAX_VARIABLE_NUMBER, default 999).
#[tauri::command]
pub async fn get_review_results_by_sessions(
    session_ids: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<serde_json::Value>> {
    if session_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Deduplicate so we don't bind the same id repeatedly.
    let mut unique: Vec<String> = session_ids.into_iter().collect();
    unique.sort_unstable();
    unique.dedup();

    // SQLite's default bind limit is 999; one column in the IN list means we
    // can safely chunk at 900 per query.
    const CHUNK_SIZE: usize = 900;

    let mut out: Vec<serde_json::Value> = Vec::new();

    for chunk in unique.chunks(CHUNK_SIZE) {
        // Build positional placeholders ?1..?N
        let placeholders: Vec<String> = chunk
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            r#"SELECT id, collection_id, session_id, item_id, rating, time_taken,
                      new_due_date, new_interval, new_ease_factor, timestamp,
                      schedule_source, schedule_model_id, arena_commit_id,
                      arena_recommended_interval, arena_decision_time_ms, arena_snapshot
               FROM review_results WHERE session_id IN ({})"#,
            placeholders.join(",")
        );

        let mut query = sqlx::query(&sql);
        for id in chunk {
            query = query.bind(id);
        }

        let rows = query
            .fetch_all(repo.pool())
            .await
            .map_err(crate::error::PlethoraError::Database)?;

        for row in &rows {
            out.push(serde_json::json!({
                "id": row.get::<String, _>("id"),
                "collectionId": row.get::<String, _>("collection_id"),
                "reviewSessionId": row.get::<Option<String>, _>("session_id"),
                "itemId": row.get::<String, _>("item_id"),
                "rating": row.get::<i32, _>("rating"),
                "timeTaken": row.get::<i32, _>("time_taken"),
                "newDueDate": row.get::<Option<String>, _>("new_due_date"),
                "newInterval": row.get::<f64, _>("new_interval"),
                "newEaseFactor": row.get::<f64, _>("new_ease_factor"),
                "timestamp": row.get::<String, _>("timestamp"),
                "scheduleSource": row.get::<Option<String>, _>("schedule_source"),
                "scheduleModelId": row.get::<Option<String>, _>("schedule_model_id"),
                "arenaCommitId": row.get::<Option<String>, _>("arena_commit_id"),
                "arenaRecommendedInterval": row.get::<Option<f64>, _>("arena_recommended_interval"),
                "arenaDecisionTimeMs": row.get::<Option<i64>, _>("arena_decision_time_ms"),
                "arenaSnapshot": row.get::<Option<String>, _>("arena_snapshot"),
            }));
        }
    }

    Ok(out)
}

/// Get all categories for a specific collection
#[tauri::command]
pub async fn get_categories_by_collection(
    collection_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<serde_json::Value>> {
    let rows = sqlx::query(
        r#"SELECT id, name, color, icon, parent_id, collection_id
           FROM categories WHERE collection_id = ?1"#,
    )
    .bind(&collection_id)
    .fetch_all(repo.pool())
    .await
    .map_err(crate::error::PlethoraError::Database)?;

    Ok(rows
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<String, _>("id"),
                "name": row.get::<String, _>("name"),
                "color": row.get::<Option<String>, _>("color"),
                "icon": row.get::<Option<String>, _>("icon"),
                "parentId": row.get::<Option<String>, _>("parent_id"),
                "collectionId": row.get::<String, _>("collection_id"),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::connection::Database;
    use crate::error::PlethoraError;
    use crate::models::ItemType;
    use rand::SeedableRng;
    use std::path::PathBuf;

    async fn setup_review_repo() -> Repository {
        let database = Database::new(PathBuf::from(":memory:"))
            .await
            .expect("database");
        database.migrate().await.expect("migrations");
        Repository::new(database.pool().clone())
    }

    async fn preview_item_arena(repo: &Repository, item: &LearningItem) -> ArenaPreviewSet {
        let collection = load_precision_collection(repo).await.expect("Precision collection");
        let state = parse_precision_state(item);
        let now = Utc::now();
        let results = precision::preview_grade_results(
            &state,
            0.0,
            precision::DEFAULT_FI,
            &collection,
            now.timestamp() as i32 / 86_400,
            &mut rand::rngs::StdRng::seed_from_u64(0),
            false,
            0.0,
        );
        build_arena_preview(item, &collection, &results, now).expect("Arena preview")
    }

    #[test]
    fn test_review_rating_from_valid_values() {
        // 0 is out of range, defaults to Good
        assert!(matches!(ReviewRating::from(0), ReviewRating::Good));
        assert!(matches!(ReviewRating::from(1), ReviewRating::Again));
        assert!(matches!(ReviewRating::from(2), ReviewRating::Hard));
        assert!(matches!(ReviewRating::from(3), ReviewRating::Good));
        assert!(matches!(ReviewRating::from(4), ReviewRating::Easy));
        // 5 is out of range, defaults to Good
        assert!(matches!(ReviewRating::from(5), ReviewRating::Good));
    }

    #[test]
    fn test_algorithm_type_roundtrip() {
        fn legacy_scheduler_suffix(suffix: &str) -> String {
            let mut id = String::from("s");
            id.push('m');
            id.push_str(suffix);
            id
        }

        for name in &[
            "fsrs", "classic", "classic_5", "classic_8", "classic_15", "adaptive", "precision",
        ] {
            let algo = AlgorithmType::from_str_lossy(name);
            assert_eq!(algo.as_str(), *name);
        }

        for suffix in ["2", "5", "8", "15", "18", "20"] {
            let legacy = legacy_scheduler_suffix(suffix);
            let algo = AlgorithmType::from_str_lossy(&legacy);
            assert_eq!(algo.as_str(), normalize_algorithm_type(&legacy));
        }
    }

    #[test]
    fn test_algorithm_type_unknown_defaults_to_fsrs() {
        let algo = AlgorithmType::from_str_lossy("unknown_algo");
        assert_eq!(algo.as_str(), "fsrs");
    }

    #[tokio::test]
    async fn arena_choices_are_authoritative_validated_and_idempotent() {
        let repo = setup_review_repo().await;

        for model_id in ARENA_MODEL_IDS {
            let mut item =
                LearningItem::new(ItemType::Flashcard, format!("Arena model {:?}", model_id));
            item.algorithm_type = "precision".to_string();
            repo.create_learning_item(&item).await.expect("model item");
            let item = repo
                .get_learning_item_by_id(&item.id)
                .await
                .expect("item read")
                .expect("item");
            let preview = preview_item_arena(&repo, &item).await;
            let grade_preview = &preview.grades[4];
            let expected = grade_preview.candidates[model_id.index()].interval_days;
            let selection = ArenaSelection {
                commit_id: format!("model-commit-{}", model_id.as_str()),
                preview_id: preview.preview_id,
                item_revision: preview.item_revision,
                arena_revision: preview.arena_revision,
                source: ArenaSelectionSource::Model,
                model_id: Some(model_id),
                interval_days: Some(44_000.0), // spoofed client value must be ignored
                decision_time_ms: 120,
            };

            let committed = apply_review(
                &repo,
                &item.id,
                3,
                7,
                None,
                DEFAULT_DESIRED_RETENTION,
                None,
                false,
                Some("precision"),
                Some(4),
                false,
                Some(&selection),
            )
            .await
            .expect("model commit");
            assert_eq!(
                committed.interval, expected,
                "model interval is authoritative"
            );

            let repeated = apply_review(
                &repo,
                &item.id,
                3,
                7,
                None,
                DEFAULT_DESIRED_RETENTION,
                None,
                false,
                Some("precision"),
                Some(4),
                false,
                Some(&selection),
            )
            .await
            .expect("idempotent retry");
            assert_eq!(repeated.review_count, 1);
            let event_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM review_results WHERE arena_commit_id = ?1",
            )
            .bind(&selection.commit_id)
            .fetch_one(repo.pool())
            .await
            .expect("event count");
            assert_eq!(event_count, 1);
        }
        let arena_after_model_choices = load_precision_collection(&repo)
            .await
            .expect("Arena after model choices")
            .arena;
        assert_eq!(
            arena_after_model_choices.weights,
            crate::algorithms::precision::arena::ARENA_DEFAULT_WEIGHTS,
            "choosing a model must not reward it; weights learn only from scored recall loss",
        );

        let mut arena_item = LearningItem::new(ItemType::Flashcard, "Arena Pick".to_string());
        arena_item.algorithm_type = "precision".to_string();
        repo.create_learning_item(&arena_item)
            .await
            .expect("Arena Pick item");
        let arena_item = repo
            .get_learning_item_by_id(&arena_item.id)
            .await
            .expect("Arena Pick item read")
            .expect("Arena Pick item");
        let arena_preview = preview_item_arena(&repo, &arena_item).await;
        let arena_expected = arena_preview.grades[4].recommendation.interval_days;
        let arena_selection = ArenaSelection {
            commit_id: "arena-pick-commit".to_string(),
            preview_id: arena_preview.preview_id,
            item_revision: arena_preview.item_revision,
            arena_revision: arena_preview.arena_revision,
            source: ArenaSelectionSource::Arena,
            model_id: None,
            interval_days: Some(44_000.0), // recommendation is also server-authoritative
            decision_time_ms: 80,
        };
        let arena_committed = apply_review(
            &repo,
            &arena_item.id,
            3,
            5,
            None,
            DEFAULT_DESIRED_RETENTION,
            None,
            false,
            Some("precision"),
            Some(4),
            false,
            Some(&arena_selection),
        )
        .await
        .expect("Arena Pick commit");
        assert_eq!(
            arena_committed.interval, arena_expected,
            "Arena Pick interval is authoritative",
        );

        let mut custom_item = LearningItem::new(ItemType::Flashcard, "Valid custom".to_string());
        custom_item.algorithm_type = "precision".to_string();
        repo.create_learning_item(&custom_item)
            .await
            .expect("custom item");
        let custom_item = repo
            .get_learning_item_by_id(&custom_item.id)
            .await
            .expect("custom item read")
            .expect("custom item");
        let custom_preview = preview_item_arena(&repo, &custom_item).await;
        let custom_selection = ArenaSelection {
            commit_id: "valid-custom-commit".to_string(),
            preview_id: custom_preview.preview_id,
            item_revision: custom_preview.item_revision,
            arena_revision: custom_preview.arena_revision,
            source: ArenaSelectionSource::Custom,
            model_id: None,
            interval_days: Some(9.5),
            decision_time_ms: 500,
        };
        let custom_committed = apply_review(
            &repo,
            &custom_item.id,
            3,
            5,
            None,
            DEFAULT_DESIRED_RETENTION,
            None,
            false,
            Some("precision"),
            Some(4),
            false,
            Some(&custom_selection),
        )
        .await
        .expect("custom commit");
        assert_eq!(custom_committed.interval, 9.5);
        assert_eq!(
            load_precision_collection(&repo)
                .await
                .expect("Arena after Custom choice")
                .arena
                .weights,
            crate::algorithms::precision::arena::ARENA_DEFAULT_WEIGHTS,
            "choosing Custom must not reward any model",
        );

        for (label, mutate_selection, expected_error) in [
            (
                "invalid custom",
                Box::new(|preview: &ArenaPreviewSet| ArenaSelection {
                    commit_id: "invalid-custom-commit".to_string(),
                    preview_id: preview.preview_id.clone(),
                    item_revision: preview.item_revision.clone(),
                    arena_revision: preview.arena_revision.clone(),
                    source: ArenaSelectionSource::Custom,
                    model_id: None,
                    interval_days: Some(precision::STABILITY_MAX + 1.0),
                    decision_time_ms: 1,
                }) as Box<dyn Fn(&ArenaPreviewSet) -> ArenaSelection>,
                "interval",
            ),
            (
                "stale preview",
                Box::new(|preview: &ArenaPreviewSet| ArenaSelection {
                    commit_id: "stale-preview-commit".to_string(),
                    preview_id: preview.preview_id.clone(),
                    item_revision: "stale".to_string(),
                    arena_revision: preview.arena_revision.clone(),
                    source: ArenaSelectionSource::Arena,
                    model_id: None,
                    interval_days: None,
                    decision_time_ms: 1,
                }),
                "stale",
            ),
        ] {
            let mut item = LearningItem::new(ItemType::Flashcard, label.to_string());
            item.algorithm_type = "precision".to_string();
            repo.create_learning_item(&item)
                .await
                .expect("validation item");
            let item = repo
                .get_learning_item_by_id(&item.id)
                .await
                .expect("validation item read")
                .expect("validation item");
            let preview = preview_item_arena(&repo, &item).await;
            let selection = mutate_selection(&preview);
            let result = apply_review(
                &repo,
                &item.id,
                3,
                5,
                None,
                DEFAULT_DESIRED_RETENTION,
                None,
                false,
                Some("precision"),
                Some(4),
                false,
                Some(&selection),
            )
            .await;
            match expected_error {
                "interval" => assert!(matches!(
                    result,
                    Err(PlethoraError::ArenaInvalidInterval(_))
                )),
                _ => assert!(matches!(
                    result,
                    Err(PlethoraError::ArenaPreviewStale(_))
                )),
            }
            assert_eq!(
                repo.get_learning_item_by_id(&item.id)
                    .await
                    .expect("validation item after failure")
                    .expect("validation item")
                    .review_count,
                0,
            );
        }
    }

    #[test]
    fn parse_precision_state_coerces_degenerate_difficulty() {
        use crate::models::ItemType;
        let mut item = LearningItem {
            id: "test".into(),
            collection_id: crate::models::collection::DEFAULT_COLLECTION_ID.into(),
            extract_id: None,
            document_id: None,
            item_type: ItemType::Flashcard,
            question: "q".into(),
            answer: Some("a".into()),
            cloze_text: None,
            cloze_ranges: None,
            difficulty: 3,
            interval: 0.0,
            ease_factor: 2.5,
            due_date: Utc::now(),
            date_created: Utc::now(),
            date_modified: Utc::now(),
            last_review_date: None,
            review_count: 0,
            lapses: 0,
            state: ItemState::New,
            is_suspended: false,
            tags: vec![],
            image_asset_ids: vec![],
            interaction_metadata: None,
            memory_state: Some(MemoryState {
                stability: 0.0,
                difficulty: 0.0,
            }),
            algorithm_type: "fsrs".into(),
            algorithm_state: None,
            updated_at: None,
            first_reviewed_at: None,
            priority_slider: 50,
            priority_score: 0.0,
            priority_explicitly_set: false,
        };

        // D=0.0 must be coerced away from the degenerate edge bucket.
        let state = parse_precision_state(&item);
        assert!(
            (0.05..=0.95).contains(&state.difficulty),
            "degenerate D=0.0 should be coerced, got {}",
            state.difficulty
        );
        assert!(
            state.stability >= 1.0,
            "stability should be floored to 1.0, got {}",
            state.stability
        );

        // A sane interior difficulty passes through unchanged.
        item.memory_state = Some(MemoryState {
            stability: 5.0,
            difficulty: 0.4,
        });
        let state = parse_precision_state(&item);
        assert!((state.difficulty - 0.4).abs() < 1e-9);
        assert!((state.stability - 5.0).abs() < 1e-9);

        // D=1.0 (the other edge) is also coerced.
        item.memory_state = Some(MemoryState {
            stability: 3.0,
            difficulty: 1.0,
        });
        let state = parse_precision_state(&item);
        assert!(
            (0.05..=0.95).contains(&state.difficulty),
            "degenerate D=1.0 should be coerced, got {}",
            state.difficulty
        );
    }
}
