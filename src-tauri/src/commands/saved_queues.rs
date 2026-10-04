//! Commands for managing user-defined saved queues

use tauri::State;

use crate::database::{Repository, SavedQueueRepository};
use crate::models::saved_queue::{CreateSavedQueueInput, SavedQueue, UpdateSavedQueueInput};

#[tauri::command]
pub async fn get_saved_queues(
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<SavedQueue>, String> {
    let saved_queue_repo = SavedQueueRepository::new(repo.pool().clone());
    saved_queue_repo
        .get_saved_queues(collection_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_saved_queue(
    id: String,
    repo: State<'_, Repository>,
) -> Result<SavedQueue, String> {
    let saved_queue_repo = SavedQueueRepository::new(repo.pool().clone());
    saved_queue_repo
        .get_saved_queue(&id)
        .await
        .map_err(|e| e.to_string())
        .and_then(|opt| opt.ok_or_else(|| format!("Saved queue {} not found", id)))
}

#[tauri::command]
pub async fn create_saved_queue(
    input: CreateSavedQueueInput,
    repo: State<'_, Repository>,
) -> Result<SavedQueue, String> {
    let saved_queue_repo = SavedQueueRepository::new(repo.pool().clone());
    saved_queue_repo
        .create_saved_queue(input)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_saved_queue(
    id: String,
    input: UpdateSavedQueueInput,
    repo: State<'_, Repository>,
) -> Result<SavedQueue, String> {
    let saved_queue_repo = SavedQueueRepository::new(repo.pool().clone());
    saved_queue_repo
        .update_saved_queue(&id, input)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_saved_queue(
    id: String,
    repo: State<'_, Repository>,
) -> Result<(), String> {
    let saved_queue_repo = SavedQueueRepository::new(repo.pool().clone());
    saved_queue_repo
        .delete_saved_queue(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_active_saved_queue_id(
    repo: State<'_, Repository>,
) -> Result<Option<String>, String> {
    let saved_queue_repo = SavedQueueRepository::new(repo.pool().clone());
    saved_queue_repo
        .get_active_saved_queue_id()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_active_saved_queue_id(
    id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<(), String> {
    let saved_queue_repo = SavedQueueRepository::new(repo.pool().clone());
    saved_queue_repo
        .set_active_saved_queue_id(id.as_deref())
        .await
        .map_err(|e| e.to_string())
}
