use std::path::PathBuf;

use super::capabilities;
use super::decision;
use super::jobs::{self, MediaCompatState};
use super::probe;
use super::transport;
use super::types::{
    CachedArtifact, MediaCacheUsage, MediaCompatError, MediaCompatibilityJobEvent,
    MediaFailureCode, MediaInspection, MediaPlaybackPlan, MediaPlaybackPlanRequest,
    MediaRuntimeCapabilities, MediaTransportProbe, StartMediaCompatibilityJobRequest,
};

fn source_error(message: String) -> MediaCompatError {
    let lower = message.to_ascii_lowercase();
    let code = if lower.contains("not found") || lower.contains("not exist") {
        MediaFailureCode::SourceNotFound
    } else if lower.contains("http 403")
        || lower.contains("not inside")
        || lower.contains("registered document")
        || lower.contains("not a regular file")
    {
        MediaFailureCode::SourcePermissionDenied
    } else {
        MediaFailureCode::SourceTransportFailed
    };
    MediaCompatError::new(code, message)
}

pub(crate) async fn authorized_document_path(
    app_handle: &tauri::AppHandle,
    repo: &crate::database::Repository,
    document_id: &str,
    file_path: &str,
) -> Result<PathBuf, MediaCompatError> {
    let (canonical, _granted) =
        crate::media_server::authorize_media_file(app_handle, file_path, repo)
            .await
            .map_err(source_error)?;

    let document = repo
        .get_document(document_id)
        .await
        .map_err(|error| {
            MediaCompatError::new(
                MediaFailureCode::SourcePermissionDenied,
                "The media document could not be verified.",
            )
            .with_detail(error.to_string())
        })?
        .ok_or_else(|| {
            MediaCompatError::new(
                MediaFailureCode::SourcePermissionDenied,
                "The media document does not exist.",
            )
        })?;
    let stored = std::fs::canonicalize(&document.file_path).map_err(|error| {
        MediaCompatError::new(
            MediaFailureCode::SourceNotFound,
            "The document's media file could not be resolved.",
        )
        .with_detail(error.to_string())
    })?;
    if stored != canonical {
        return Err(MediaCompatError::new(
            MediaFailureCode::SourcePermissionDenied,
            "The requested file does not belong to this document.",
        ));
    }
    Ok(canonical)
}

pub(crate) async fn inspect_authorized(
    canonical: &std::path::Path,
    document_id: Option<&str>,
    repo: &crate::database::Repository,
) -> Result<MediaInspection, MediaCompatError> {
    let (fingerprint, _, _) = probe::source_fingerprint(canonical).await?;
    if let Some(document_id) = document_id {
        if let Ok(Some((json, schema_version))) =
            crate::database::media_compat_repository::get_inspection(
                repo,
                document_id,
                &fingerprint,
            )
            .await
        {
            if schema_version == super::types::MEDIA_COMPAT_SCHEMA_VERSION as i64 {
                if let Ok(inspection) = serde_json::from_str::<MediaInspection>(&json) {
                    return Ok(inspection);
                }
            }
        }
    }

    let inspection = probe::inspect_path(canonical, document_id.map(ToOwned::to_owned)).await?;
    if let Some(document_id) = document_id {
        if inspection.probe_status == super::types::ProbeStatus::Ok {
            if let Ok(json) = serde_json::to_string(&inspection) {
                let _ = crate::database::media_compat_repository::upsert_inspection(
                    repo,
                    document_id,
                    &inspection.source.fingerprint,
                    &canonical.to_string_lossy(),
                    &json,
                    super::types::MEDIA_COMPAT_SCHEMA_VERSION as i64,
                )
                .await;
            }
        }
    }
    Ok(inspection)
}

/// Inspect a local video/audio document with FFprobe.
#[tauri::command]
pub async fn inspect_local_media(
    app_handle: tauri::AppHandle,
    repo: tauri::State<'_, crate::database::Repository>,
    document_id: Option<String>,
    file_path: String,
) -> Result<MediaInspection, MediaCompatError> {
    let canonical = match document_id.as_deref() {
        Some(document_id) => {
            authorized_document_path(&app_handle, &repo, document_id, &file_path).await?
        }
        None => {
            let (canonical, _granted) =
                crate::media_server::authorize_media_file(&app_handle, &file_path, &repo)
                    .await
                    .map_err(source_error)?;
            canonical
        }
    };
    inspect_authorized(&canonical, document_id.as_deref(), &repo).await
}

/// Produce the deterministic compatibility plan for a document.
#[tauri::command]
pub async fn plan_media_playback(
    app_handle: tauri::AppHandle,
    repo: tauri::State<'_, crate::database::Repository>,
    request: MediaPlaybackPlanRequest,
) -> Result<MediaPlaybackPlan, MediaCompatError> {
    let canonical =
        authorized_document_path(&app_handle, &repo, &request.document_id, &request.file_path)
            .await?;
    let inspection = inspect_authorized(&canonical, Some(&request.document_id), &repo).await?;
    if inspection.source.fingerprint != request.inspection_fingerprint
        && !request.inspection_fingerprint.is_empty()
    {
        return Err(MediaCompatError::new(
            MediaFailureCode::MediaInspectionUnavailable,
            "The media file changed after inspection.",
        )
        .with_detail("stale_inspection_fingerprint"));
    }

    let capabilities = capabilities::detect(false).await;
    let cached_artifact: Option<CachedArtifact> = None;
    Ok(decision::plan(
        &request.document_id,
        &inspection,
        &capabilities,
        &request.client_support,
        request.policy,
        request.recovery.as_ref(),
        cached_artifact,
    ))
}

/// Return the current runtime's playback capability report.
#[tauri::command]
pub async fn get_media_runtime_capabilities(
    refresh: Option<bool>,
) -> Result<MediaRuntimeCapabilities, MediaCompatError> {
    Ok(capabilities::detect(refresh.unwrap_or(false)).await)
}

/// Start (or join) an asynchronous compatibility preparation job.
#[tauri::command]
pub async fn start_media_compatibility_job(
    app_handle: tauri::AppHandle,
    repo: tauri::State<'_, crate::database::Repository>,
    state: tauri::State<'_, MediaCompatState>,
    request: StartMediaCompatibilityJobRequest,
) -> Result<MediaCompatibilityJobEvent, MediaCompatError> {
    jobs::start(
        state.inner().clone(),
        app_handle,
        repo.inner().clone(),
        request,
    )
    .await
}

#[tauri::command]
pub async fn cancel_media_compatibility_job(
    state: tauri::State<'_, MediaCompatState>,
    job_id: String,
) -> Result<MediaCompatibilityJobEvent, MediaCompatError> {
    state.cancel(&job_id)
}

#[tauri::command]
pub async fn list_media_compatibility_jobs(
    state: tauri::State<'_, MediaCompatState>,
    document_id: Option<String>,
) -> Result<Vec<MediaCompatibilityJobEvent>, MediaCompatError> {
    Ok(state.list(document_id.as_deref()))
}

#[tauri::command]
pub async fn get_media_compatibility_artifact_url(
    app_handle: tauri::AppHandle,
    repo: tauri::State<'_, crate::database::Repository>,
    document_id: String,
    cache_key: String,
) -> Result<String, MediaCompatError> {
    let path = jobs::artifact_url_path(&app_handle, &repo, &document_id, &cache_key).await?;
    let _ = crate::database::media_compat_repository::touch_artifact(&repo, &cache_key).await;
    crate::media_server::mint_stream_url(
        &app_handle,
        &path.to_string_lossy(),
        &repo,
        "media_compat",
    )
    .await
    .map_err(source_error)
}

#[tauri::command]
pub async fn get_media_compatibility_cache_usage(
    app_handle: tauri::AppHandle,
) -> Result<MediaCacheUsage, MediaCompatError> {
    jobs::cache_usage(&app_handle)
}

#[tauri::command]
pub async fn clear_media_compatibility_cache(
    app_handle: tauri::AppHandle,
    repo: tauri::State<'_, crate::database::Repository>,
    document_id: Option<String>,
) -> Result<MediaCacheUsage, MediaCompatError> {
    jobs::clear_cache(&app_handle, &repo, document_id.as_deref()).await
}

#[tauri::command]
pub async fn prune_media_compatibility_cache(
    app_handle: tauri::AppHandle,
    limit_gb: u32,
) -> Result<MediaCacheUsage, MediaCompatError> {
    jobs::prune_cache(&app_handle, limit_gb)
}

/// Diagnose whether a loopback media URL is reachable and returns bytes.
///
/// Only the app's own `http://127.0.0.1:<media_server_port>/stream` URLs are
/// accepted. This command is deliberately not a general HTTP probe.
#[tauri::command]
pub async fn probe_media_transport(url: String) -> Result<MediaTransportProbe, MediaCompatError> {
    transport::probe_media_transport(&url).await
}
