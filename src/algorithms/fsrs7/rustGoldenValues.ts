/**
 * Golden values transcribed from `vendor/fsrs-rs-fsrs7/src/inference.rs` tests.
 * Use these as the canonical Rust reference when Rust cannot be invoked in Vitest.
 */
import type { Fsrs7MemoryState } from "./types";

export const RUST_DEFAULT_PARAMETERS = [
  0.1104, 2.2395, 3.9221, 11.7841, 6.1686, 0.6457, 3.6807, 1.9795, 0.0, 1.3826, 0.7024, 0.5999,
  0.8146, 0.6398, 1.0, 1.3207, 0.6707, 3.8668, 0.4416, 0.0934, 1.8631, 0.6162, 1.0869, 0.1567,
  0.0801, 0.2421, 0.9464, 0.1433, 0.7145, 0.0, 0.5667, 0.3734, 0.5333, 0.3048,
] as const;

/** `test_memory_state_fsrs7` — sequence [1,3,3,3,3,3] with intervals [0,0,1,3,8,21]. */
export const RUST_MEMORY_STATE_FSRS7_SEQUENCE: Fsrs7MemoryState = {
  stability: 25.985723,
  difficulty: 5.877549,
  stability_fast: 25.985723 * 0.8,
};

/** Upstream `test_next_states` uses the 19-weight `PARAMETERS` fixture, not `DEFAULT_PARAMETERS`. */
export const RUST_LEGACY_19_PARAM_NEXT_STATES_NOTE =
  "See vendor/fsrs-rs-fsrs7/src/inference.rs::PARAMETERS for the legacy 19-weight fixture.";

/** `test_next_interval_fsrs7` rounded day intervals for stability=1.0. */
export const RUST_NEXT_INTERVAL_FSRS7_STABILITY_ONE = [
  36500, 36500, 36500, 12813, 843, 92, 13, 2, 1, 1,
] as const;

/** `interval_solver_hits_target` state from `model_v7.rs`. */
export const RUST_INTERVAL_SOLVER_STATE: Fsrs7MemoryState = {
  stability: 10.0,
  difficulty: 5.0,
  stability_fast: 8.0,
};

export function approxEqual(actual: number, expected: number, tolerance = 1e-4): boolean {
  return Math.abs(actual - expected) <= tolerance;
}
