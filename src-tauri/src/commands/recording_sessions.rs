//! Tauri commands for recording sessions.

use tauri::State;
use crate::database::Repository;
use crate::models::recording_session::*;

#[tauri::command]
pub async fn create_recording_session(
    request: CreateRecordingSession,
    repo: State<'_, Repository>,
) -> Result<RecordingSession, SessionOperationError> {
    repo.create_recording_session(&request).await
}

#[tauri::command]
pub async fn get_recording_session(
    id: String,
    repo: State<'_, Repository>,
) -> Result<RecordingSession, SessionOperationError> {
    repo.get_recording_session(&id).await
}

#[tauri::command]
pub async fn find_session_by_media_hash(
    sha256: String,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Option<RecordingSession>, SessionOperationError> {
    repo.find_session_by_media_hash(&sha256, collection_id.as_deref())
        .await
}

#[tauri::command]
pub async fn list_recording_sessions(
    collection_id: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
    repo: State<'_, Repository>,
) -> Result<RecordingSessionPage, SessionOperationError> {
    repo.list_recording_sessions(
        collection_id.as_deref(),
        cursor.as_deref(),
        limit.unwrap_or(50),
    )
    .await
}

#[tauri::command]
pub async fn update_recording_session_profile(
    id: String,
    expected_version: i64,
    content_type: String,
    profile_json: String,
    repo: State<'_, Repository>,
) -> Result<RecordingSession, SessionOperationError> {
    repo.update_recording_session_profile(&id, expected_version, &content_type, &profile_json)
        .await
}

#[tauri::command]
pub async fn get_session_segments(
    id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    repo: State<'_, Repository>,
) -> Result<SessionSegmentPage, SessionOperationError> {
    repo.get_session_segments(&id, cursor.as_deref(), limit.unwrap_or(200))
        .await
}

#[tauri::command]
pub async fn get_session_document_privacy(
    id: String,
    repo: State<'_, Repository>,
) -> Result<SessionDocumentPrivacy, SessionOperationError> {
    repo.get_session_document_privacy(&id).await
}

#[tauri::command]
pub async fn append_recording_part(
    session_id: String,
    writer_epoch: String,
    sequence: i64,
    start_ms: i64,
    duration_ms: i64,
    format_json: String,
    bytes: Vec<u8>,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<RecordingPart, SessionOperationError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| SessionOperationError::source_unavailable())?;
    crate::recording::append_recording_part(
        &data_dir,
        repo.pool(),
        &session_id,
        &writer_epoch,
        sequence,
        start_ms,
        duration_ms,
        &format_json,
        &bytes,
    )
    .await
}

#[tauri::command]
pub async fn finalize_recording_session(
    id: String,
    expected_version: i64,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<RecordingSession, SessionOperationError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| SessionOperationError::source_unavailable())?;
    crate::recording::finalize_recording_session(
        &data_dir,
        repo.pool(),
        &id,
        expected_version,
    )
    .await
}

#[tauri::command]
pub async fn recover_recording_session(
    id: String,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<crate::recording::RecoveryReport, SessionOperationError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| SessionOperationError::source_unavailable())?;
    crate::recording::reconcile_recording_session(&data_dir, repo.pool(), &id).await
}

#[tauri::command]
pub async fn stage_session_media(
    session_id: String,
    source_path: String,
    mime: String,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<SessionMediaAsset, SessionOperationError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| SessionOperationError::source_unavailable())?;
    crate::recording::stage_session_media(
        &data_dir,
        repo.pool(),
        &session_id,
        std::path::Path::new(&source_path),
        &mime,
    )
    .await
}

#[tauri::command]
pub async fn export_partial_recording(
    session_id: String,
    output_path: String,
    app_handle: tauri::AppHandle,
) -> Result<i64, SessionOperationError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| SessionOperationError::source_unavailable())?;
    crate::recording::export_partial_recording(
        &data_dir,
        &session_id,
        std::path::Path::new(&output_path),
    )
}

#[tauri::command]
pub async fn commit_session_unit(
    job_id: String,
    session_id: String,
    expected_cancel_epoch: i64,
    lease_owner: String,
    processed_duration_ms: i64,
    total_duration_ms: Option<i64>,
    segments: Vec<SessionTranscriptSegmentInput>,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<usize, SessionOperationError> {
    use tauri::Emitter;
    let committed = repo
        .commit_session_unit(
            &job_id,
            &session_id,
            expected_cancel_epoch,
            &lease_owner,
            processed_duration_ms,
            total_duration_ms,
            &segments,
        )
        .await?;
    let _ = app_handle.emit("transcription://queue-updated", ());
    Ok(committed)
}

#[tauri::command]
pub async fn import_session_transcript(
    session_id: String,
    segments: Vec<SessionTranscriptSegmentInput>,
    repo: State<'_, Repository>,
) -> Result<usize, SessionOperationError> {
    repo.import_session_transcript(&session_id, &segments).await
}

