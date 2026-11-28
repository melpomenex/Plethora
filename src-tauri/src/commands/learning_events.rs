//! Tauri commands for the unified learning event spine (Phase 1A).

use crate::database::{LearningEventRepository, Repository};
use crate::error::Result;
use crate::models::learning_event::{
    AppendLearningEventInput, AppendLearningEventResult, LearningEvent, LearningEventCheckpoint,
    LearningEventFilter,
};
use tauri::State;

#[tauri::command]
pub async fn append_learning_event(
    repository: State<'_, Repository>,
    input: AppendLearningEventInput,
) -> Result<AppendLearningEventResult> {
    let repo = LearningEventRepository::new(repository.pool().clone());
    repo.append_learning_event(&input).await
}

#[tauri::command]
pub async fn retract_learning_event(
    repository: State<'_, Repository>,
    target_event_id: String,
    input: AppendLearningEventInput,
) -> Result<AppendLearningEventResult> {
    let repo = LearningEventRepository::new(repository.pool().clone());
    repo.retract_learning_event(&target_event_id, &input).await
}

#[tauri::command]
pub async fn list_learning_events(
    repository: State<'_, Repository>,
    filter: Option<LearningEventFilter>,
) -> Result<Vec<LearningEvent>> {
    let repo = LearningEventRepository::new(repository.pool().clone());
    repo.list_learning_events(&filter.unwrap_or_default()).await
}

#[tauri::command]
pub async fn get_learning_event_checkpoint(
    repository: State<'_, Repository>,
    consumer_id: String,
) -> Result<Option<LearningEventCheckpoint>> {
    let repo = LearningEventRepository::new(repository.pool().clone());
    repo.get_checkpoint(&consumer_id).await
}

#[tauri::command]
pub async fn advance_learning_event_checkpoint(
    repository: State<'_, Repository>,
    consumer_id: String,
    last_seq: i64,
    policy_version: Option<String>,
) -> Result<LearningEventCheckpoint> {
    let repo = LearningEventRepository::new(repository.pool().clone());
    repo.advance_checkpoint(
        &consumer_id,
        last_seq,
        policy_version.as_deref().unwrap_or("v1"),
    )
    .await
}
