//! Tauri commands for Language Learning ecosystem repositories.

use crate::database::Repository;
use crate::models::language_ecosystem::{
    LanguageAnalyticsDailyRecord, LanguageAnalyticsEventInput, LanguageAudioAlignmentRecord,
    LanguageCoverageResultRecord, LanguageGeneratedDocumentRecord, LanguagePhraseRecord,
    LanguageProcessingChunkRecord, LanguageProcessingJobRecord, LanguageProcessingResultRecord,
    LanguageRecommendationCandidateRecord, LanguageSrsDraftRecord, LanguageTranslationCacheRecord,
};
use tauri::State;

#[tauri::command]
pub async fn upsert_language_phrase(
    phrase: LanguagePhraseRecord,
    repo: State<'_, Repository>,
) -> Result<LanguagePhraseRecord, String> {
    repo.upsert_language_phrase(phrase)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_language_phrases(
    profile_id: String,
    language_tag: Option<String>,
    limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguagePhraseRecord>, String> {
    repo.list_language_phrases(&profile_id, language_tag.as_deref(), limit.unwrap_or(200))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_language_phrase(
    profile_id: String,
    phrase_id: String,
    repo: State<'_, Repository>,
) -> Result<bool, String> {
    repo.delete_language_phrase(&profile_id, &phrase_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_language_srs_draft(
    draft: LanguageSrsDraftRecord,
    repo: State<'_, Repository>,
) -> Result<LanguageSrsDraftRecord, String> {
    repo.upsert_language_srs_draft(draft)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn find_language_srs_draft_by_key(
    profile_id: String,
    draft_key: String,
    repo: State<'_, Repository>,
) -> Result<Option<LanguageSrsDraftRecord>, String> {
    repo.find_language_srs_draft_by_key(&profile_id, &draft_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_language_audio_alignment(
    alignment: LanguageAudioAlignmentRecord,
    repo: State<'_, Repository>,
) -> Result<LanguageAudioAlignmentRecord, String> {
    repo.upsert_language_audio_alignment(alignment)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_language_audio_alignments(
    source_id: String,
    profile_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageAudioAlignmentRecord>, String> {
    repo.list_language_audio_alignments(&source_id, profile_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_language_coverage_result(
    record: LanguageCoverageResultRecord,
    referenced_entry_ids: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<LanguageCoverageResultRecord, String> {
    repo.upsert_language_coverage_result(record, referenced_entry_ids)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_language_coverage_results(
    profile_id: String,
    document_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageCoverageResultRecord>, String> {
    repo.get_language_coverage_results(&profile_id, document_id.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn invalidate_language_coverage_for_entry(
    profile_id: String,
    lexical_entry_id: String,
    repo: State<'_, Repository>,
) -> Result<i64, String> {
    repo.invalidate_language_coverage_for_entry(&profile_id, &lexical_entry_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn upsert_language_recommendation_candidate(
    candidate: LanguageRecommendationCandidateRecord,
    repo: State<'_, Repository>,
) -> Result<LanguageRecommendationCandidateRecord, String> {
    repo.upsert_language_recommendation_candidate(candidate)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_language_recommendation_candidates(
    profile_id: String,
    lifecycle: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageRecommendationCandidateRecord>, String> {
    repo.list_language_recommendation_candidates(&profile_id, lifecycle.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_language_analytics_event(
    input: LanguageAnalyticsEventInput,
    repo: State<'_, Repository>,
) -> Result<bool, String> {
    repo.record_language_analytics_event(input)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_language_analytics_daily(
    profile_id: String,
    start_day: Option<String>,
    end_day: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageAnalyticsDailyRecord>, String> {
    repo.list_language_analytics_daily(&profile_id, start_day.as_deref(), end_day.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn record_language_generated_document(
    record: LanguageGeneratedDocumentRecord,
    repo: State<'_, Repository>,
) -> Result<LanguageGeneratedDocumentRecord, String> {
    repo.record_language_generated_document(record)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_language_generated_documents(
    profile_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageGeneratedDocumentRecord>, String> {
    repo.list_language_generated_documents(&profile_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn put_language_translation_cache(
    record: LanguageTranslationCacheRecord,
    repo: State<'_, Repository>,
) -> Result<LanguageTranslationCacheRecord, String> {
    repo.put_language_translation_cache(record)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_language_translation_cache(
    cache_key: String,
    repo: State<'_, Repository>,
) -> Result<Option<LanguageTranslationCacheRecord>, String> {
    repo.get_language_translation_cache(&cache_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn put_language_processing_job(
    job: LanguageProcessingJobRecord,
    repo: State<'_, Repository>,
) -> Result<(), String> {
    repo.put_language_processing_job(job)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_language_processing_job(
    job_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<LanguageProcessingJobRecord>, String> {
    repo.get_language_processing_job(&job_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn put_language_processing_chunk(
    chunk: LanguageProcessingChunkRecord,
    repo: State<'_, Repository>,
) -> Result<(), String> {
    repo.put_language_processing_chunk(chunk)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_language_processing_chunks(
    processing_key: String,
    repo: State<'_, Repository>,
) -> Result<Vec<LanguageProcessingChunkRecord>, String> {
    repo.get_language_processing_chunks(&processing_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn put_language_processing_result(
    record: LanguageProcessingResultRecord,
    repo: State<'_, Repository>,
) -> Result<(), String> {
    repo.put_language_processing_result(record)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_language_processing_result(
    processing_key: String,
    repo: State<'_, Repository>,
) -> Result<Option<LanguageProcessingResultRecord>, String> {
    repo.get_language_processing_result(&processing_key)
        .await
        .map_err(|e| e.to_string())
}
