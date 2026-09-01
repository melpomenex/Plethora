pub static DEFAULT_PARAMETERS: [f32; 34] = [
    0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0.0, 1.3826, 0.7024, 0.5999,
    0.8146, 0.6398, 1.0, 1.3207, 0.6707, 3.8668, 0.4416, 0.0934, 1.8631, 0.6162, 1.0869, 0.1567,
    0.0801, 0.2421, 0.9464, 0.1433, 0.7145, 0.0, 0.5667, 0.3734, 0.5333, 0.3048,
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Result;
    use crate::inference::MemoryState;
    use crate::model::FSRS;

    #[test]
    fn test_fsrs7_retrievability_does_not_depend_on_w20() {
        let state = MemoryState {
            stability: 12.0,
            difficulty: 5.0,
            stability_fast: 9.6,
        };
        let mut params_a = DEFAULT_PARAMETERS.to_vec();
        let mut params_b = DEFAULT_PARAMETERS.to_vec();
        params_a[20] = 0.001;
        params_b[20] = 5.0;
        let fsrs_a = FSRS::new(&params_a).unwrap();
        let fsrs_b = FSRS::new(&params_b).unwrap();
        let r_a = fsrs_a.current_retrievability(state, 10.0);
        let r_b = fsrs_b.current_retrievability(state, 10.0);
        assert!((r_a - r_b).abs() < 1e-7);
    }

    #[test]
    fn test_memory_from_sm2_fsrs7_bridge_is_finite() -> Result<()> {
        let params = DEFAULT_PARAMETERS.to_vec();
        let fsrs = FSRS::new(&params)?;
        let state = fsrs.memory_state_from_sm2(2.5, 100.0, 0.9)?;
        assert!(state.stability.is_finite());
        assert!(state.stability > 0.0);
        assert!(state.difficulty.is_finite());
        assert!((state.difficulty - 5.0).abs() <= f32::EPSILON);
        Ok(())
    }

    #[test]
    fn test_s90_fsrs7_hits_90_retrievability() {
        let fsrs = FSRS::new(&DEFAULT_PARAMETERS).unwrap();
        let state = MemoryState {
            stability: 10.0,
            difficulty: 5.0,
            stability_fast: 8.0,
        };

        let s90 = fsrs.s90(state);
        let r = fsrs.current_retrievability(state, s90);
        assert!((r - 0.9).abs() <= 1e-3);
    }
}
