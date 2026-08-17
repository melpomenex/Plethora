//! Scheduling algorithms implementation
//!
//! This module provides different spaced repetition algorithms:
//! - FSRS-6 (Free Spaced Repetition Scheduler)
//! - SM-2, SM-5, SM-8, SM-15 (SuperMemo algorithms)
//! - SM-18 (Latest SuperMemo algorithm)
//! - SM-20 (native Rust implementation, mirrored in TypeScript)
//! - Queue selector with weighted randomization
//! - Document scheduler for incremental reading

use crate::models::{ItemState, LearningItem, ReviewRating};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

pub mod document_scheduler;
pub mod engaging_scheduler;
pub mod incremental_scheduler;
pub mod neural_queue;
pub mod optimizer;
pub mod postpone;
pub mod priority_queue;
pub mod queue_selector;
pub mod relevance;
pub mod sm18;
pub mod sm20;
pub mod supermemo;

// Re-exports
pub use document_scheduler::{DocumentScheduler, DocumentSchedulerParams};
pub use engaging_scheduler::{
    EngagementPreferences, EngagingScheduleResult, EngagingScheduler, ItemEngagementMeta,
};
pub use incremental_scheduler::{IncrementalScheduler, IncrementalSchedulerParams};
pub use optimizer::calculate_review_statistics;
pub use queue_selector::QueueSelector;
pub use sm18::{SM18Algorithm, SM18ReviewResult, SM18State};
pub use sm20::{SM20PreviewIntervals, SM20ReviewResult, SM20State};

/// Supported spaced repetition algorithms
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AlgorithmType {
    #[default]
    Fsrs,
    Sm2,
    Sm5,
    Sm8,
    Sm15,
    Sm18,
    Sm20,
}

impl AlgorithmType {
    /// Parse from string, defaulting to Fsrs for unknown values
    pub fn from_str_lossy(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "fsrs" => AlgorithmType::Fsrs,
            "sm2" => AlgorithmType::Sm2,
            "sm5" => AlgorithmType::Sm5,
            "sm8" => AlgorithmType::Sm8,
            "sm15" => AlgorithmType::Sm15,
            "sm18" => AlgorithmType::Sm18,
            "sm20" => AlgorithmType::Sm20,
            _ => AlgorithmType::Fsrs,
        }
    }

    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            AlgorithmType::Fsrs => "fsrs",
            AlgorithmType::Sm2 => "sm2",
            AlgorithmType::Sm5 => "sm5",
            AlgorithmType::Sm8 => "sm8",
            AlgorithmType::Sm15 => "sm15",
            AlgorithmType::Sm18 => "sm18",
            AlgorithmType::Sm20 => "sm20",
        }
    }
}

impl std::fmt::Display for AlgorithmType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[cfg(test)]
mod tests;

/// SM-2 algorithm parameters
#[derive(Debug, Clone)]
pub struct SM2Params {
    /// Ease factor (minimum 1.3)
    pub ease_factor: f64,
    /// Interval in days
    pub interval: f64,
    /// Number of repetitions
    pub repetitions: u32,
}

impl Default for SM2Params {
    fn default() -> Self {
        Self {
            ease_factor: 2.5,
            interval: 0.0,
            repetitions: 0,
        }
    }
}

impl SM2Params {
    /// Calculate next interval using SM-2 algorithm
    pub fn next_interval(&self, rating: ReviewRating) -> Self {
        let _rating_value = rating as i32;

        let mut new_params = self.clone();

        // SM-2 quality mapping: 0-2 = again, 3-4 = hard, 5 = good, 6 = easy
        // Our rating: 1 = again, 2 = hard, 3 = good, 4 = easy
        // Map to SM-2 quality:
        let sm2_quality = match rating {
            ReviewRating::Again => 0, // Complete failure
            ReviewRating::Hard => 3,  // Hard difficulty
            ReviewRating::Good => 4,  // Good response
            ReviewRating::Easy => 5,  // Perfect response
        };

        // If quality < 3, start over
        if sm2_quality < 3 {
            new_params.repetitions = 0;
            new_params.interval = 0.0;
        } else {
            new_params.repetitions += 1;

            // Calculate interval based on repetition number
            match new_params.repetitions {
                1 => new_params.interval = 1.0,
                2 => new_params.interval = 6.0,
                _ => {
                    // I(n) = I(n-1) * EF
                    new_params.interval *= new_params.ease_factor;
                }
            }

            // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
            let q = sm2_quality as f64;
            new_params.ease_factor += 0.1 - (5.0 - q) * (0.08 + (5.0 - q) * 0.02);

            // Ensure ease factor doesn't go below 1.3
            if new_params.ease_factor < 1.3 {
                new_params.ease_factor = 1.3;
            }
        }

        new_params
    }

    /// Calculate next review date
    pub fn next_review_date(&self) -> chrono::DateTime<Utc> {
        let days = self.interval.max(0.0) as i64;
        Utc::now() + Duration::days(days)
    }
}

/// Calculate priority score for queue items
pub fn calculate_priority_score(
    due_date: chrono::DateTime<Utc>,
    interval: f64,
    review_count: i32,
    difficulty: f64,
) -> f64 {
    let now = Utc::now();
    let is_due = due_date <= now;
    let days_until_due = (due_date - now).num_days();

    // Base priority from urgency
    let mut priority = if is_due {
        // Items that are due get highest priority
        // New items (interval 0) or low intervals get higher priority
        10.0 - (interval / 10.0)
    } else if days_until_due <= 1 {
        8.0
    } else if days_until_due <= 3 {
        6.0
    } else if days_until_due <= 7 {
        4.0
    } else {
        2.0
    };

    // Adjust for difficulty - harder items get slightly higher priority
    priority += difficulty * 0.1;

    // Adjust for review count - items with few reviews get higher priority
    if review_count < 3 {
        priority += 1.0;
    }

    priority.clamp(0.0, 10.0)
}

/// Derive a 1-5 priority rating from a 0-100 slider value.
///
/// This is the single source of truth for the `slider → rating` mapping so every
/// write path keeps the two fields (and the persisted `priority_score`)
/// consistent. The thresholds match the reader's `PriorityControl` preset
/// buckets (Lowest/Low/Normal/High/Highest at 10/30/50/70/90).
pub fn rating_from_slider(priority_slider: i32) -> i32 {
    let slider = priority_slider.clamp(0, 100);
    if slider >= 81 {
        5
    } else if slider >= 61 {
        4
    } else if slider >= 41 {
        3
    } else if slider >= 21 {
        2
    } else if slider > 0 {
        1
    } else {
        0
    }
}

/// Normalize a document's priority fields into a single 0-100 slider value.
///
/// The slider is the authoritative priority input. Legacy rows written before
/// the slider existed may have `priority_slider == 0` but a non-zero
/// `priority_rating`; in that case the rating is converted back to a slider
/// value so those documents keep roughly their old ordering. A document with
/// no user-set priority at all (both zero) is treated as the neutral midpoint
/// (50) rather than the floor, so un-prioritized documents are not silently
/// demoted to the bottom of the queue.
pub fn resolve_priority_slider(priority_slider: i32, priority_rating: i32) -> i32 {
    if priority_slider > 0 {
        return priority_slider.clamp(0, 100);
    }
    if priority_rating > 0 {
        // Invert rating_from_slider's buckets: 1->10, 2->30, 3->50, 4->70, 5->90.
        return match priority_rating.clamp(1, 5) {
            1 => 10,
            2 => 30,
            3 => 50,
            4 => 70,
            _ => 90,
        };
    }
    // Neither set → neutral midpoint.
    50
}

/// Calculate combined priority score for documents using rating (1-5) and slider (0-100).
pub fn calculate_document_priority_score(
    priority_rating: Option<i32>,
    priority_slider: i32,
) -> f64 {
    let slider = priority_slider.clamp(0, 100) as f64;
    let rating_value = priority_rating.unwrap_or(0);
    let rating_normalized = if (1..=4).contains(&rating_value) {
        (rating_value - 1) as f64 / 3.0 * 100.0
    } else if rating_value == 5 {
        100.0
    } else {
        0.0
    };

    ((slider + rating_normalized) / 2.0).clamp(0.0, 100.0)
}

/// Calculate FSRS-based priority for documents in the queue.
///
/// This uses FSRS `next_reading_date` as the primary factor, with stability
/// and difficulty as secondary sorting factors. The user's continuous 0-100
/// priority slider acts as a multiplier on the FSRS-calculated priority.
///
/// # Arguments
/// * `next_reading_date` - FSRS-calculated next review date (None for new documents)
/// * `stability` - FSRS stability value (None for new documents)
/// * `difficulty` - FSRS difficulty value (None for new documents)
/// * `priority_slider` - User-set continuous priority (0-100) acting as multiplier
///
/// # Returns
/// A priority score (0-10) where higher values indicate higher urgency
pub fn calculate_fsrs_document_priority(
    next_reading_date: Option<chrono::DateTime<Utc>>,
    stability: Option<f64>,
    difficulty: Option<f64>,
    priority_slider: i32,
) -> f64 {
    let now = Utc::now();

    // Calculate user priority multiplier (0.5x to 2.0x based on slider 0-100).
    // Slider 50 (neutral midpoint) ≈ 1.25x, slider 0 = 0.5x, slider 100 = 2.0x.
    // The neutral midpoint (50) corresponds to a "no user preference" document
    // and sits above 1.0x so un-prioritized documents are not buried.
    let slider = priority_slider.clamp(0, 100) as f64;
    let priority_multiplier = 0.5 + (slider / 100.0) * 1.5;

    // Base priority from FSRS scheduling
    let base_priority = match next_reading_date {
        Some(next_date) => {
            let is_due = next_date <= now;
            let days_until_due = (next_date - now).num_days();

            if is_due {
                // Overdue documents get highest priority
                // Decay priority based on days overdue (more overdue = slightly lower)
                let days_overdue = -days_until_due;
                (10.0 - (days_overdue as f64 * 0.1)).max(5.0)
            } else {
                // Future-dated documents get lower priority
                // Priority decays the further in the future
                if days_until_due <= 1 {
                    8.0
                } else if days_until_due <= 3 {
                    6.0
                } else if days_until_due <= 7 {
                    4.0
                } else if days_until_due <= 30 {
                    2.0
                } else {
                    0.5 // Very far future, lowest priority
                }
            }
        }
        None => {
            // New documents (never read) get high priority for first reading
            // They're ordered by the user-set priority slider multiplier above
            9.0
        }
    };

    // Apply user priority multiplier
    let adjusted_priority = base_priority * priority_multiplier;

    // Apply FSRS metrics as micro-adjustments (secondary sorting factors)
    let fsrs_adjustment = match (stability, difficulty) {
        (Some(stab), Some(diff)) => {
            // Lower stability = higher priority (needs more review)
            // Higher difficulty = slightly higher priority (harder items need attention)
            let stability_bonus = if stab < 5.0 {
                0.5
            } else if stab < 10.0 {
                0.2
            } else {
                0.0
            };
            let difficulty_bonus = if diff > 7.0 {
                0.3
            } else if diff > 5.0 {
                0.1
            } else {
                0.0
            };
            stability_bonus + difficulty_bonus
        }
        _ => 0.0,
    };

    // Final priority with adjustments, clamped to 0-10 range
    (adjusted_priority + fsrs_adjustment).clamp(0.0, 10.0)
}

#[derive(Clone, serde::Serialize)]
pub struct AlgorithmComparison {
    pub algorithm: String,
    pub avg_retention: f64,
    pub total_reviews: i32,
    pub avg_interval: f64,
}

/// Compare algorithm performance
pub fn compare_algorithms(items: &[LearningItem]) -> AlgorithmComparison {
    let total_reviews: i32 = items.iter().map(|i| i.review_count).sum();
    let avg_interval: f64 = if total_reviews > 0 {
        items.iter().map(|i| i.interval).sum::<f64>() / items.len() as f64
    } else {
        0.0
    };

    // Retention estimate from item state distribution: items in Review or
    // Mature states contribute full retention, Learning items contribute 0.5,
    // and Relearning items contribute 0. This is a state-weighted proxy that
    // replaces the previous hardcoded 0.85 placeholder.
    let avg_retention = if items.is_empty() {
        0.0
    } else {
        let sum: f64 = items
            .iter()
            .map(|i| match i.state {
                ItemState::Review => 1.0,
                ItemState::Learning => 0.5,
                ItemState::Relearning => 0.0,
                ItemState::New => 0.7,
            })
            .sum();
        sum / items.len() as f64
    };

    AlgorithmComparison {
        algorithm: "FSRS-6".to_string(),
        avg_retention,
        total_reviews,
        avg_interval,
    }
}
