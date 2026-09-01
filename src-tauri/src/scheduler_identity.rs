//! Legacy scheduler identifier normalization.
//!
//! This module is the **only** place legacy algorithm type strings should
//! appear. All other code uses canonical [`crate::algorithms::AlgorithmType`]
//! ids via [`normalize_algorithm_type`].
//!
//! ## Compatibility table
//!
//! | Legacy input              | Canonical id   |
//! |---------------------------|----------------|
//! | `sm18`                    | `adaptive`     |
//! | `sm20`                    | `precision`    |
//! | `sm2`, `classic_2`        | `classic`      |
//! | `sm5`, `classic5`         | `classic_5`    |
//! | `sm8`, `classic8`         | `classic_8`    |
//! | `sm15`, `classic15`       | `classic_15`   |
//! | `fsrs`                    | `fsrs`         |
//! | `adaptive`, `precision`, …| (identity)     |
//! | unknown                   | `fsrs`         |

/// Production scheduling always uses FSRS-7 (`fsrs`). Legacy scheduler ids are
/// normalized here so stale settings cannot reactivate hidden algorithms.
pub fn normalize_to_production_scheduler(s: &str) -> &'static str {
    "fsrs"
}

/// Map a persisted or user-supplied algorithm id to its canonical string form.
pub fn normalize_algorithm_type(s: &str) -> &'static str {
    match s.to_lowercase().as_str() {
        "fsrs" => "fsrs",
        "adaptive" | "sm18" => "adaptive",
        "precision" | "sm20" => "precision",
        "classic" | "classic_2" | "sm2" => "classic",
        "classic_5" | "classic5" | "sm5" => "classic_5",
        "classic_8" | "classic8" | "sm8" => "classic_8",
        "classic_15" | "classic15" | "sm15" => "classic_15",
        _ => "fsrs",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_algorithm_ids_normalize_to_canonical() {
        for (legacy, canonical) in [
            ("sm18", "adaptive"),
            ("sm20", "precision"),
            ("sm2", "classic"),
            ("sm5", "classic_5"),
            ("sm8", "classic_8"),
            ("sm15", "classic_15"),
            ("fsrs", "fsrs"),
            ("precision", "precision"),
        ] {
            assert_eq!(normalize_algorithm_type(legacy), canonical);
        }
    }
}
