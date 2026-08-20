//! Tauri commands for language knowledge state and evidence.

use crate::database::Repository;
use crate::models::language_knowledge::{
    KnownWordImportPreview, KnownWordImportRecord, LanguageKnowledgeEvidenceEvent,
    LanguageKnowledgeEvidenceInput, LanguageKnowledgeExport, LanguageKnowledgeStateChange,
    LanguageKnowledgeStateHistory, LanguageKnowledgeStateSnapshot, LanguageMemorizationLink,
    LanguageMemorizationLinkInput,
};
use crate::models::language_lexicon::LexiconPage;
use tauri::State;

#[tauri::command]
pub async fn get_language_knowledge_state(
    profile_id: String,
    entry_id: String,
    repo: State<'_, Repository>,
) -> Result<LanguageKnowledgeStateSnapshot, String> {
    repo.get_language_knowledge_state(&profile_id, &entry_id).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn resolve_language_knowledge_state(
    profile_id: String,
    surface: String,
    repo: State<'_, Repository>,
) -> Result<Option<LanguageKnowledgeStateSnapshot>, String> {
    repo.resolve_language_knowledge_state(&profile_id, &surface).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_language_knowledge_state(
    change: LanguageKnowledgeStateChange,
    repo: State<'_, Repository>,
) -> Result<LanguageKnowledgeStateSnapshot, String> {
    repo.set_language_knowledge_state(change).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_language_knowledge_states_batch(
    changes: Vec<LanguageKnowledgeStateChange>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageKnowledgeStateSnapshot>, String> {
    repo.set_language_knowledge_states_batch(changes).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn record_language_knowledge_evidence(
    input: LanguageKnowledgeEvidenceInput,
    repo: State<'_, Repository>,
) -> Result<LanguageKnowledgeEvidenceEvent, String> {
    repo.record_language_knowledge_evidence(input).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_language_knowledge_history(
    profile_id: String,
    entry_id: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<LexiconPage<LanguageKnowledgeStateHistory>, String> {
    repo.list_language_knowledge_history(&profile_id, entry_id.as_deref(), offset.unwrap_or(0), limit.unwrap_or(50))
        .await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn undo_language_knowledge_change(
    profile_id: String,
    history_id: String,
    repo: State<'_, Repository>,
) -> Result<LanguageKnowledgeStateSnapshot, String> {
    repo.undo_language_knowledge_change(&profile_id, &history_id).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_language_memorization_link(
    input: LanguageMemorizationLinkInput,
    repo: State<'_, Repository>,
) -> Result<LanguageMemorizationLink, String> {
    repo.create_language_memorization_link(input).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn preview_language_known_word_import(
    profile_id: String,
    records: Vec<KnownWordImportRecord>,
    repo: State<'_, Repository>,
) -> Result<KnownWordImportPreview, String> {
    repo.preview_known_word_import(&profile_id, &records).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn import_language_known_words(
    profile_id: String,
    records: Vec<KnownWordImportRecord>,
    repo: State<'_, Repository>,
) -> Result<LanguageKnowledgeExport, String> {
    repo.import_known_words(&profile_id, records).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_language_knowledge(
    profile_id: String,
    repo: State<'_, Repository>,
) -> Result<LanguageKnowledgeExport, String> {
    repo.export_language_knowledge(&profile_id).await.map_err(|error| error.to_string())
}
