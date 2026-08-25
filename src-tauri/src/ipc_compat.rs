//! Legacy IPC command names for backward-compatible frontend bindings.

use crate::commands::{algorithm, review};
use crate::database::Repository;
use crate::error::Result;
use tauri::State;

#[tauri::command]
pub async fn get_sm20_arena_stats(repo: State<'_, Repository>) -> Result<review::ArenaStats> {
    review::get_arena_stats(repo).await
}

#[tauri::command]
pub async fn optimize_sm20_fsrs(repo: State<'_, Repository>) -> Result<review::FsrsOptimizeSummary> {
    review::optimize_arena_fsrs(repo).await
}

#[tauri::command]
pub async fn optimize_sm20_m4(
    repo: State<'_, Repository>,
) -> Result<crate::algorithms::precision::optimize::M4OptimizeOutcome> {
    review::optimize_precision_kernel(repo).await
}

#[tauri::command]
pub async fn get_sm20_optimization_status(
    repo: State<'_, Repository>,
) -> Result<algorithm::ArenaOptimizationStatus> {
    algorithm::get_arena_optimization_status(repo).await
}

#[tauri::command]
pub async fn optimize_sm20_locally(
    repo: State<'_, Repository>,
) -> Result<algorithm::ArenaOptimizationStatus> {
    algorithm::optimize_arena_locally(repo).await
}
