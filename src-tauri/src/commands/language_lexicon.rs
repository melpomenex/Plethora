//! Tauri commands for the durable language lexicon.

use crate::database::Repository;
use crate::models::language_lexicon::{
    EncounterBatchResult, EncounterInput, LanguageLexicalEntry, LanguageLexiconExport,
    LanguageLexiconSyncEnvelope, LanguageLookupEvent, LanguageOccurrence, LexicalEntryOverride,
    LexicalEntryUpsert, LegacyLookupRecord, LookupInput, LexiconPage,
};
use tauri::State;

#[tauri::command]
pub async fn upsert_language_lexical_entry(
    input: LexicalEntryUpsert,
    repo: State<'_, Repository>,
) -> Result<LanguageLexicalEntry, String> {
    repo.upsert_language_lexical_entry(input).await.map_err(|error| error.to_string())
}
#[tauri::command]
pub async fn get_language_lexical_entry(
    profile_id: String,
    entry_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<LanguageLexicalEntry>, String> {
    repo.get_language_lexical_entry(&profile_id, &entry_id).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_language_lexical_entries(
    profile_id: String,
    language_tag: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<LexiconPage<LanguageLexicalEntry>, String> {
    repo.list_language_lexical_entries(&profile_id, language_tag.as_deref(), offset.unwrap_or(0), limit.unwrap_or(50))
        .await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn record_language_encounter(
    input: EncounterInput,
    repo: State<'_, Repository>,
) -> Result<LanguageLexicalEntry, String> {
    repo.record_language_encounter(input).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn record_language_encounter_batch(
    inputs: Vec<EncounterInput>,
    repo: State<'_, Repository>,
) -> Result<EncounterBatchResult, String> {
    repo.record_language_encounter_batch(inputs).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_language_occurrences(
    profile_id: String,
    entry_id: Option<String>,
    document_id: Option<String>,
    media_id: Option<String>,
    language_tag: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<LexiconPage<LanguageOccurrence>, String> {
    repo.list_language_occurrences(
        &profile_id, entry_id.as_deref(), document_id.as_deref(), media_id.as_deref(),
        language_tag.as_deref(), offset.unwrap_or(0), limit.unwrap_or(50),
    ).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn record_language_lookup(
    input: LookupInput,
    repo: State<'_, Repository>,
) -> Result<LanguageLookupEvent, String> {
    repo.record_language_lookup(input).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn migrate_language_lookup_history(
    profile_id: String,
    records: Vec<LegacyLookupRecord>,
    repo: State<'_, Repository>,
) -> Result<i64, String> {
    repo.migrate_language_lookup_history(&profile_id, records).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn apply_language_lexical_override(
    input: LexicalEntryOverride,
    repo: State<'_, Repository>,
) -> Result<LanguageLexicalEntry, String> {
    repo.apply_language_lexical_override(input).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_language_lexicon(
    profile_id: String,
    include_occurrences: Option<bool>,
    occurrence_offset: Option<i64>,
    occurrence_limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<LanguageLexiconExport, String> {
    repo.export_language_lexicon(
        &profile_id, include_occurrences.unwrap_or(false), occurrence_offset.unwrap_or(0),
        occurrence_limit.unwrap_or(50),
    ).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn serialize_language_lexicon_for_sync(
    profile_id: String,
    repo: State<'_, Repository>,
) -> Result<LanguageLexiconSyncEnvelope, String> {
    repo.serialize_language_lexicon_for_sync(&profile_id).await.map_err(|error| error.to_string())
}
