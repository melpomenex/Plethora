//! Asynchronous compatibility jobs.
//!
//! Jobs are Rust-owned so navigating between documents does not cancel an
//! in-flight preparation. At most one video transcode and two light jobs run at
//! once; duplicate cache keys share a job.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::Emitter;
use tokio::sync::{mpsc, watch, Semaphore};

use super::cache::{self, CacheManifest};
use super::capabilities;
use super::commands::{authorized_document_path, inspect_authorized};
use super::decision;
use super::ffmpeg;
use super::types::{
    JobOutput, JobProgress, MediaCacheUsage, MediaCompatError, MediaCompatibilityJobEvent,
    MediaCompatibilityJobPhase, MediaCompatibilityJobState, MediaFailureCode, MediaInspection,
    MediaPlaybackPlan, MediaProcessingPolicy, PlaybackStrategy, StartMediaCompatibilityJobRequest,
};

const MAX_QUEUE: usize = 8;

#[derive(Debug)]
pub struct JobRecord {
    pub event: MediaCompatibilityJobEvent,
    pub cancel: watch::Sender<bool>,
}

#[derive(Clone)]
pub struct MediaCompatState {
    jobs: Arc<Mutex<HashMap<String, Arc<Mutex<JobRecord>>>>>,
    active_by_key: Arc<Mutex<HashMap<String, String>>>,
    active_by_document: Arc<Mutex<HashMap<String, String>>>,
    video_sem: Arc<Semaphore>,
    light_sem: Arc<Semaphore>,
}

impl Default for MediaCompatState {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaCompatState {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            active_by_key: Arc::new(Mutex::new(HashMap::new())),
            active_by_document: Arc::new(Mutex::new(HashMap::new())),
            video_sem: Arc::new(Semaphore::new(1)),
            light_sem: Arc::new(Semaphore::new(2)),
        }
    }

    pub fn get(&self, job_id: &str) -> Option<MediaCompatibilityJobEvent> {
        self.jobs
            .lock()
            .ok()?
            .get(job_id)
            .and_then(|record| record.lock().ok().map(|record| record.event.clone()))
    }

    pub fn list(&self, document_id: Option<&str>) -> Vec<MediaCompatibilityJobEvent> {
        let Ok(jobs) = self.jobs.lock() else {
            return Vec::new();
        };
        let mut events: Vec<_> = jobs
            .values()
            .filter_map(|record| record.lock().ok().map(|record| record.event.clone()))
            .filter(|event| {
                document_id
                    .map(|document_id| event.document_id == document_id)
                    .unwrap_or(true)
            })
            .collect();
        events.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        events
    }

    pub fn cancel(&self, job_id: &str) -> Result<MediaCompatibilityJobEvent, MediaCompatError> {
        let record = self
            .jobs
            .lock()
            .ok()
            .and_then(|jobs| jobs.get(job_id).cloned())
            .ok_or_else(|| {
                MediaCompatError::new(
                    MediaFailureCode::ConversionCancelled,
                    "The preparation job does not exist.",
                )
            })?;
        let _ = record.lock().map(|record| record.cancel.send(true));
        record
            .lock()
            .map(|record| record.event.clone())
            .map_err(|_| {
                MediaCompatError::new(
                    MediaFailureCode::ConversionCancelled,
                    "The preparation job is unavailable.",
                )
            })
    }
}

fn failure_for_reason(reason: &str) -> MediaCompatError {
    let code = match reason {
        "ffmpeg_missing" | "ffprobe_missing" => MediaFailureCode::ConversionDependencyMissing,
        "encoder_missing" => MediaFailureCode::ConversionEncoderMissing,
        "filter_missing" => MediaFailureCode::ConversionFilterMissing,
        "cache_limit_too_small" | "insufficient_storage" => MediaFailureCode::InsufficientStorage,
        "dolby_vision_profile5" => MediaFailureCode::DolbyVisionUnsupported,
        "protected_media" => MediaFailureCode::UnsupportedProtectedMedia,
        "media_corrupt" => MediaFailureCode::MediaCorrupt,
        "platform_unsupported" => MediaFailureCode::ConversionPlatformUnsupported,
        "policy_never" => MediaFailureCode::ConversionRequiresConsent,
        _ => MediaFailureCode::ConversionFailed,
    };
    MediaCompatError::new(code, "This video cannot be prepared for playback.").with_detail(reason)
}

fn event_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn emit(app: &tauri::AppHandle, event: &MediaCompatibilityJobEvent) {
    let _ = app.emit("media-compat:job", event);
}

fn update_event<F>(
    record: &Arc<Mutex<JobRecord>>,
    app: &tauri::AppHandle,
    mutate: F,
) -> MediaCompatibilityJobEvent
where
    F: FnOnce(&mut MediaCompatibilityJobEvent),
{
    let event = if let Ok(mut record) = record.lock() {
        record.event.sequence = record.event.sequence.saturating_add(1);
        record.event.updated_at = event_timestamp();
        mutate(&mut record.event);
        record.event.clone()
    } else {
        return MediaCompatibilityJobEvent::default();
    };
    emit(app, &event);
    event
}

fn ready_event(job_id: &str, document_id: &str, cache_key: &str, artifact: super::types::CachedArtifact) -> MediaCompatibilityJobEvent {
    let now = event_timestamp();
    MediaCompatibilityJobEvent {
        schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
        job_id: job_id.to_string(),
        document_id: document_id.to_string(),
        cache_key: cache_key.to_string(),
        sequence: 0,
        state: MediaCompatibilityJobState::Ready,
        phase: MediaCompatibilityJobPhase::Done,
        progress: JobProgress {
            percent: Some(100.0),
            ..Default::default()
        },
        output: Some(JobOutput {
            cache_key: cache_key.to_string(),
            output_container: artifact.output_container,
            duration_seconds: artifact.duration_seconds,
            size_bytes: artifact.size_bytes,
            timeline_offset_seconds: artifact.timeline_offset_seconds,
        }),
        error: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

fn cleanup_staging(root: &std::path::Path, job_id: &str) {
    let _ = std::fs::remove_dir_all(cache::staging_dir(root, job_id));
}

fn finish_active(state: &MediaCompatState, job_id: &str, cache_key: &str, document_id: &str) {
    if let Ok(mut active) = state.active_by_key.lock() {
        if active.get(cache_key).map(|id| id == job_id).unwrap_or(false) {
            active.remove(cache_key);
        }
    }
    if let Ok(mut active) = state.active_by_document.lock() {
        if active.get(document_id).map(|id| id == job_id).unwrap_or(false) {
            active.remove(document_id);
        }
    }
    if let Ok(mut jobs) = state.jobs.lock() {
        jobs.remove(job_id);
    }
}

pub async fn start(
    state: MediaCompatState,
    app: tauri::AppHandle,
    repo: crate::database::Repository,
    request: StartMediaCompatibilityJobRequest,
) -> Result<MediaCompatibilityJobEvent, MediaCompatError> {
    let canonical = authorized_document_path(
        &app,
        &repo,
        &request.document_id,
        &request.file_path,
    )
    .await?;
    let inspection = inspect_authorized(&canonical, Some(&request.document_id), &repo).await?;
    let capabilities = capabilities::detect(false).await;
    let plan = decision::plan(
        &request.document_id,
        &inspection,
        &capabilities,
        &request.client_support,
        request.policy,
        request.recovery.as_ref(),
        None,
    );

    if plan.strategy == PlaybackStrategy::Native || plan.strategy == PlaybackStrategy::Unavailable {
        if let Some(reason) = plan.unavailable_reason.as_deref() {
            return Err(failure_for_reason(reason));
        }
        return Err(MediaCompatError::new(
            MediaFailureCode::ConversionFailed,
            "This video does not need preparation.",
        ));
    }
    if !plan.can_convert {
        return Err(failure_for_reason(
            plan.unavailable_reason.as_deref().unwrap_or("conversion_unavailable"),
        ));
    }
    if plan.requires_consent && !request.consent_granted {
        return Err(MediaCompatError::new(
            MediaFailureCode::ConversionRequiresConsent,
            "This conversion needs your confirmation.",
        ));
    }

    let root = cache::cache_root(&app)?;
    let cache_key = cache::cache_key(&request.document_id, &canonical, &inspection, &plan);
    if let Some(artifact) = cache::validate(
        &root,
        &cache_key,
        &inspection.source.fingerprint,
        &decision::inspection_hash(&inspection),
    ) {
        if let Some(manifest) = cache::read_manifest(&root, &cache_key) {
            let output_path = cache::artifact_dir(&root, &cache_key).join(&manifest.output_file);
            let _ = crate::database::media_compat_repository::upsert_artifact(
                &repo,
                &cache_key,
                &request.document_id,
                &canonical.to_string_lossy(),
                &manifest.source_fingerprint,
                &manifest.inspection_hash,
                &serde_json::to_string(&manifest.plan).unwrap_or_default(),
                &output_path.to_string_lossy(),
                &manifest.output_container,
                manifest.size_bytes as i64,
                manifest.duration_seconds,
                "ready",
            )
            .await;
        }
        let _ = crate::database::media_compat_repository::touch_artifact(&repo, &cache_key).await;
        return Ok(ready_event(&format!("cache-{cache_key}"), &request.document_id, &cache_key, artifact));
    }

    if let Ok(active) = state.active_by_key.lock() {
        if let Some(job_id) = active.get(&cache_key) {
            if let Some(event) = state.get(job_id) {
                return Ok(event);
            }
        }
    }
    if let Ok(active) = state.active_by_document.lock() {
        if let Some(job_id) = active.get(&request.document_id) {
            if let Some(event) = state.get(job_id) {
                return Ok(event);
            }
        }
    }
    if state.jobs.lock().map(|jobs| jobs.len()).unwrap_or(0) >= MAX_QUEUE {
        return Err(MediaCompatError::new(
            MediaFailureCode::ConversionQueueFull,
            "Too many videos are being prepared.",
        ));
    }

    let job_id = uuid::Uuid::new_v4().to_string();
    let (cancel, cancel_rx) = watch::channel(false);
    let now = event_timestamp();
    let event = MediaCompatibilityJobEvent {
        schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
        job_id: job_id.clone(),
        document_id: request.document_id.clone(),
        cache_key: cache_key.clone(),
        sequence: 0,
        state: MediaCompatibilityJobState::Queued,
        phase: MediaCompatibilityJobPhase::Queued,
        progress: JobProgress::default(),
        output: None,
        error: None,
        created_at: now.clone(),
        updated_at: now,
    };
    let record = Arc::new(Mutex::new(JobRecord { event: event.clone(), cancel }));
    if let Ok(mut jobs) = state.jobs.lock() {
        jobs.insert(job_id.clone(), record.clone());
    }
    if let Ok(mut active) = state.active_by_key.lock() {
        active.insert(cache_key.clone(), job_id.clone());
    }
    if let Ok(mut active) = state.active_by_document.lock() {
        active.insert(request.document_id.clone(), job_id.clone());
    }

    let task_state = state.clone();
    let task_app = app.clone();
    let task_repo = repo.clone();
    let task_plan = plan;
    let task_inspection = inspection;
    let task_cache_key = cache_key.clone();
    let task_document_id = request.document_id.clone();
    let task_job_id = job_id.clone();
    tokio::spawn(async move {
        let semaphore = if task_plan.strategy == PlaybackStrategy::VideoTranscode {
            task_state.video_sem.clone()
        } else {
            task_state.light_sem.clone()
        };
        let permit = tokio::select! {
            permit = semaphore.acquire_owned() => permit.ok(),
            _ = wait_cancelled(cancel_rx.clone()) => None,
        };
        let Some(_permit) = permit else {
            cleanup_staging(&root, &task_job_id);
            update_event(&record, &task_app, |event| {
                event.state = MediaCompatibilityJobState::Cancelled;
                event.phase = MediaCompatibilityJobPhase::Failed;
            });
            finish_active(&task_state, &task_job_id, &task_cache_key, &task_document_id);
            return;
        };
        if *cancel_rx.borrow() {
            update_event(&record, &task_app, |event| {
                event.state = MediaCompatibilityJobState::Cancelled;
                event.phase = MediaCompatibilityJobPhase::Failed;
            });
            finish_active(&task_state, &task_job_id, &task_cache_key, &task_document_id);
            return;
        }

        update_event(&record, &task_app, |event| {
            event.state = MediaCompatibilityJobState::Running;
            event.phase = MediaCompatibilityJobPhase::Preparing;
        });
        let staging = cache::staging_dir(&root, &task_job_id);
        if let Err(error) = std::fs::create_dir_all(&staging) {
            let failure = MediaCompatError::new(
                MediaFailureCode::InsufficientStorage,
                "The conversion staging directory could not be created.",
            )
            .with_detail(error.to_string());
            update_event(&record, &task_app, |event| {
                event.state = MediaCompatibilityJobState::Failed;
                event.phase = MediaCompatibilityJobPhase::Failed;
                event.error = Some(failure.clone());
            });
            finish_active(&task_state, &task_job_id, &task_cache_key, &task_document_id);
            return;
        }

        let container = task_plan.output.as_ref().map(|output| output.container.clone()).unwrap_or_else(|| "mkv".to_string());
        let output_file = format!("output.{}", cache::output_extension(&container));
        let output_path = staging.join(&output_file);
        let args = ffmpeg::build_args(&task_plan, &task_inspection, &canonical, &output_path);
        update_event(&record, &task_app, |event| {
            event.phase = MediaCompatibilityJobPhase::Encoding;
        });
        let (progress_tx, mut progress_rx) = mpsc::channel::<JobProgress>(32);
        let progress_record = record.clone();
        let progress_app = task_app.clone();
        let progress_task = tokio::spawn(async move {
            while let Some(progress) = progress_rx.recv().await {
                update_event(&progress_record, &progress_app, |event| {
                    event.progress = progress;
                });
            }
        });

        let run_result = ffmpeg::run(
            args,
            task_inspection.duration_seconds,
            cancel_rx.clone(),
            Some(progress_tx),
        )
        .await;
        let _ = progress_task.await;

        let run_result = match run_result {
            Ok(result) => result,
            Err(error) => {
                cleanup_staging(&root, &task_job_id);
                let _ = crate::database::media_compat_repository::mark_artifact_failed(
                    &task_repo,
                    &task_cache_key,
                    error.code.as_str(),
                )
                .await;
                update_event(&record, &task_app, |event| {
                    event.state = MediaCompatibilityJobState::Failed;
                    event.phase = MediaCompatibilityJobPhase::Failed;
                    event.error = Some(error.clone());
                });
                finish_active(&task_state, &task_job_id, &task_cache_key, &task_document_id);
                return;
            }
        };

        if run_result.cancelled || *cancel_rx.borrow() {
            cleanup_staging(&root, &task_job_id);
            update_event(&record, &task_app, |event| {
                event.state = MediaCompatibilityJobState::Cancelled;
                event.phase = MediaCompatibilityJobPhase::Failed;
            });
            finish_active(&task_state, &task_job_id, &task_cache_key, &task_document_id);
            return;
        }
        if run_result.exit_code != Some(0) {
            cleanup_staging(&root, &task_job_id);
            let error = MediaCompatError::new(
                MediaFailureCode::ConversionFailed,
                "FFmpeg could not prepare this video.",
            )
            .with_detail(run_result.stderr_tail);
            update_event(&record, &task_app, |event| {
                event.state = MediaCompatibilityJobState::Failed;
                event.phase = MediaCompatibilityJobPhase::Failed;
                event.error = Some(error.clone());
            });
            finish_active(&task_state, &task_job_id, &task_cache_key, &task_document_id);
            return;
        }

        update_event(&record, &task_app, |event| {
            event.state = MediaCompatibilityJobState::Finalizing;
            event.phase = MediaCompatibilityJobPhase::Verifying;
        });
        let verification = match ffmpeg::verify(&output_path, &task_inspection, &task_plan).await {
            Ok(verification) => verification,
            Err(error) => {
                cleanup_staging(&root, &task_job_id);
                update_event(&record, &task_app, |event| {
                    event.state = MediaCompatibilityJobState::Failed;
                    event.phase = MediaCompatibilityJobPhase::Failed;
                    event.error = Some(error.clone());
                });
                finish_active(&task_state, &task_job_id, &task_cache_key, &task_document_id);
                return;
            }
        };
        let size_bytes = std::fs::metadata(&output_path).map(|metadata| metadata.len()).unwrap_or(0);
        update_event(&record, &task_app, |event| {
            event.phase = MediaCompatibilityJobPhase::Publishing;
        });
        let manifest = CacheManifest {
            schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
            cache_key: task_cache_key.clone(),
            document_id: task_document_id.clone(),
            source_fingerprint: task_inspection.source.fingerprint.clone(),
            inspection_hash: decision::inspection_hash(&task_inspection),
            plan: task_plan.clone(),
            output_file: output_file.clone(),
            output_container: container.clone(),
            size_bytes,
            duration_seconds: task_inspection.duration_seconds,
            timeline_offset_seconds: 0.0,
            created_at: event_timestamp(),
            ffmpeg_version: task_inspection.tool.ffmpeg_version.clone(),
            ffprobe_version: task_inspection.tool.ffprobe_version.clone(),
            verification,
        };
        let final_dir = match cache::publish(&root, &staging, &task_cache_key, &manifest) {
            Ok(dir) => dir,
            Err(error) => {
                cleanup_staging(&root, &task_job_id);
                update_event(&record, &task_app, |event| {
                    event.state = MediaCompatibilityJobState::Failed;
                    event.phase = MediaCompatibilityJobPhase::Failed;
                    event.error = Some(error.clone());
                });
                finish_active(&task_state, &task_job_id, &task_cache_key, &task_document_id);
                return;
            }
        };
        let output_path = final_dir.join(&output_file);
        let _ = crate::database::media_compat_repository::upsert_artifact(
            &task_repo,
            &task_cache_key,
            &task_document_id,
            &canonical.to_string_lossy(),
            &task_inspection.source.fingerprint,
            &decision::inspection_hash(&task_inspection),
            &serde_json::to_string(&task_plan).unwrap_or_default(),
            &output_path.to_string_lossy(),
            &container,
            size_bytes as i64,
            task_inspection.duration_seconds,
            "ready",
        )
        .await;
        update_event(&record, &task_app, |event| {
            event.state = MediaCompatibilityJobState::Ready;
            event.phase = MediaCompatibilityJobPhase::Done;
            event.progress.percent = Some(100.0);
            event.output = Some(JobOutput {
                cache_key: task_cache_key.clone(),
                output_container: container.clone(),
                duration_seconds: task_inspection.duration_seconds,
                size_bytes,
                timeline_offset_seconds: 0.0,
            });
        });
        finish_active(&task_state, &task_job_id, &task_cache_key, &task_document_id);
    });

    Ok(event)
}

async fn wait_cancelled(mut receiver: watch::Receiver<bool>) {
    loop {
        if *receiver.borrow() {
            return;
        }
        if receiver.changed().await.is_err() {
            return;
        }
    }
}

pub fn cache_usage(app: &tauri::AppHandle) -> Result<MediaCacheUsage, MediaCompatError> {
    let root = cache::cache_root(app)?;
    Ok(cache::usage(&root))
}

pub fn prune_cache(app: &tauri::AppHandle, limit_gb: u32) -> Result<MediaCacheUsage, MediaCompatError> {
    let root = cache::cache_root(app)?;
    let limit = u64::from(limit_gb.clamp(5, 500)) * 1024 * 1024 * 1024;
    cache::prune(&root, limit)
}

pub async fn clear_cache(
    app: &tauri::AppHandle,
    repo: &crate::database::Repository,
    document_id: Option<&str>,
) -> Result<MediaCacheUsage, MediaCompatError> {
    let root = cache::cache_root(app)?;
    let before = cache::usage(&root);
    for artifact in before.artifacts {
        if document_id.map(|id| id != artifact.document_id).unwrap_or(false) {
            continue;
        }
        let _ = crate::database::media_compat_repository::delete_artifact_record(
            repo,
            &artifact.cache_key,
        )
        .await;
    }
    cache::clear(&root, document_id)
}

pub async fn artifact_url_path(
    app: &tauri::AppHandle,
    repo: &crate::database::Repository,
    document_id: &str,
    cache_key: &str,
) -> Result<PathBuf, MediaCompatError> {
    let root = cache::cache_root(app)?;
    let row = crate::database::media_compat_repository::get_artifact(repo, cache_key)
        .await
        .map_err(|error| {
            MediaCompatError::new(MediaFailureCode::SourceNotFound, "The cached artifact is unavailable.")
                .with_detail(error.to_string())
        })?
        .ok_or_else(|| {
            MediaCompatError::new(MediaFailureCode::SourceNotFound, "The cached artifact is unavailable.")
        })?;
    if row.document_id != document_id || row.state != "ready" {
        return Err(MediaCompatError::new(
            MediaFailureCode::SourcePermissionDenied,
            "The cached artifact does not belong to this document.",
        ));
    }
    let path = PathBuf::from(&row.output_path);
    let canonical_root = std::fs::canonicalize(&root).map_err(|error| {
        MediaCompatError::new(MediaFailureCode::SourceNotFound, "The cache root is unavailable.")
            .with_detail(error.to_string())
    })?;
    let canonical = std::fs::canonicalize(&path).map_err(|_| {
        MediaCompatError::new(MediaFailureCode::SourceNotFound, "The cached artifact is missing.")
    })?;
    if !canonical.starts_with(&canonical_root) {
        return Err(MediaCompatError::new(
            MediaFailureCode::SourcePermissionDenied,
            "The cached artifact path is outside approved storage.",
        ));
    }
    Ok(canonical)
}
