//! Audio Edition and Listening Session Tauri commands

use crate::database::{AudioEditionRepository, Repository};
use crate::error::Result;
use crate::models::audio_edition::{
    AudioEdition, AudioEditionAnchor, AudioEditionSection, AudioEditionWithSections,
    ListeningSession, ListeningSessionItem, ListeningSessionItemUpdate,
    ListeningSessionWithItems,
};
use tauri::State;

#[tauri::command]
pub async fn create_audio_edition(
    edition: AudioEdition,
    sections: Vec<AudioEditionSection>,
    repo: State<'_, Repository>,
) -> Result<AudioEditionWithSections> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.create_audio_edition(&edition, &sections).await
}

#[tauri::command]
pub async fn get_audio_edition(
    id: String,
    repo: State<'_, Repository>,
) -> Result<Option<AudioEditionWithSections>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.get_audio_edition(&id).await
}

#[tauri::command]
pub async fn get_audio_edition_by_document(
    document_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<AudioEditionWithSections>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.get_audio_edition_by_document(&document_id).await
}

#[tauri::command]
pub async fn list_audio_editions(
    repo: State<'_, Repository>,
) -> Result<Vec<AudioEditionWithSections>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.list_audio_editions().await
}

#[tauri::command]
pub async fn update_audio_edition_status(
    id: String,
    status: String,
    total_duration_sec: Option<f64>,
    repo: State<'_, Repository>,
) -> Result<()> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository
        .update_audio_edition_status(&id, &status, total_duration_sec)
        .await
}

#[tauri::command]
pub async fn delete_audio_edition(id: String, repo: State<'_, Repository>) -> Result<()> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.delete_audio_edition(&id).await
}

#[tauri::command]
pub async fn get_audio_edition_section(
    id: String,
    repo: State<'_, Repository>,
) -> Result<Option<AudioEditionSection>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.get_audio_edition_section(&id).await
}

#[tauri::command]
pub async fn get_audio_edition_sections(
    edition_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<AudioEditionSection>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.get_audio_edition_sections(&edition_id).await
}

#[tauri::command]
pub async fn update_audio_edition_section_status(
    id: String,
    generation_status: String,
    audio_file_path: Option<String>,
    duration_sec: Option<f64>,
    failure_reason: Option<String>,
    repo: State<'_, Repository>,
) -> Result<()> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository
        .update_audio_edition_section_status(
            &id,
            &generation_status,
            audio_file_path,
            duration_sec,
            failure_reason,
        )
        .await
}

#[tauri::command]
pub async fn save_audio_edition_anchors(
    section_id: String,
    anchors: Vec<AudioEditionAnchor>,
    repo: State<'_, Repository>,
) -> Result<()> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository
        .save_audio_edition_anchors(&section_id, &anchors)
        .await
}

#[tauri::command]
pub async fn get_audio_edition_anchors(
    section_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<AudioEditionAnchor>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.get_audio_edition_anchors(&section_id).await
}

#[tauri::command]
pub async fn get_anchors_for_edition(
    edition_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<AudioEditionAnchor>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.get_anchors_for_edition(&edition_id).await
}

#[tauri::command]
pub async fn find_anchor_by_audio_time(
    section_id: String,
    timestamp_sec: f64,
    repo: State<'_, Repository>,
) -> Result<Option<AudioEditionAnchor>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository
        .find_anchor_by_audio_time(&section_id, timestamp_sec)
        .await
}

#[tauri::command]
pub async fn find_anchor_by_source(
    edition_id: String,
    source_anchor: String,
    repo: State<'_, Repository>,
) -> Result<Option<AudioEditionAnchor>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository
        .find_anchor_by_source(&edition_id, &source_anchor)
        .await
}

// --- Listening Sessions ---

#[tauri::command]
pub async fn create_listening_session(
    session: ListeningSession,
    repo: State<'_, Repository>,
) -> Result<ListeningSession> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.create_listening_session(&session).await
}

#[tauri::command]
pub async fn get_listening_session(
    id: String,
    repo: State<'_, Repository>,
) -> Result<Option<ListeningSessionWithItems>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.get_listening_session(&id).await
}

#[tauri::command]
pub async fn get_active_listening_session(
    edition_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<ListeningSessionWithItems>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.get_active_listening_session(&edition_id).await
}

#[tauri::command]
pub async fn end_listening_session(
    id: String,
    ended_at: i64,
    duration_seconds: i32,
    extract_count: i32,
    repo: State<'_, Repository>,
) -> Result<()> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository
        .end_listening_session(&id, ended_at, duration_seconds, extract_count)
        .await
}

#[tauri::command]
pub async fn mark_listening_session_reviewed(
    id: String,
    is_reviewed: bool,
    repo: State<'_, Repository>,
) -> Result<()> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository
        .mark_listening_session_reviewed(&id, is_reviewed)
        .await
}

#[tauri::command]
pub async fn list_unreviewed_listening_sessions(
    repo: State<'_, Repository>,
) -> Result<Vec<ListeningSessionWithItems>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.list_unreviewed_listening_sessions().await
}

/// List listening sessions; `unreviewed_only = false` returns every session.
#[tauri::command]
pub async fn list_listening_sessions(
    unreviewed_only: bool,
    repo: State<'_, Repository>,
) -> Result<Vec<ListeningSessionWithItems>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.list_listening_sessions(unreviewed_only).await
}

#[tauri::command]
pub async fn add_listening_session_item(
    item: ListeningSessionItem,
    repo: State<'_, Repository>,
) -> Result<ListeningSessionItem> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.add_listening_session_item(&item).await
}

#[tauri::command]
pub async fn get_listening_session_items(
    session_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<ListeningSessionItem>> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.get_listening_session_items(&session_id).await
}

#[tauri::command]
pub async fn delete_listening_session_item(
    id: String,
    repo: State<'_, Repository>,
) -> Result<()> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.delete_listening_session_item(&id).await
}

/// Apply a partial update to a listening-session item (Inbox triage: notes,
/// keep/confirm, snippet corrections).
#[tauri::command]
pub async fn update_listening_session_item(
    id: String,
    updates: ListeningSessionItemUpdate,
    repo: State<'_, Repository>,
) -> Result<ListeningSessionItem> {
    let repository = AudioEditionRepository::new(repo.pool().clone());
    repository.update_listening_session_item(&id, &updates).await
}
