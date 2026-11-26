//! Tauri commands for Language Packs and offline dictionary lookup.

use crate::database::Repository;
use crate::models::language_ecosystem::{LanguageDictionaryEntryRecord, LanguagePackRecord};
use tauri::State;

#[tauri::command]
pub async fn list_language_packs(
    language_tag: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguagePackRecord>, String> {
    repo.list_language_packs(language_tag.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn install_language_pack_with_entries(
    pack: LanguagePackRecord,
    entries: Vec<LanguageDictionaryEntryRecord>,
    repo: State<'_, Repository>,
) -> Result<LanguagePackRecord, String> {
    repo.install_language_pack_with_entries(pack, entries)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lookup_language_pack_dictionary(
    language_tag: String,
    query: String,
    lemma: Option<String>,
    limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageDictionaryEntryRecord>, String> {
    repo.lookup_language_pack_dictionary(&language_tag, &query, lemma.as_deref(), limit.unwrap_or(20))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn verify_language_pack(
    pack_id: String,
    repo: State<'_, Repository>,
) -> Result<LanguagePackRecord, String> {
    repo.verify_language_pack(&pack_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_language_pack(
    pack_id: String,
    repo: State<'_, Repository>,
) -> Result<bool, String> {
    repo.remove_language_pack(&pack_id)
        .await
        .map_err(|e| e.to_string())
}
