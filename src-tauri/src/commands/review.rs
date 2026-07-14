//! Review commands using FSRS algorithm

use crate::algorithms::sm20::{self, SM20State};
use crate::algorithms::AlgorithmType;
use crate::database::Repository;
use crate::error::Result;
use crate::models::{ItemState, LearningItem, MemoryState, ReviewRating};
use chrono::{Duration, Utc};
use rand::SeedableRng;
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
    repo: State<'_, Repository>,
) -> Result<LearningItem> {
    tracing::info!(
        item_id = %item_id,
        rating,
        grade = grade.map(|g| g.to_string()).unwrap_or_default(),
        time_taken,
        session_id = session_id.as_deref().unwrap_or(""),
        algorithm = algorithm.as_deref().unwrap_or("fsrs"),
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
    )
    .await
}

/// Main review dispatcher — routes to the correct algorithm based on the caller's algorithm parameter,
/// falling back to the item's stored algorithm_type.
///
/// `native_grade` is an optional SM-20 grade (0-5, SuperMemo scale) used only
/// by the SM-20 path; when present it bypasses the 4-button rating→grade
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
) -> Result<LearningItem> {
    let mut item = repo.get_learning_item(item_id).await?.ok_or_else(|| {
        crate::error::IncrementumError::NotFound(format!("Learning item {}", item_id))
    })?;

    let review_rating = ReviewRating::from(rating);

    if no_schedule_update {
        return Ok(item);
    }

    let now = Utc::now();

    // Use the caller's algorithm parameter if provided, otherwise fall back to item's stored type
    let effective_algorithm = algorithm.unwrap_or(&item.algorithm_type);
    let algo = AlgorithmType::from_str_lossy(effective_algorithm);

    // Update the item's algorithm_type to match the effective algorithm
    item.algorithm_type = effective_algorithm.to_string();

    match algo {
        AlgorithmType::Fsrs => {
            apply_fsrs_review_inner(
                &mut item,
                review_rating,
                desired_retention,
                fsrs_weights,
                now,
            )?;
        }
        AlgorithmType::Sm2 => {
            apply_sm2_review(&mut item, review_rating, now)?;
        }
        AlgorithmType::Sm5 => {
            apply_sm5_review(&mut item, review_rating, now)?;
        }
        AlgorithmType::Sm8 => {
            apply_sm8_review(&mut item, review_rating, now)?;
        }
        AlgorithmType::Sm15 => {
            apply_sm15_review(&mut item, review_rating, desired_retention, now)?;
        }
        AlgorithmType::Sm18 => {
            apply_sm18_review(&mut item, review_rating, now)?;
        }
        AlgorithmType::Sm20 => {
            apply_sm20_review(&mut item, review_rating, native_grade, now, repo).await?;
        }
    }

    repo.update_learning_item(&item).await?;

    // Track review statistics. With a native SM-20 grade, pass = grade >= 3;
    // otherwise keep the 4-button convention (Good/Easy are correct).
    let was_correct = match native_grade {
        Some(g) => g >= 3,
        None => rating >= 3,
    };

    let review_result_id = uuid::Uuid::new_v4().to_string();
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

    let today = now.format("%Y-%m-%d").to_string();
    let old_state = item.state.clone(); // Clone state to avoid partial move

    // Determine card type for statistics
    let (new_cards, learning_cards, review_cards) = match old_state {
        ItemState::New => (1, 0, 0),
        ItemState::Learning | ItemState::Relearning => (0, 1, 0),
        ItemState::Review => (0, 0, 1),
    };

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

/// SM-2 review implementation
fn apply_sm2_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::supermemo::{SM2Algorithm, SM2State};

    let state: SM2State = item
        .algorithm_state
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let algo = SM2Algorithm::new();
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

/// SM-5 review implementation
fn apply_sm5_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::supermemo::{SM5Algorithm, SM5State};

    let state: SM5State = item
        .algorithm_state
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let algo = SM5Algorithm::new();
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

/// SM-8 review implementation
fn apply_sm8_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::supermemo::{SM8Algorithm, SM8State};

    let state: SM8State = item
        .algorithm_state
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let algo = SM8Algorithm::new();
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

/// SM-15 review implementation
fn apply_sm15_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    _desired_retention: f32,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::supermemo::{SM15Algorithm, SM15State};

    let state: SM15State = item
        .algorithm_state
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let algo = SM15Algorithm::new();
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

/// SM-18 review implementation
fn apply_sm18_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    now: chrono::DateTime<Utc>,
) -> Result<()> {
    use crate::algorithms::sm18::{SM18Algorithm, SM18State};

    // SM-18 grades: 0-2 = failure, 3-5 = pass (SUCCESS_GRADE = 3). Hard must
    // map to 3 — the old Hard→2 made every Hard press a lapse (identical to
    // Again: lapses += 1, item into Relearning).
    let grade = match review_rating {
        ReviewRating::Again => 0,
        ReviewRating::Hard => 3,  // pass with serious difficulty (grade-R 0.90)
        ReviewRating::Good => 4,  // pass after hesitation (grade-R 0.95)
        ReviewRating::Easy => 5,  // perfect recall (grade-R 0.99)
    };

    let mut state: SM18State = item
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

    let result = SM18Algorithm::review_default(&mut state, grade, elapsed_days);

    let interval_seconds = (result.new_interval * 86400.0).round().max(60.0) as i64;
    item.due_date = now + Duration::seconds(interval_seconds);
    item.interval = result.new_interval;
    item.review_count += 1;
    item.last_review_date = Some(now);
    item.date_modified = now;
    item.algorithm_state = Some(serde_json::to_string(&state)?);
    item.memory_state = Some(MemoryState {
        stability: state.stability,
        difficulty: state.difficulty * 10.0, // SM-18 D is [0,1], scale to [0,10] for display
    });

    // SM-18 failure = grade < 3
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

fn parse_sm20_state(item: &LearningItem) -> SM20State {
    item.algorithm_state
        .as_deref()
        .and_then(|state| serde_json::from_str::<SM20State>(state).ok())
        .unwrap_or_else(|| {
            let stability = item
                .memory_state
                .as_ref()
                .map(|ms| ms.stability)
                .unwrap_or(1.0)
                .max(1.0);
            // Coerce the stale/foreign memory_state difficulty into SM-20's [0,1]
            // range. D=0.0 is out-of-distribution for the M3 matrix: the d_index=1
            // bucket collapses the pass-branch interval below the fail-branch,
            // producing an inverted preview (fail>pass) for imported .apkg cards
            // whose FSRS memory_state.difficulty is zeroed on import. Fall back to
            // the SM-20 default (0.3) whenever the stored value is not a sane,
            // interior difficulty.
            let difficulty = item
                .memory_state
                .as_ref()
                .map(|ms| ms.difficulty)
                .unwrap_or(0.3)
                .clamp(0.0, 1.0);
            let difficulty = if (0.05..=0.95).contains(&difficulty) {
                difficulty
            } else {
                SM20State::default().difficulty
            };
            #[allow(deprecated)]
            let default = SM20State {
                stability,
                difficulty,
                repetition: item.review_count.max(0) as u32,
                lapses: item.lapses.max(0) as u32,
                interval: item.interval.max(1.0),
                retrov: difficulty,
                // Initialize M1/M2/M3 sub-states from the item's actual DSR data
                // so the ensemble produces correct intervals for imported items
                // that don't have persisted SM-20 state yet.
                m1_state: crate::algorithms::sm20::model1::M1ItemState {
                    last_review_day: -1,
                    previous_interval: item.interval.max(1.0) as i32,
                    repetitions: item.review_count.max(0) as u32,
                    lapses: item.lapses.max(0) as u32,
                },
                m2_state: crate::algorithms::sm20::model2::M2ItemState {
                    last_review_day: -1,
                    previous_interval: item.interval.max(1.0) as i32,
                    repetitions: item.review_count.max(0) as u32,
                    lapses: item.lapses.max(0) as u32,
                    a_factor: 3.0,
                    u_factor: 1.0,
                },
                m3_state: crate::algorithms::sm20::model3::M3ItemState {
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

async fn apply_sm20_review(
    item: &mut LearningItem,
    review_rating: ReviewRating,
    native_grade: Option<i32>,
    now: chrono::DateTime<Utc>,
    repo: &Repository,
) -> Result<()> {
    use crate::algorithms::sm20::{SM20CollectionState, DEFAULT_FI};

    // Native SM-20 grade (0-5) when the UI offers the native scale; otherwise
    // map the 4-button rating (Again→0, Hard→3, Good→4, Easy→5).
    let grade = native_grade
        .map(|g| g.clamp(0, 5))
        .unwrap_or_else(|| sm20::rating_to_grade(review_rating as i32));

    let state = parse_sm20_state(item);
    let elapsed_days = item
        .last_review_date
        .map(|lr| (now - lr).num_seconds() as f64 / 86400.0)
        .unwrap_or(0.0)
        .max(0.0);

    // Load collection-wide state (M2 optimizer + M3 matrices).
    // On first run, these default to fresh/empty — matching a new SuperMemo collection.
    let mut collection = SM20CollectionState {
        m2_optimizer: match repo.get_sm20_m2_optimizer().await? {
            Some(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| {
                crate::algorithms::sm20::model2::ClassicM2Optimizer::fresh()
            }),
            None => crate::algorithms::sm20::model2::ClassicM2Optimizer::fresh(),
        },
        m3_matrices: repo.get_sm20_m3_matrices().await?
            .unwrap_or_default(),
    };

    let today = now.timestamp() as i32 / 86400;
    let mut rng = rand::rngs::StdRng::from_entropy();
    let fi = DEFAULT_FI; // 10% forgetting index → 90% retention

    let response = sm20::review(
        &state,
        grade,
        elapsed_days,
        fi,
        &mut collection,
        today,
        true,    // commit — mutate M2/M3 state
        true,    // disperse — stochastic day-spread (production behavior)
        &mut rng,
    );

    // Persist collection-wide state (M2 optimizer + M3 matrices).
    if let Ok(m2_bytes) = serde_json::to_vec(&collection.m2_optimizer) {
        let _ = repo.save_sm20_m2_optimizer(&m2_bytes).await;
    }
    let _ = repo.save_sm20_m3_matrices(&collection.m3_matrices).await;

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

    // Grades 0-2 are fails on the SM-20 scale → the item lapses into relearning.
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

    Ok(())
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
            crate::error::IncrementumError::NotFound(format!("Learning item {}", request.item_id))
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
    item.date_modified = Utc::now();

    repo.update_learning_item(&item).await?;
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

/// Calculate FSRS parameters for preview (show user what will happen with each rating)
#[tauri::command]
pub async fn preview_review_intervals(
    item_id: String,
    algorithm: Option<String>,
    repo: State<'_, Repository>,
) -> Result<PreviewIntervals> {
    let algo = algorithm.as_deref().unwrap_or("fsrs");

    if algo == "sm20" {
        let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
            crate::error::IncrementumError::NotFound(format!("Learning item {}", item_id))
        })?;
        let now = Utc::now();
        let elapsed_days = item
            .last_review_date
            .map(|lr| (now - lr).num_seconds() as f64 / 86400.0)
            .unwrap_or(0.0)
            .max(0.0);
        let state = parse_sm20_state(&item);

        // Load collection state for preview (scratch mode — no mutation)
        let collection = crate::algorithms::sm20::SM20CollectionState {
            m2_optimizer: match repo.get_sm20_m2_optimizer().await? {
                Some(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| {
                    crate::algorithms::sm20::model2::ClassicM2Optimizer::fresh()
                }),
                None => crate::algorithms::sm20::model2::ClassicM2Optimizer::fresh(),
            },
            m3_matrices: repo.get_sm20_m3_matrices().await?.unwrap_or_default(),
        };
        let today = now.timestamp() as i32 / 86400;
        // Fixed seed: previews must be reproducible across fetches. The rng is
        // only consumed by M2's probabilistic tail-fix during scratch replay
        // (finalization is deterministic in preview) — mirrors the reference
        // implementation's seeded default.
        let mut rng = rand::rngs::StdRng::seed_from_u64(0);
        let grades = sm20::preview_grades(
            &state, elapsed_days, crate::algorithms::sm20::DEFAULT_FI,
            &collection, today, &mut rng,
        );

        return Ok(PreviewIntervals {
            again: grades[sm20::rating_to_grade(1) as usize],
            hard: grades[sm20::rating_to_grade(2) as usize],
            good: grades[sm20::rating_to_grade(3) as usize],
            easy: grades[sm20::rating_to_grade(4) as usize],
            // Native 0-5 grade previews — lets the UI render SM-20's own scale.
            grade_intervals: Some(grades.to_vec()),
        });
    }

    if algo == "sm18" {
        let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
            crate::error::IncrementumError::NotFound(format!("Learning item {}", item_id))
        })?;

        // Use the SAME engine and state source as apply_sm18_review so the
        // transparency panel shows what a review would actually do.
        use crate::algorithms::sm18::{SM18Algorithm, SM18State};
        let now = Utc::now();
        let elapsed_days = item
            .last_review_date
            .map(|lr| (now - lr).num_seconds() as f64 / 86400.0)
            .unwrap_or(0.0)
            .max(0.0);

        let base_state: SM18State = item
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

        // Simulate every native SM-18 grade (0-2 fail, 3-5 pass) on a scratch
        // copy of the state.
        let grade_intervals: Vec<f64> = (0..=5)
            .map(|grade| {
                let mut scratch = base_state.clone();
                let result = SM18Algorithm::review_default(&mut scratch, grade, elapsed_days);
                normalize(result.new_interval)
            })
            .collect();

        // 4-button fields use the same rating→grade mapping as apply_sm18_review
        // (Again→0, Hard→3, Good→4, Easy→5).
        return Ok(PreviewIntervals {
            again: grade_intervals[0],
            hard: grade_intervals[3],
            good: grade_intervals[4],
            easy: grade_intervals[5],
            grade_intervals: Some(grade_intervals),
        });
    }

    let item = repo.get_learning_item(&item_id).await?.ok_or_else(|| {
        crate::error::IncrementumError::NotFound(format!("Learning item {}", item_id))
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
    /// algorithms with a native grade scale (currently SM-20).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grade_intervals: Option<Vec<f64>>,
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
    .map_err(|e| crate::error::IncrementumError::Database(e))?;

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
                  new_due_date, new_interval, new_ease_factor, timestamp
           FROM review_results"#,
    )
    .fetch_all(repo.pool())
    .await
    .map_err(|e| crate::error::IncrementumError::Database(e))?;

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
                      new_due_date, new_interval, new_ease_factor, timestamp
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
            .map_err(crate::error::IncrementumError::Database)?;

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
    .map_err(|e| crate::error::IncrementumError::Database(e))?;

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
        for name in &["fsrs", "sm2", "sm5", "sm8", "sm15", "sm18", "sm20"] {
            let algo = AlgorithmType::from_str_lossy(name);
            assert_eq!(algo.as_str(), *name);
        }
    }

    #[test]
    fn test_algorithm_type_unknown_defaults_to_fsrs() {
        let algo = AlgorithmType::from_str_lossy("unknown_algo");
        assert_eq!(algo.as_str(), "fsrs");
    }

    /// An imported .apkg card lands with a zeroed FSRS memory_state
    /// (`stability=0, difficulty=0`). When the user's active algorithm is
    /// SM-20, `parse_sm20_state` must NOT pass that degenerate difficulty
    /// through to the ensemble: D=0.0 maps to the M3 matrix's edge bucket,
    /// whose trained data collapses the pass-branch interval below the
    /// fail-branch (inverted preview: fail > pass). The fallback must coerce
    /// out-of-range difficulties to the SM-20 default.
    #[test]
    fn parse_sm20_state_coerces_degenerate_difficulty() {
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
            memory_state: Some(MemoryState { stability: 0.0, difficulty: 0.0 }),
            algorithm_type: "fsrs".into(),
            algorithm_state: None, // no persisted SM-20 state → fallback branch
            updated_at: None,
        };

        // D=0.0 must be coerced away from the degenerate edge bucket.
        let state = parse_sm20_state(&item);
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
        item.memory_state = Some(MemoryState { stability: 5.0, difficulty: 0.4 });
        let state = parse_sm20_state(&item);
        assert!((state.difficulty - 0.4).abs() < 1e-9);
        assert!((state.stability - 5.0).abs() < 1e-9);

        // D=1.0 (the other edge) is also coerced.
        item.memory_state = Some(MemoryState { stability: 3.0, difficulty: 1.0 });
        let state = parse_sm20_state(&item);
        assert!(
            (0.05..=0.95).contains(&state.difficulty),
            "degenerate D=1.0 should be coerced, got {}",
            state.difficulty
        );
    }
}
