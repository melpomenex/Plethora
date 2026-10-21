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
pub async fn find_session_by_document_id(
    document_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<RecordingSession>, SessionOperationError> {
    repo.find_session_by_document_id(&document_id).await
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
pub async fn update_recording_session_overview(
    id: String,
    overview_json: String,
    overview_revision: i64,
    repo: State<'_, Repository>,
) -> Result<RecordingSession, SessionOperationError> {
    repo.update_recording_session_overview(&id, &overview_json, overview_revision)
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
pub async fn get_recording_asset(
    session_id: String,
    asset_id: String,
    repo: State<'_, Repository>,
) -> Result<SessionMediaAsset, SessionOperationError> {
    repo.get_recording_asset(&session_id, &asset_id).await
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

#[tauri::command]
pub async fn create_session_marker(
    session_id: String,
    kind: SessionMarkerKind,
    media_ms: i64,
    window_ms: Option<i64>,
    note: Option<String>,
    repo: State<'_, Repository>,
) -> Result<RecordingSessionMarker, SessionOperationError> {
    repo.create_or_extend_session_marker(&session_id, kind, media_ms, window_ms, note).await
}

#[tauri::command]
pub async fn list_session_markers(
    session_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<RecordingSessionMarker>, SessionOperationError> {
    repo.list_session_markers(&session_id).await
}

#[tauri::command]
pub async fn resolve_session_markers(
    session_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<RecordingSessionMarker>, SessionOperationError> {
    repo.resolve_pending_markers_for_session(&session_id).await
}

#[tauri::command]
pub async fn correct_session_segment(
    session_id: String,
    segment_key: String,
    expected_revision: i64,
    text: String,
    split_metadata_json: Option<String>,
    repo: State<'_, Repository>,
) -> Result<i64, SessionOperationError> {
    repo.correct_session_segment(
        &session_id,
        &segment_key,
        expected_revision,
        &text,
        split_metadata_json.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn create_session_analysis_run(
    input: CreateSessionAnalysisRun,
    repo: State<'_, Repository>,
) -> Result<SessionAnalysisRun, SessionOperationError> {
    repo.create_session_analysis_run(&input).await
}

#[tauri::command]
pub async fn get_session_analysis_run(
    run_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<SessionAnalysisRun>, SessionOperationError> {
    repo.get_session_analysis_run(&run_id).await
}

#[tauri::command]
pub async fn upsert_session_analysis_unit(
    input: UpsertSessionAnalysisUnit,
    repo: State<'_, Repository>,
) -> Result<SessionAnalysisUnit, SessionOperationError> {
    repo.upsert_session_analysis_unit(&input).await
}

#[tauri::command]
pub async fn list_session_analysis_units(
    run_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<SessionAnalysisUnit>, SessionOperationError> {
    repo.list_session_analysis_units(&run_id).await
}

#[tauri::command]
pub async fn create_session_learning_draft(
    input: CreateSessionLearningDraft,
    repo: State<'_, Repository>,
) -> Result<SessionLearningDraft, SessionOperationError> {
    repo.create_session_learning_draft(&input).await
}

#[tauri::command]
pub async fn get_session_learning_draft(
    draft_id: String,
    repo: State<'_, Repository>,
) -> Result<Option<SessionLearningDraft>, SessionOperationError> {
    repo.get_session_learning_draft(&draft_id).await
}

#[tauri::command]
pub async fn list_session_learning_drafts(
    session_id: String,
    status: Option<String>,
    kind: Option<String>,
    cursor: Option<String>,
    limit: Option<i64>,
    repo: State<'_, Repository>,
) -> Result<SessionLearningDraftPage, SessionOperationError> {
    repo.list_session_learning_drafts(
        &session_id,
        status.as_deref(),
        kind.as_deref(),
        cursor.as_deref(),
        limit,
    )
    .await
}

#[tauri::command]
pub async fn update_session_learning_draft(
    update: UpdateSessionLearningDraft,
    repo: State<'_, Repository>,
) -> Result<SessionLearningDraft, SessionOperationError> {
    repo.update_session_learning_draft(&update).await
}

#[tauri::command]
pub async fn reject_session_learning_drafts(
    session_id: String,
    draft_ids: Vec<String>,
    repo: State<'_, Repository>,
) -> Result<i64, SessionOperationError> {
    repo.reject_session_learning_drafts(&session_id, &draft_ids).await
}

#[tauri::command]
pub async fn accept_session_drafts(
    input: AcceptSessionDraftsInput,
    repo: State<'_, Repository>,
) -> Result<AcceptSessionDraftsResponse, SessionOperationError> {
    repo.accept_session_drafts(&input).await
}

#[tauri::command]
pub async fn delete_session_media(
    session_id: String,
    expected_version: i64,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<DeleteSessionMediaResult, SessionOperationError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| SessionOperationError::source_unavailable())?;
    repo.delete_session_media(&data_dir, &session_id, expected_version).await
}

#[tauri::command]
pub async fn delete_recording_session(
    session_id: String,
    expected_version: i64,
    delete_document: Option<bool>,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<DeleteRecordingSessionResult, SessionOperationError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| SessionOperationError::source_unavailable())?;
    repo.delete_recording_session(
        &data_dir,
        &session_id,
        expected_version,
        delete_document.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn process_cleanup_journal(
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<CleanupJournalResult, SessionOperationError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| SessionOperationError::source_unavailable())?;
    repo.process_cleanup_journal(&data_dir).await
}

#[tauri::command]
pub async fn update_session_speaker(
    session_id: String,
    from_speaker_id: String,
    to_speaker_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<usize, SessionOperationError> {
    repo.update_session_speaker(&session_id, &from_speaker_id, to_speaker_id.as_deref()).await
}

#[tauri::command]
pub async fn list_session_speakers(
    session_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<String>, SessionOperationError> {
    repo.list_session_speakers(&session_id).await
}

#[tauri::command]
pub async fn associate_session_document(
    session_id: String,
    document_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<SessionRelatedDocument>, SessionOperationError> {
    repo.associate_session_document(&session_id, &document_id).await
}

#[tauri::command]
pub async fn disassociate_session_document(
    session_id: String,
    document_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<SessionRelatedDocument>, SessionOperationError> {
    repo.disassociate_session_document(&session_id, &document_id).await
}

#[tauri::command]
pub async fn list_session_related_documents(
    session_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<SessionRelatedDocument>, SessionOperationError> {
    repo.list_session_related_documents(&session_id).await
}
