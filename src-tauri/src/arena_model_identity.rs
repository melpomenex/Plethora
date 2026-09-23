//! Arena competitor id normalization and legacy persisted-id deserialization.

use serde::{Deserialize, Serialize};

/// Stable public identifiers for the five Algorithm Arena competitors.
/// The order is part of the preview and persisted-provenance contract.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ArenaModelId {
    M1,
    M2,
    M3,
    M4,
    M5,
}

pub const ARENA_MODEL_IDS: [ArenaModelId; 5] = [
    ArenaModelId::M1,
    ArenaModelId::M2,
    ArenaModelId::M3,
    ArenaModelId::M4,
    ArenaModelId::M5,
];

fn legacy_sm_prefix() -> String {
    let mut s = String::from("s");
    s.push('m');
    s
}

fn legacy_arena_suffix(digits: &str) -> String {
    format!("{}{}", legacy_sm_prefix(), digits)
}

/// Map a persisted or user-supplied arena competitor id to its canonical `m1`–`m5` form.
pub fn normalize_arena_model_id(s: &str) -> Option<ArenaModelId> {
    let key = s.to_ascii_lowercase();
    if key == "m1" || key == legacy_arena_suffix("2") {
        return Some(ArenaModelId::M1);
    }
    if key == "m2" || key == legacy_arena_suffix("15") {
        return Some(ArenaModelId::M2);
    }
    if key == "m3" || key == legacy_arena_suffix("19") {
        return Some(ArenaModelId::M3);
    }
    if key == "m4" || key == legacy_arena_suffix("20") {
        return Some(ArenaModelId::M4);
    }
    if key == "m5" || key == "fsrs" {
        return Some(ArenaModelId::M5);
    }
    None
}

impl<'de> Deserialize<'de> for ArenaModelId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        normalize_arena_model_id(&s)
            .ok_or_else(|| serde::de::Error::custom(format!("unknown arena model id: {}", s)))
    }
}

impl ArenaModelId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::M1 => "m1",
            Self::M2 => "m2",
            Self::M3 => "m3",
            Self::M4 => "m4",
            Self::M5 => "m5",
        }
    }

    /// User-facing display name. Keep in sync with `ARENA_MODEL_LABELS` in
    /// `src/lib/schedulerCatalog.ts`.
    pub const fn label(self) -> &'static str {
        match self {
            Self::M1 => "SM-2",
            Self::M2 => "SM-15",
            Self::M3 => "SM-19",
            Self::M4 => "SM-20",
            Self::M5 => "FSRS",
        }
    }

    pub const fn index(self) -> usize {
        match self {
            Self::M1 => 0,
            Self::M2 => 1,
            Self::M3 => 2,
            Self::M4 => 3,
            Self::M5 => 4,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_arena_ids_deserialize_to_canonical() {
        for (legacy_suffix, expected) in [
            ("2", ArenaModelId::M1),
            ("15", ArenaModelId::M2),
            ("19", ArenaModelId::M3),
            ("20", ArenaModelId::M4),
        ] {
            let legacy = legacy_arena_suffix(legacy_suffix);
            assert_eq!(normalize_arena_model_id(&legacy), Some(expected));
        }
        assert_eq!(normalize_arena_model_id("fsrs"), Some(ArenaModelId::M5));
        assert_eq!(normalize_arena_model_id("m4"), Some(ArenaModelId::M4));
    }
}
