//! Tauri commands for auto-postpone — the priority-queue overflow handler.
//!
//! At session start, when outstanding material exceeds daily capacity, the
//! lowest-priority surplus is postponed. The decision logic lives in
//! [`crate::algorithms::postpone`]; these commands wire it to the queue and
//! persist the auto-postpone settings (enable/disable, capacity, priority
//! threshold) in the `settings` table.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::algorithms::postpone::{decide, PostponeCandidate, PostponeConfig, PostponeDecision};
use crate::database::Repository;
use crate::error::Result;

/// The persisted auto-postpone settings. Stored as JSON under the
/// `auto_postpone_config` settings key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoPostponeSettings {
    /// Master switch. When false, no element is auto-postponed (capacity is
    /// treated as unlimited).
    pub enabled: bool,
    /// Maximum outstanding elements to keep in a session.
    pub daily_capacity: usize,
    /// Elements at or above this 0-100 priority are never postponed.
    pub priority_threshold: f64,
    /// When true, difficulty biases the decision (harder items survive).
    pub respect_difficulty: bool,
}

impl Default for AutoPostponeSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            daily_capacity: 50,
            priority_threshold: 70.0,
            respect_difficulty: true,
        }
    }
}

const SETTINGS_KEY: &str = "auto_postpone_config";

/// Read the persisted auto-postpone settings, falling back to defaults.
#[tauri::command]
pub async fn get_auto_postpone_settings(
    repo: State<'_, Repository>,
) -> Result<AutoPostponeSettings> {
    let raw = repo.get_setting(SETTINGS_KEY).await?;
    Ok(raw
        .and_then(|s| serde_json::from_str::<AutoPostponeSettings>(&s).ok())
        .unwrap_or_default())
}

/// Persist the auto-postpone settings.
#[tauri::command]
pub async fn set_auto_postpone_settings(
    settings: AutoPostponeSettings,
    repo: State<'_, Repository>,
) -> Result<()> {
    let json = serde_json::to_string(&settings)?;
    repo.set_setting(SETTINGS_KEY, &json).await
}

/// Run the auto-postpone decision over the currently-due learning items and
/// return the keep/postpone split. This is the session-start hook (task 3.11):
/// the frontend calls it before assembling the session, then builds the
/// session from the `keep` set.
///
/// When auto-postpone is disabled, every due item is in `keep` and `postpone`
/// is empty (the capacity is treated as unlimited).
#[tauri::command]
pub async fn run_auto_postpone(repo: State<'_, Repository>) -> Result<PostponeDecision> {
    let settings = repo.get_setting(SETTINGS_KEY).await?;
    let settings = settings
        .and_then(|s| serde_json::from_str::<AutoPostponeSettings>(&s).ok())
        .unwrap_or_default();

    // Gather due learning items as candidates. The do_not_postpone flag is
    // not yet surfaced in the schema; it defaults to false here. (Task 3.12
    // reserves the per-element flag; this is the read side of it.)
    let now = chrono::Utc::now();
    let items = repo.get_due_learning_items(&now, None).await?;
    let candidates: Vec<PostponeCandidate> = items
        .iter()
        .map(|item| PostponeCandidate {
            id: item.id.clone(),
            priority: item.priority_slider as f64,
            difficulty: item.difficulty as f64,
            do_not_postpone: false,
        })
        .collect();

    // When disabled, model as unlimited capacity (keep everything).
    let config = if settings.enabled {
        PostponeConfig {
            daily_capacity: settings.daily_capacity,
            priority_threshold: settings.priority_threshold,
            respect_difficulty: settings.respect_difficulty,
        }
    } else {
        PostponeConfig {
            daily_capacity: usize::MAX,
            priority_threshold: settings.priority_threshold,
            respect_difficulty: settings.respect_difficulty,
        }
    };

    Ok(decide(&candidates, &config))
}
