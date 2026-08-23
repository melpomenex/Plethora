pub mod auto_queue;
pub mod engine;
pub mod idle_scanner;
pub mod job_queue;
pub mod model_manager;

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
    let manager = ModelManager::new(&app_handle)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    let mut profiles = manager.list_profiles();
    // Merge user-installed Hugging Face STT models (whisper ggml + sherpa-onnx)
    // into the picker so they are selectable without a fresh download.
    let hf_profiles = crate::models::hf::manager::hf_stt_profiles(repo.pool()).await;
    profiles.extend(hf_profiles);
    Ok(profiles)
}

#[command]
pub async fn download_transcription_model(app_handle: AppHandle, id: String) -> Result<()> {
    let manager = ModelManager::new(&app_handle)
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))?;
    manager
        .download_model(&id, app_handle)
        .await
        .map_err(|e| crate::error::PlethoraError::Internal(e.to_string()))
}

#[command]
pub async fn delete_transcription_model(app_handle: AppHandle, id: String) -> Result<()> {
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
        let segments: Vec<engine::TranscriptSegment> = sqlx::query_as("SELECT start_ms, end_ms, text, confidence FROM transcript_segments WHERE transcript_id = ? ORDER BY start_ms")
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
        sqlx::query("INSERT INTO transcript_segments (transcript_id, start_ms, end_ms, text, confidence) VALUES (?, ?, ?, ?, ?)")
            .bind(transcript_id)
            .bind(seg.start_ms)
            .bind(seg.end_ms)
            .bind(&seg.text)
            .bind(seg.confidence)
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
