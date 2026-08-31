pub mod auto_queue;
pub mod compute_backend;
pub mod engine;
pub mod gpu_runtime;
pub mod idle_scanner;
pub mod job_queue;
pub mod model_manager;
pub mod nemotron;

use crate::database::Repository;
use crate::error::Result;
use crate::models::{
    TranscriptionJobStatus, TranscriptionQueueEntry, TranscriptionQueueEntryWithDoc,
};
use auto_queue::AutoTranscriptionQueue;
use chrono::Utc;
use job_queue::{JobQueue, TranscriptionJob};
use model_manager::{ModelManager, ModelProfile};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{command, AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptResponse {
    pub id: i64,
    pub status: String,
    pub segments: Vec<engine::TranscriptSegment>,
}

pub struct TranscriptionState {
    pub job_queue: JobQueue,
    pub auto_queue: AutoTranscriptionQueue,
}

#[command]
pub async fn get_transcription_profiles(
    app_handle: AppHandle,
    repo: State<'_, Repository>,
) -> Result<Vec<ModelProfile>> {
    use crate::models::hf::adapters::HfRuntime;
    use crate::models::hf::hf_client::resolve_download_url;
    use crate::models::hf::manager::{
        hf_stt_profiles, is_nemotron_asr_installed, model_id_for, nemotron_asr_catalog_entry,
        NEMOTRON_ASR_ENCODER_FILE, NEMOTRON_ASR_LOGICAL_KEY, NEMOTRON_ASR_REPO_ID,
        NEMOTRON_ASR_REVISION, NEMOTRON_ASR_SIZE_BYTES,
    };

    let manager = ModelManager::new(&app_handle)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    let mut profiles = manager.list_profiles();

    let catalog = nemotron_asr_catalog_entry();
    profiles.push(ModelProfile {
        id: NEMOTRON_ASR_LOGICAL_KEY.to_string(),
        name: catalog.display_name,
        description: "Multilingual streaming ASR (int8 ONNX, runs on-device via sherpa-onnx). Matches cloud OpenRouter Nemotron for prefer-local routing.".to_string(),
        url: resolve_download_url(
            NEMOTRON_ASR_REPO_ID,
            NEMOTRON_ASR_REVISION,
            NEMOTRON_ASR_ENCODER_FILE,
        ),
        sha256: String::new(),
        size_bytes: NEMOTRON_ASR_SIZE_BYTES,
        // Truthful availability: installed AND the streaming sidecar is
        // usable, so prefer-local routing never targets a dead end (falls
        // back to cloud per the existing resolution rules instead).
        installed: is_nemotron_asr_installed(repo.pool()).await
            && crate::transcription::engine::TranscriptionEngine::sidecar_usable(
                &app_handle,
                "sherpa-online",
            ),
    });

    let nemotron_hf_id = model_id_for(
        HfRuntime::NemotronAsr,
        NEMOTRON_ASR_REPO_ID,
        NEMOTRON_ASR_REVISION,
    );
    let hf_profiles = hf_stt_profiles(repo.pool())
        .await
        .into_iter()
        .filter(|p| p.id != nemotron_hf_id)
        .collect::<Vec<_>>();
    profiles.extend(hf_profiles);
    Ok(profiles)
}

#[command]
pub async fn download_transcription_model(
    app_handle: AppHandle,
    repo: State<'_, Repository>,
    id: String,
) -> Result<()> {
    use crate::models::hf::commands::active_try_register;
    use crate::models::hf::manager::{
        install_pinned_nemotron_asr, is_pinned_nemotron_repo, model_id_for,
        NEMOTRON_ASR_LOGICAL_KEY, NEMOTRON_ASR_REPO_ID, NEMOTRON_ASR_REVISION,
    };
    use crate::models::hf::adapters::HfRuntime;

    if is_pinned_nemotron_repo(&id) {
        let cancel = CancellationToken::new();
        let hf_id = model_id_for(
            HfRuntime::NemotronAsr,
            NEMOTRON_ASR_REPO_ID,
            NEMOTRON_ASR_REVISION,
        );
        // Same in-flight key as `hf_install_model`, so a Nemotron download
        // started from either surface can never run twice concurrently.
        let _guard = active_try_register(&app_handle, &hf_id, cancel.clone()).map_err(|e| {
            // Keep the user-facing phrasing model-id-free.
            crate::error::PlethoraError::Internal(e.to_string().replace(&hf_id, "Nemotron ASR"))
        })?;
        let result = install_pinned_nemotron_asr(
            &app_handle,
            &repo,
            Some(NEMOTRON_ASR_LOGICAL_KEY),
            cancel.clone(),
        )
        .await;
        result.map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
        // Out-of-the-box GPU: the user just committed to local STT — if this
        // machine has a supported NVIDIA GPU, start provisioning the GPU
        // runtime now (no-op otherwise; guarded against duplicates).
        gpu_runtime::ensure_installed(&app_handle);
        let _ = app_handle.emit(
            "transcription://download-complete",
            NEMOTRON_ASR_LOGICAL_KEY.to_string(),
        );
        return Ok(());
    }

    let manager = ModelManager::new(&app_handle)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    manager
        .download_model(&id, app_handle)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn delete_transcription_model(
    app_handle: AppHandle,
    repo: State<'_, Repository>,
    id: String,
) -> Result<()> {
    use crate::models::hf::adapters::HfRuntime;
    use crate::models::hf::manager::{
        is_pinned_nemotron_repo, model_id_for, uninstall, NEMOTRON_ASR_LOGICAL_KEY,
        NEMOTRON_ASR_REPO_ID, NEMOTRON_ASR_REVISION,
    };

    if is_pinned_nemotron_repo(&id) {
        let hf_id = model_id_for(
            HfRuntime::NemotronAsr,
            NEMOTRON_ASR_REPO_ID,
            NEMOTRON_ASR_REVISION,
        );
        return uninstall(&app_handle, &repo, &hf_id)
            .await
            .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()));
    }

    let manager = ModelManager::new(&app_handle)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    manager
        .delete_model(&id)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn start_transcription(
    state: State<'_, TranscriptionState>,
    book_id: String,
    chapter_id: String,
    audio_path: String,
    model_id: String,
    language: String,
) -> Result<()> {
    let job = TranscriptionJob {
        book_id,
        chapter_id,
        audio_path,
        model_id,
        language,
    };
    state
        .job_queue
        .enqueue(job)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn get_transcript(
    repo: State<'_, Repository>,
    book_id: String,
    chapter_id: String,
) -> Result<Option<TranscriptResponse>> {
    let transcript: Option<(i64, String)> =
        sqlx::query_as("SELECT id, status FROM transcripts WHERE book_id = ? AND chapter_id = ?")
            .bind(&book_id)
            .bind(&chapter_id)
            .fetch_optional(repo.pool())
            .await?;

    if let Some((id, status)) = transcript {
        let segments: Vec<engine::TranscriptSegment> = sqlx::query_as("SELECT start_ms, end_ms, text, confidence, words_json FROM transcript_segments WHERE transcript_id = ? ORDER BY start_ms")
            .bind(id)
            .fetch_all(repo.pool())
            .await?;

        Ok(Some(TranscriptResponse {
            id,
            status,
            segments,
        }))
    } else {
        Ok(None)
    }
}

#[command]
pub async fn save_transcript(
    repo: State<'_, Repository>,
    book_id: String,
    chapter_id: String,
    model_used: String,
    language: String,
    status: String,
    segments: Vec<engine::TranscriptSegment>,
) -> Result<()> {
    let mut tx = repo
        .pool()
        .begin()
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;

    sqlx::query("INSERT OR REPLACE INTO transcripts (book_id, chapter_id, model_used, language, status) VALUES (?, ?, ?, ?, ?)")
        .bind(&book_id)
        .bind(&chapter_id)
        .bind(&model_used)
        .bind(&language)
        .bind(&status)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;

    let transcript_id: i64 =
        sqlx::query_scalar("SELECT id FROM transcripts WHERE book_id = ? AND chapter_id = ?")
            .bind(&book_id)
            .bind(&chapter_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;

    sqlx::query("DELETE FROM transcript_segments WHERE transcript_id = ?")
        .bind(transcript_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;

    for seg in segments {
        sqlx::query("INSERT INTO transcript_segments (transcript_id, start_ms, end_ms, text, confidence, words_json) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(transcript_id)
            .bind(seg.start_ms)
            .bind(seg.end_ms)
            .bind(&seg.text)
            .bind(seg.confidence)
            .bind(seg.words_json.as_deref())
            .execute(&mut *tx)
            .await
            .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;

    Ok(())
}

// Auto-transcription commands

#[command]
pub async fn enqueue_auto_transcription(
    state: State<'_, TranscriptionState>,
    repo: State<'_, Repository>,
    document_id: String,
    audio_path: String,
    provider: String,
    model_id: String,
    language: String,
    priority: Option<i32>,
    chapter_id: Option<String>,
    transcription_mode: Option<String>,
) -> Result<()> {
    if !Path::new(&audio_path).exists() {
        return Err(crate::error::PlethoraError::NotFound(format!(
            "Audio file not found: {}",
            audio_path
        )));
    }

    let target_chapter_id = chapter_id.as_deref().unwrap_or(&document_id);

    // Do not duplicate active work. A completed queue row only blocks the same
    // transcript target when that transcript is actually complete; this lets a
    // legacy partial transcript acquire its first durable queue entry.
    let existing = repo
        .get_transcription_queue_entry(&document_id)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    if let Some(entry) = existing {
        if entry.status == TranscriptionJobStatus::Pending
            || entry.status == TranscriptionJobStatus::Processing
        {
            return Ok(());
        }
        if entry.status == TranscriptionJobStatus::Completed
            && entry.transcript_chapter_id() == target_chapter_id
        {
            let completed: Option<String> = sqlx::query_scalar(
                "SELECT status FROM transcripts WHERE book_id = ? AND chapter_id = ?",
            )
            .bind(&document_id)
            .bind(target_chapter_id)
            .fetch_optional(repo.pool())
            .await?;
            if completed.as_deref() == Some("completed") {
                return Ok(());
            }
        }
    }

    let mut entry =
        TranscriptionQueueEntry::new(document_id, audio_path, provider, model_id, language);
    entry.chapter_id = chapter_id;
    if let Some(mode) = transcription_mode {
        entry.transcription_mode = mode;
    }
    let entry = TranscriptionQueueEntry {
        priority: priority.unwrap_or(0),
        ..entry
    };
    state
        .auto_queue
        .enqueue(entry)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn get_transcription_queue(
    repo: State<'_, Repository>,
) -> Result<Vec<TranscriptionQueueEntryWithDoc>> {
    repo.get_full_transcription_queue()
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn cancel_transcription_job(
    app: AppHandle,
    state: State<'_, TranscriptionState>,
    repo: State<'_, Repository>,
    id: String,
) -> Result<()> {
    let _ = plethora_apple_intelligence::speech_cancel_via_app(&app);
    repo.cancel_transcription_job(&id)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    state
        .auto_queue
        .cancel(id)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn retry_transcription_job(
    repo: State<'_, Repository>,
    state: State<'_, TranscriptionState>,
    id: String,
) -> Result<()> {
    repo.reset_transcription_to_pending(&id, 0)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    state
        .auto_queue
        .trigger_processing()
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn prioritize_transcription_job(
    repo: State<'_, Repository>,
    state: State<'_, TranscriptionState>,
    id: String,
) -> Result<()> {
    sqlx::query("UPDATE transcription_queue SET priority = 10 WHERE id = ?1")
        .bind(&id)
        .execute(repo.pool())
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    state
        .auto_queue
        .trigger_processing()
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn get_transcription_status(
    repo: State<'_, Repository>,
    document_id: String,
) -> Result<Option<TranscriptionQueueEntry>> {
    repo.get_transcription_queue_entry(&document_id)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EnqueueAllResult {
    pub enqueued: u32,
    pub skipped: Vec<SkippedEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SkippedEntry {
    pub title: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UntranscribedMediaDocument {
    pub id: String,
    pub title: String,
    pub file_path: String,
}

#[command]
pub async fn get_untranscribed_media_documents(
    repo: State<'_, Repository>,
) -> Result<Vec<UntranscribedMediaDocument>> {
    Ok(repo
        .get_untranscribed_media_documents()
        .await?
        .into_iter()
        .map(|(id, title, file_path)| UntranscribedMediaDocument {
            id,
            title,
            file_path,
        })
        .collect())
}

#[command]
pub async fn enqueue_all_untranscribed(
    repo: State<'_, Repository>,
    state: State<'_, TranscriptionState>,
    provider: String,
    model_id: String,
    language: String,
) -> Result<EnqueueAllResult> {
    let untranscribed = repo
        .get_untranscribed_media_documents()
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;

    let mut enqueued = 0u32;
    let mut skipped = Vec::new();

    for (doc_id, title, file_path) in untranscribed {
        if !Path::new(&file_path).exists() {
            skipped.push(SkippedEntry {
                title,
                reason: format!("File not found: {}", file_path),
            });
            continue;
        }

        let entry = TranscriptionQueueEntry::new(
            doc_id,
            file_path,
            provider.clone(),
            model_id.clone(),
            language.clone(),
        );
        if state.auto_queue.enqueue(entry).is_ok() {
            enqueued += 1;
        }
    }

    Ok(EnqueueAllResult { enqueued, skipped })
}

#[command]
pub async fn clear_transcription_queue(
    repo: State<'_, Repository>,
    app_handle: AppHandle,
    statuses: Vec<String>,
) -> Result<u64> {
    let deleted = repo
        .delete_transcription_queue_by_status(&statuses)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    let _ = app_handle.emit("transcription://queue-updated", ());
    Ok(deleted)
}

#[command]
pub async fn remove_transcription_entry(
    repo: State<'_, Repository>,
    app_handle: AppHandle,
    id: String,
) -> Result<()> {
    repo.delete_transcription_queue_entry(&id)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    let _ = app_handle.emit("transcription://queue-updated", ());
    Ok(())
}

#[command]
pub async fn is_local_nemotron_installed(
    app_handle: AppHandle,
    repo: State<'_, Repository>,
) -> Result<bool> {
    Ok(crate::models::hf::manager::is_nemotron_asr_installed(repo.pool()).await
        && crate::transcription::engine::TranscriptionEngine::sidecar_usable(
            &app_handle,
            "sherpa-online",
        ))
}

#[command]
pub async fn transcribe_local_nemotron(
    app_handle: AppHandle,
    repo: State<'_, Repository>,
    audio_path: String,
    language: String,
) -> Result<TranscriptResponse> {
    use crate::models::hf::manager::SttEngineRoute;
    use crate::transcription::engine::TranscriptionEngine;

    if !Path::new(&audio_path).exists() {
        return Err(crate::error::PlethoraError::NotFound(format!(
            "Audio file not found: {}",
            audio_path
        )));
    }

    if !crate::models::hf::manager::is_nemotron_asr_installed(repo.pool()).await {
        return Err(crate::error::PlethoraError::InvalidInput(
            "LOCAL_MODEL_MISSING: Local Nemotron ASR is not installed. Install it from Local \
             Models or use cloud OpenRouter Nemotron."
                .to_string(),
        ));
    }

    let model_id = crate::models::hf::manager::model_id_for(
        crate::models::hf::adapters::HfRuntime::NemotronAsr,
        crate::models::hf::manager::NEMOTRON_ASR_REPO_ID,
        crate::models::hf::manager::NEMOTRON_ASR_REVISION,
    );
    let Some((install_dir, contract)) =
        crate::models::hf::manager::resolve_installed_nemotron(repo.pool(), &model_id).await
    else {
        return Err(crate::error::PlethoraError::InvalidInput(
            "LOCAL_MODEL_MISSING: Nemotron install metadata is missing.".to_string(),
        ));
    };

    let route = match contract {
        crate::models::hf::adapters::RunContract::NemotronAsr {
            encoder,
            decoder,
            joiner,
            tokens,
        } => SttEngineRoute::Nemotron {
            encoder,
            decoder,
            joiner,
            tokens,
        },
        _ => {
            return Err(crate::error::PlethoraError::InvalidInput(
                "LOCAL_MODEL_MISSING: Invalid Nemotron run contract.".to_string(),
            ));
        }
    };

    let engine = TranscriptionEngine::new(app_handle);
    // Convert to the 16 kHz mono WAV the sherpa runtime expects (same as the
    // podcast pipeline).
    let prepared = engine
        .prepare_audio(Path::new(&audio_path))
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    let segments: Vec<engine::TranscriptSegment> =
        engine.transcribe_route_collect(&prepared, &install_dir, &route, &language)
            .await
            .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    let _ = std::fs::remove_file(&prepared);

    Ok(TranscriptResponse {
        id: 0,
        status: "complete".to_string(),
        segments,
    })
}

#[command]
pub async fn transcription_compute_diagnostics(
    app_handle: AppHandle,
) -> Result<compute_backend::ComputeDiagnosticsReport> {
    use compute_backend::*;

    let hw = detect_hardware();
    let gpu = gpu_runtime::evaluate(&app_handle);
    let engine = engine::TranscriptionEngine::new(app_handle);
    let bin_dir = engine.sidecar_bin_dir();
    let runtime = probe_runtime_capabilities(bin_dir.as_deref(), Some(&gpu));

    // Sample default model capabilities for Nemotron & Whisper
    let model_compatibilities = vec![
        ModelCapabilities {
            model_id: "nemotron-3.5-asr-0.6b".to_string(),
            supported_backends: vec![
                ComputeBackend::Cuda,
                ComputeBackend::CoreMl,
                ComputeBackend::DirectMl,
                ComputeBackend::Cpu,
            ],
            min_vram_bytes: Some(1500 * 1024 * 1024),
        },
        ModelCapabilities {
            model_id: "whisper-base".to_string(),
            supported_backends: vec![
                ComputeBackend::Cuda,
                ComputeBackend::Metal,
                ComputeBackend::Vulkan,
                ComputeBackend::Cpu,
            ],
            min_vram_bytes: Some(1024 * 1024 * 1024),
        },
    ];

    let health = get_health_cache();
    let mut health_degraded_backends = std::collections::HashMap::new();
    for backend in [
        ComputeBackend::Cuda,
        ComputeBackend::CoreMl,
        ComputeBackend::DirectMl,
        ComputeBackend::Metal,
        ComputeBackend::Vulkan,
    ] {
        if let Some(reason) = health.is_degraded(backend) {
            health_degraded_backends.insert(backend.to_string(), reason);
        }
    }

    Ok(ComputeDiagnosticsReport {
        hardware: hw,
        runtime,
        active_compute_mode: TranscriptionComputeMode::Auto,
        model_compatibilities,
        health_degraded_backends,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// GPU runtime (out-of-the-box NVIDIA acceleration for local STT)
// ─────────────────────────────────────────────────────────────────────────────

/// Current GPU runtime state for the settings card. Pure read.
#[command]
pub async fn gpu_runtime_status(
    app_handle: AppHandle,
) -> Result<gpu_runtime::GpuRuntimeStatus> {
    Ok(gpu_runtime::evaluate(&app_handle))
}

/// Download + provision the GPU runtime (long-running; progress arrives on
/// `gpu-runtime://install-progress`, cancel via `gpu_runtime_install_cancel`).
#[command]
pub async fn gpu_runtime_install(app_handle: AppHandle) -> Result<()> {
    let cancel = CancellationToken::new();
    gpu_runtime::install(&app_handle, cancel)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

/// Cancel an in-flight GPU runtime install (idempotent).
#[command]
pub async fn gpu_runtime_install_cancel(app_handle: AppHandle) -> Result<()> {
    gpu_runtime::cancel_install(&app_handle);
    Ok(())
}

/// Remove the provisioned GPU runtime; local STT returns to the bundled CPU
/// sidecar (and can be re-provisioned at any time).
#[command]
pub async fn gpu_runtime_uninstall(app_handle: AppHandle) -> Result<()> {
    gpu_runtime::uninstall(&app_handle)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

