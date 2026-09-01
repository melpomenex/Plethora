//! FSRS-7 integration wrapper for Plethora.
//!
//! Production scheduling always uses the vendored FSRS-7 default parameter vector
//! (34 weights from `inference_v7::DEFAULT_PARAMETERS`).

use crate::error::Result;
use crate::models::MemoryState as PlethoraMemoryState;
use fsrs::{MemoryState as FsrsMemoryState, NextStates, FSRS, DEFAULT_PARAMETERS};

pub const FSRS7_PARAM_LEN: usize = 34;

/// Returns true when `params` is a full FSRS-7 weight vector.
pub fn is_fsrs7_parameters(params: &[f32]) -> bool {
    params.len() == FSRS7_PARAM_LEN
}

/// Construct an FSRS-7 engine with the stock 34-parameter default vector.
pub fn create_fsrs7() -> Result<FSRS> {
    FSRS::new(&DEFAULT_PARAMETERS).map_err(Into::into)
}

/// Construct an FSRS-7 engine from caller weights, falling back to defaults when
/// the slice is missing or not exactly 34 parameters (e.g. legacy 17/19/21 vectors).
pub fn create_fsrs7_with_weights(weights: Option<&[f32]>) -> Result<FSRS> {
    match weights {
        Some(w) if is_fsrs7_parameters(w) => FSRS::new(w).map_err(Into::into),
        _ => create_fsrs7(),
    }
}

pub fn to_fsrs_memory_state(ms: &PlethoraMemoryState) -> Option<FsrsMemoryState> {
    if ms.stability <= 0.0 || ms.difficulty <= 0.0 {
        return None;
    }
    Some(FsrsMemoryState {
        stability: ms.stability as f32,
        difficulty: ms.difficulty as f32,
        stability_fast: ms.stability_fast.unwrap_or(0.0) as f32,
    })
}

pub fn from_fsrs_memory_state(ms: &FsrsMemoryState) -> PlethoraMemoryState {
    PlethoraMemoryState {
        stability: ms.stability as f64,
        difficulty: ms.difficulty as f64,
        stability_fast: Some(ms.stability_fast as f64),
    }
}

/// Like `FSRS::next_states`, but keeps fractional elapsed days (FSRS-7 behavior).
pub fn next_states_fractional(
    fsrs: &FSRS,
    current_memory_state: Option<&PlethoraMemoryState>,
    desired_retention: f32,
    elapsed_days: f32,
) -> Result<NextStates> {
    let fsrs_state = current_memory_state.and_then(to_fsrs_memory_state);
    fsrs
        .next_states_with_elapsed_days(fsrs_state, desired_retention, elapsed_days)
        .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fsrs::FSRS6_DEFAULT_PARAMETERS;

    fn final_memory_state_for_sequence(w: &[f32]) -> FsrsMemoryState {
        let desired_retention = 0.9_f32;
        let fsrs = FSRS::new(w).unwrap();
        let ratings: [u32; 6] = [1, 3, 3, 3, 3, 3];
        let intervals: [u32; 6] = [0, 0, 1, 3, 8, 21];

        let mut memory_state = None;
        for (&rating, &interval) in ratings.iter().zip(intervals.iter()) {
            let state = fsrs
                .next_states(memory_state, desired_retention, interval)
                .unwrap();
            memory_state = match rating {
                1 => Some(state.again.memory),
                2 => Some(state.hard.memory),
                3 => Some(state.good.memory),
                4 => Some(state.easy.memory),
                _ => None,
            };
        }

        memory_state.unwrap()
    }

    #[test]
    fn create_fsrs7_uses_34_parameters_not_fsrs6() {
        assert_eq!(DEFAULT_PARAMETERS.len(), FSRS7_PARAM_LEN);
        assert_ne!(FSRS7_PARAM_LEN, FSRS6_DEFAULT_PARAMETERS.len());
        create_fsrs7().expect("FSRS-7 construction must succeed");
    }

    #[test]
    fn is_fsrs7_parameters_rejects_legacy_lengths() {
        assert!(is_fsrs7_parameters(&DEFAULT_PARAMETERS));
        assert!(!is_fsrs7_parameters(&FSRS6_DEFAULT_PARAMETERS));
        assert!(!is_fsrs7_parameters(&[1.0; 17]));
        assert!(!is_fsrs7_parameters(&[1.0; 19]));
        assert!(!is_fsrs7_parameters(&[1.0; 21]));
    }

    #[test]
    fn test_memory_state_fsrs7_matches_upstream_golden_values() {
        let memory_state = final_memory_state_for_sequence(&DEFAULT_PARAMETERS);
        assert!((memory_state.stability - 25.985723).abs() < 1e-4);
        assert!((memory_state.difficulty - 5.877549).abs() < 1e-4);
    }

    #[test]
    fn fractional_elapsed_days_changes_fsrs7_output() {
        let fsrs = create_fsrs7().unwrap();
        let state = FsrsMemoryState {
            stability: 10.0,
            difficulty: 5.0,
            stability_fast: 8.0,
        };
        let plethora_state = from_fsrs_memory_state(&state);

        let whole_day = next_states_fractional(&fsrs, Some(&plethora_state), 0.9, 0.0).unwrap();
        let half_day = next_states_fractional(&fsrs, Some(&plethora_state), 0.9, 0.5).unwrap();

        assert_ne!(
            whole_day.good.memory.stability,
            half_day.good.memory.stability
        );
    }

    #[test]
    fn create_fsrs7_with_weights_falls_back_for_legacy_vectors() {
        let from_legacy = create_fsrs7_with_weights(Some(&FSRS6_DEFAULT_PARAMETERS)).unwrap();
        let from_defaults = create_fsrs7().unwrap();
        let state = FsrsMemoryState {
            stability: 10.0,
            difficulty: 5.0,
            stability_fast: 8.0,
        };
        let legacy_out = from_legacy
            .next_states_with_elapsed_days(Some(state), 0.9, 1.0)
            .unwrap();
        let default_out = from_defaults
            .next_states_with_elapsed_days(Some(state), 0.9, 1.0)
            .unwrap();
        assert_eq!(
            legacy_out.good.memory.stability,
            default_out.good.memory.stability
        );
    }

    #[test]
    fn memory_state_round_trip_preserves_stability_fast() {
        let fsrs_state = FsrsMemoryState {
            stability: 12.5,
            difficulty: 4.2,
            stability_fast: 9.1,
        };
        let plethora = from_fsrs_memory_state(&fsrs_state);
        let back = to_fsrs_memory_state(&plethora).unwrap();
        assert_eq!(back.stability, fsrs_state.stability);
        assert_eq!(back.difficulty, fsrs_state.difficulty);
        assert_eq!(back.stability_fast, fsrs_state.stability_fast);
    }
}
