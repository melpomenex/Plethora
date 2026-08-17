//! Memory-scenario configuration bridge (bound-runtime-memory-and-gate).
//!
//! The memory harness (`scripts/memory-bench/`) launches the app with a set of
//! `INCREMENTUM_MEMORY_*` environment variables. The webview cannot read
//! process environment variables directly, so this command is the one bridge:
//! it returns the scenario configuration when (and only when) the harness's
//! variables are present, and `None` otherwise.
//!
//! This is the double gate from design D2: the frontend scenario surface is
//! mounted only when BOTH `INCREMENTUM_MEMORY_SCENARIO` and
//! `INCREMENTUM_MEMORY_CONTROL` are present, so a production build (no harness
//! env) exposes no scenario surface at all.

use serde::Serialize;

/// Names of the harness environment variables (kept in sync with
/// `scripts/memory-bench/` and `src/lib/memoryScenario/`).
pub const MEMORY_SCENARIO_ENV: &str = "PLETHORA_MEMORY_SCENARIO";
pub const MEMORY_CONTROL_ENV: &str = "PLETHORA_MEMORY_CONTROL";
pub const MEMORY_RUN_ID_ENV: &str = "PLETHORA_MEMORY_RUN_ID";
pub const MEMORY_CORPUS_DIR_ENV: &str = "PLETHORA_MEMORY_CORPUS_DIR";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryScenarioConfig {
    /// The scenario marker value (the harness sets it to "1").
    pub scenario: String,
    /// Base URL of the harness's control server, e.g. "http://127.0.0.1:43123".
    pub control_url: String,
    /// The run-id the harness set when launching this app instance.
    pub run_id: String,
    /// Directory the harness provisions corpus files into (`.bench/corpus`),
    /// when the harness set it.
    pub corpus_dir: Option<String>,
}

/// Read the memory-scenario configuration from the process environment.
///
/// Returns `None` — and the frontend scenario surface stays inert — unless
/// both `INCREMENTUM_MEMORY_SCENARIO` and `INCREMENTUM_MEMORY_CONTROL` are
/// present in the environment of the launched app.
#[tauri::command]
pub fn get_memory_scenario_config() -> Option<MemoryScenarioConfig> {
    let scenario = std::env::var(MEMORY_SCENARIO_ENV).ok()?;
    let control_url = std::env::var(MEMORY_CONTROL_ENV).ok()?;
    let run_id = std::env::var(MEMORY_RUN_ID_ENV).ok()?;
    Some(MemoryScenarioConfig {
        scenario,
        control_url,
        run_id,
        corpus_dir: std::env::var(MEMORY_CORPUS_DIR_ENV).ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_is_none_without_scenario_env() {
        // Guard against a stray harness env leaking into the test process.
        std::env::remove_var(MEMORY_SCENARIO_ENV);
        std::env::remove_var(MEMORY_CONTROL_ENV);
        std::env::remove_var(MEMORY_RUN_ID_ENV);
        assert!(get_memory_scenario_config().is_none());
    }

    #[test]
    fn config_requires_both_gate_variables() {
        std::env::remove_var(MEMORY_SCENARIO_ENV);
        std::env::remove_var(MEMORY_CONTROL_ENV);
        std::env::remove_var(MEMORY_RUN_ID_ENV);

        // Only the scenario marker -> still inert.
        std::env::set_var(MEMORY_SCENARIO_ENV, "1");
        assert!(get_memory_scenario_config().is_none());

        // Both markers present -> config with the control URL and run id.
        std::env::set_var(MEMORY_CONTROL_ENV, "http://127.0.0.1:43123");
        std::env::set_var(MEMORY_RUN_ID_ENV, "run-test");
        let config = get_memory_scenario_config().expect("both env vars present");
        assert_eq!(config.scenario, "1");
        assert_eq!(config.control_url, "http://127.0.0.1:43123");
        assert_eq!(config.run_id, "run-test");
        assert!(config.corpus_dir.is_none());

        std::env::remove_var(MEMORY_SCENARIO_ENV);
        std::env::remove_var(MEMORY_CONTROL_ENV);
        std::env::remove_var(MEMORY_RUN_ID_ENV);
    }
}
