//! Tauri commands for practice persistence. These are CRUD/evidence records,
//! intentionally separate from review rating and scheduler commands.

use crate::database::Repository;
use crate::models::language_practice::LanguagePracticeAttempt;
use tauri::State;

#[tauri::command]
pub async fn upsert_language_practice_attempt(attempt: LanguagePracticeAttempt, repo: State<'_, Repository>) -> Result<LanguagePracticeAttempt, String> {
    repo.upsert_language_practice_attempt(attempt).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_language_practice_attempt(profile_id: String, id: String, repo: State<'_, Repository>) -> Result<LanguagePracticeAttempt, String> {
    repo.get_language_practice_attempt(&profile_id, &id).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_language_practice_attempts(profile_id: String, source_id: Option<String>, limit: Option<i64>, repo: State<'_, Repository>) -> Result<Vec<LanguagePracticeAttempt>, String> {
    repo.list_language_practice_attempts(&profile_id, source_id.as_deref(), limit.unwrap_or(50)).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_language_practice_attempt(profile_id: String, id: String, repo: State<'_, Repository>) -> Result<bool, String> {
    repo.delete_language_practice_attempt(&profile_id, &id).await.map_err(|error| error.to_string())
}
