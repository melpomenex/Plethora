//! Classic spaced repetition algorithms implementation
//!
//! Implements classic factor-based and interval progression algorithms:
//! - Classic (Ease factor algorithm with repetition growth)
//! - Classic 5 (Performance modifier factor algorithm)
//! - Classic 8 (Optimal interval sequence algorithm)
//! - Classic 15 (Stability and difficulty interval algorithm)

use crate::models::ReviewRating;
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

/// Classic algorithm state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassicState {
    /// Ease factor (minimum 1.3)
    pub ease_factor: f64,
    /// Interval in days
    pub interval: f64,
    /// Number of successful repetitions
    pub repetitions: u32,
}

pub type Classic2State = ClassicState;
pub type SM2State = ClassicState;

impl Default for ClassicState {
    fn default() -> Self {
        Self {
            ease_factor: 2.5,
            interval: 0.0,
            repetitions: 0,
        }
    }
}

/// Classic algorithm
pub struct ClassicScheduler {
    min_ease_factor: f64,
}

pub type Classic2Algorithm = ClassicScheduler;
pub type SM2Algorithm = ClassicScheduler;

impl Default for ClassicScheduler {
    fn default() -> Self {
        Self::new()
    }
}

impl ClassicScheduler {
    pub fn new() -> Self {
        Self {
            min_ease_factor: 1.3,
        }
    }

    /// Calculate next state after review
    pub fn next_state(&self, state: &ClassicState, rating: ReviewRating) -> ClassicState {
        // Map rating to 0-5 quality
        let quality = match rating {
            ReviewRating::Again => 0, // Complete blackout
            ReviewRating::Hard => 3,  // Hard with correct response
            ReviewRating::Good => 4,  // Good response
            ReviewRating::Easy => 5,  // Perfect response
        };

        let mut new_state = state.clone();

        if quality < 3 {
            // Failed review - reset
            new_state.repetitions = 0;
            new_state.interval = 0.0;
        } else {
            // Successful review
            new_state.repetitions += 1;

            // Calculate interval based on repetition number
            new_state.interval = match new_state.repetitions {
                1 => 1.0,
                2 => 6.0,
                _ => state.interval * state.ease_factor,
            };

            // Update ease factor
            // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
            let ef_update = 0.1 - (5.0 - quality as f64) * (0.08 + (5.0 - quality as f64) * 0.02);
            new_state.ease_factor = (state.ease_factor + ef_update).max(self.min_ease_factor);
        }

        new_state
    }

    /// Get next interval in days
    pub fn next_interval(&self, state: &ClassicState) -> i32 {
        state.interval.max(0.0).round() as i32
    }

    /// Calculate next review date
    pub fn next_review_date(&self, state: &ClassicState) -> chrono::DateTime<Utc> {
        let days = self.next_interval(state) as i64;
        Utc::now() + Duration::days(days)
    }
}

/// Classic 5 algorithm state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Classic5State {
    /// Ease factor
    pub ease_factor: f64,
    /// Current interval
    pub interval: f64,
    /// Number of repetitions
    pub repetitions: u32,
    /// Modified factor
    pub modifier: f64,
}

pub type SM5State = Classic5State;

impl Default for Classic5State {
    fn default() -> Self {
        Self {
            ease_factor: 2.5,
            interval: 0.0,
            repetitions: 0,
            modifier: 1.0,
        }
    }
}

/// Classic 5 algorithm
pub struct Classic5Scheduler {
    min_ease_factor: f64,
}

pub type SM5Algorithm = Classic5Scheduler;

impl Default for Classic5Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

impl Classic5Scheduler {
    pub fn new() -> Self {
        Self {
            min_ease_factor: 1.3,
        }
    }

    pub fn next_state(&self, state: &Classic5State, rating: ReviewRating) -> Classic5State {
        let quality = match rating {
            ReviewRating::Again => 0,
            ReviewRating::Hard => 3,
            ReviewRating::Good => 4,
            ReviewRating::Easy => 5,
        };

        let mut new_state = state.clone();

        if quality < 3 {
            new_state.repetitions = 0;
            new_state.interval = 0.0;
        } else {
            new_state.repetitions += 1;

            new_state.interval = match new_state.repetitions {
                1 => 1.0 * state.modifier,
                2 => 6.0 * state.modifier,
                _ => state.interval * state.ease_factor * state.modifier,
            };

            let ef_update = 0.1 - (5.0 - quality as f64) * (0.08 + (5.0 - quality as f64) * 0.02);
            new_state.ease_factor = (state.ease_factor + ef_update).max(self.min_ease_factor);

            new_state.modifier = match quality {
                5 => state.modifier * 1.1, // Easy - increase future intervals
                4 => state.modifier,
                3 => state.modifier * 0.9, // Hard - decrease future intervals
                _ => state.modifier * 0.8,
            };

            new_state.modifier = new_state.modifier.clamp(0.5, 2.0);
        }

        new_state
    }

    pub fn next_interval(&self, state: &Classic5State) -> i32 {
        state.interval.max(0.0).round() as i32
    }
}

/// Classic 8 algorithm with optimal intervals
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Classic8State {
    pub ease_factor: f64,
    pub interval: f64,
    pub repetitions: u32,
    /// Lapses count
    pub lapses: u32,
}

pub type SM8State = Classic8State;

impl Default for Classic8State {
    fn default() -> Self {
        Self {
            ease_factor: 2.5,
            interval: 0.0,
            repetitions: 0,
            lapses: 0,
        }
    }
}

/// Classic 8 algorithm
pub struct Classic8Scheduler {
    min_ease_factor: f64,
}

pub type SM8Algorithm = Classic8Scheduler;

impl Default for Classic8Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

impl Classic8Scheduler {
    pub fn new() -> Self {
        Self {
            min_ease_factor: 1.3,
        }
    }

    pub fn next_state(&self, state: &Classic8State, rating: ReviewRating) -> Classic8State {
        let quality = match rating {
            ReviewRating::Again => 0,
            ReviewRating::Hard => 3,
            ReviewRating::Good => 4,
            ReviewRating::Easy => 5,
        };

        let mut new_state = state.clone();

        if quality < 3 {
            new_state.repetitions = 0;
            new_state.interval = 0.0;
            new_state.lapses += 1;
            new_state.ease_factor = (state.ease_factor - 0.2).max(self.min_ease_factor);
        } else {
            new_state.repetitions += 1;

            let optimal_intervals = [1.0, 2.0, 4.0, 7.0, 12.0, 20.0, 34.0, 57.0, 95.0, 158.0];
            let rep_index = (new_state.repetitions as usize).saturating_sub(1);

            new_state.interval = if rep_index < optimal_intervals.len() {
                optimal_intervals[rep_index] * state.ease_factor
            } else {
                state.interval * state.ease_factor
            };

            let ef_update = 0.1 - (5.0 - quality as f64) * (0.08 + (5.0 - quality as f64) * 0.02);
            new_state.ease_factor = (state.ease_factor + ef_update).max(self.min_ease_factor);
        }

        new_state
    }

    pub fn next_interval(&self, state: &Classic8State) -> i32 {
        state.interval.max(0.0).round() as i32
    }
}

/// Classic 15 algorithm
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Classic15State {
    pub stability: f64,
    pub difficulty: f64,
}

pub type SM15State = Classic15State;

impl Default for Classic15State {
    fn default() -> Self {
        Self {
            stability: 0.0,
            difficulty: 5.0,
        }
    }
}

/// Classic 15 algorithm
pub struct Classic15Scheduler {
    request_retention: f64,
}

pub type SM15Algorithm = Classic15Scheduler;

impl Default for Classic15Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

impl Classic15Scheduler {
    pub fn new() -> Self {
        Self {
            request_retention: 0.9,
        }
    }

    pub fn next_state(&self, state: &Classic15State, rating: ReviewRating) -> Classic15State {
        let stability_factor = match rating {
            ReviewRating::Again => 0.5,
            ReviewRating::Hard => 0.8,
            ReviewRating::Good => 1.2,
            ReviewRating::Easy => 1.5,
        };

        let difficulty_factor = match rating {
            ReviewRating::Again => 0.2,
            ReviewRating::Hard => 0.1,
            ReviewRating::Good => 0.0,
            ReviewRating::Easy => -0.1,
        };

        let new_stability = if state.stability == 0.0 {
            match rating {
                ReviewRating::Again => 0.5,
                ReviewRating::Hard => 1.0,
                ReviewRating::Good => 2.0,
                ReviewRating::Easy => 4.0,
            }
        } else {
            state.stability * stability_factor
        };

        let new_difficulty = (state.difficulty + difficulty_factor).clamp(1.0, 10.0);

        Classic15State {
            stability: new_stability.max(0.1),
            difficulty: new_difficulty,
        }
    }

    pub fn next_interval(&self, state: &Classic15State) -> i32 {
        let stability_ratio = (self.request_retention.ln() / 0.9_f64.ln()).abs();
        (state.stability * stability_ratio).round() as i32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classic_basic() {
        let algorithm = ClassicScheduler::new();
        let state = ClassicState::default();

        let next = algorithm.next_state(&state, ReviewRating::Good);
        assert_eq!(next.repetitions, 1);
        assert_eq!(next.interval, 1.0);

        let next2 = algorithm.next_state(&next, ReviewRating::Good);
        assert_eq!(next2.repetitions, 2);
        assert_eq!(next2.interval, 6.0);
    }

    #[test]
    fn test_classic_failure() {
        let algorithm = ClassicScheduler::new();
        let state = ClassicState {
            ease_factor: 2.5,
            interval: 10.0,
            repetitions: 5,
        };

        let next = algorithm.next_state(&state, ReviewRating::Again);
        assert_eq!(next.repetitions, 0);
        assert_eq!(next.interval, 0.0);
    }

    #[test]
    fn test_classic5_modifier() {
        let algorithm = Classic5Scheduler::new();
        let state = Classic5State::default();

        let next = algorithm.next_state(&state, ReviewRating::Easy);
        assert!(next.modifier > 1.0);

        let next2 = algorithm.next_state(&next, ReviewRating::Hard);
        assert!(next2.modifier < next.modifier);
    }

    #[test]
    fn test_classic8_optimal() {
        let algorithm = Classic8Scheduler::new();
        let state = Classic8State::default();

        let next = algorithm.next_state(&state, ReviewRating::Good);
        assert_eq!(next.repetitions, 1);
        assert!(next.interval > 0.0);
    }

    #[test]
    fn test_classic15_initial() {
        let algorithm = Classic15Scheduler::new();
        let state = Classic15State::default();

        let next = algorithm.next_state(&state, ReviewRating::Good);
        assert!(next.stability > 0.0);
        assert!(next.difficulty > 0.0);
    }
}
