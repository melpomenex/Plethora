use super::engine::{TranscriptSegment, TranscriptionEngine};
use super::model_manager::ModelManager;
use crate::database::Repository;
use crate::models::{TranscriptionJobStatus, TranscriptionQueueEntry};
use sqlx::{QueryBuilder, Sqlite};
use std::sync::{
    atomic::{AtomicI32, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

enum AutoQueueCommand {
    Enqueue(TranscriptionQueueEntry),
    Process,
    Cancel(String),
    Shutdown,
}

pub struct AutoTranscriptionQueue {
    sender: mpsc::UnboundedSender<AutoQueueCommand>,
    active_job_id: Arc<Mutex<Option<String>>>,
}

impl AutoTranscriptionQueue {
    pub fn new(app_handle: AppHandle, repo: Repository) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<AutoQueueCommand>();
        let active_job_id = Arc::new(Mutex::new(None));
        let active_inner = active_job_id.clone();

        let app = app_handle.clone();
        tokio::spawn(async move {
            // On startup, reset any processing jobs back to pending
            if let Err(e) = repo.reset_processing_transcriptions().await {
                tracing::warn!("Failed to reset processing transcriptions: {}", e);
            }

            // Interrupted jobs already contain durable audio/model/chapter
            // metadata. Wake the queue immediately instead of leaving them
            // pending until an unrelated enqueue happens later.
            if let Err(e) = Self::process_next(&repo, &app, &active_inner).await {
                tracing::warn!("Failed to resume transcription queue on startup: {}", e);
            }

            loop {
                tokio::select! {
                    Some(cmd) = rx.recv() => {
                        match cmd {
                            AutoQueueCommand::Shutdown => break,
                            AutoQueueCommand::Enqueue(entry) => {
                                if let Err(e) = repo.enqueue_transcription(&entry).await {
                                    tracing::warn!("Failed to enqueue transcription: {}", e);
                                    continue;
                                }
                                if let Err(e) = app.emit("transcription://queue-updated", ()) {
                                    tracing::debug!("Failed to emit queue-updated: {}", e);
                                }
                                if active_inner.lock().expect("auto queue mutex poisoned").is_none() {
                                    if let Err(e) = Self::process_next(&repo, &app, &active_inner).await {
                                        tracing::warn!("Auto-transcription process error: {}", e);
                                    }
                                }
                            }
                            AutoQueueCommand::Process => {
                                if active_inner.lock().expect("auto queue mutex poisoned").is_none() {
                                    if let Err(e) = Self::process_next(&repo, &app, &active_inner).await {
                                        tracing::warn!("Auto-transcription process error: {}", e);
                                    }
                                }
                            }
                            AutoQueueCommand::Cancel(id) => {
                                if let Err(e) = repo.cancel_transcription_job(&id).await {
                                    tracing::warn!("Failed to cancel transcription job: {}", e);
                                }
                                let mut active = active_inner.lock().expect("auto queue mutex poisoned");
                                if let Some(ref active_id) = *active {
                                    if active_id == &id {
                                        *active = None;
                                    }
                                }
                                if let Err(e) = app.emit("transcription://queue-updated", ()) {
                                    tracing::debug!("Failed to emit queue-updated: {}", e);
                                }
                            }
                        }
                    }
                }
            }
        });

        Self {
            sender: tx,
            active_job_id,
        }
    }

    pub fn enqueue(&self, entry: TranscriptionQueueEntry) -> Result<(), String> {
        self.sender
            .send(AutoQueueCommand::Enqueue(entry))
            .map_err(|e| format!("Failed to enqueue: {}", e))
    }

    pub fn trigger_processing(&self) -> Result<(), String> {
        self.sender
            .send(AutoQueueCommand::Process)
            .map_err(|e| format!("Failed to trigger processing: {}", e))
    }

    pub fn cancel(&self, id: String) -> Result<(), String> {
        self.sender
            .send(AutoQueueCommand::Cancel(id))
            .map_err(|e| format!("Failed to cancel: {}", e))
    }

    pub fn active_job_id(&self) -> Option<String> {
        self.active_job_id
            .lock()
            .expect("auto queue mutex poisoned")
            .clone()
    }

    async fn process_next(
        repo: &Repository,
        app: &AppHandle,
        active_job_id: &Arc<Mutex<Option<String>>>,
    ) -> anyhow::Result<()> {
        let entry = repo.dequeue_next_transcription().await?;

        let entry = match entry {
            Some(e) => e,
            None => return Ok(()),
        };

        repo.update_transcription_status(
            &entry.id,
            TranscriptionJobStatus::Processing,
            None,
            Some(entry.progress),
        )
        .await?;
        {
            let mut active = active_job_id.lock().expect("auto queue mutex poisoned");
            *active = Some(entry.id.clone());
        }
        if let Err(e) = app.emit("transcription://queue-updated", ()) {
            tracing::debug!("Failed to emit queue-updated: {}", e);
        }

        let result = Self::process_entry(&entry, repo, app).await;

        match result {
            Ok(()) => {
                repo.update_transcription_status(
                    &entry.id,
                    TranscriptionJobStatus::Completed,
                    None,
                    Some(100),
                )
                .await?;
            }
            Err(e) => {
                let err_str = e.to_string();
                repo.update_transcription_status(
                    &entry.id,
                    TranscriptionJobStatus::Failed,
                    Some(&err_str),
                    None,
                )
                .await?;

                // Retry logic
                let updated = repo
                    .get_transcription_queue_entry(&entry.document_id)
                    .await?;
                if let Some(updated_entry) = updated {
                    if updated_entry.retry_count < 3 {
                        repo.reset_transcription_to_pending(&entry.id, updated_entry.retry_count)
                            .await?;
                    }
                }
            }
        }

        {
            let mut active = active_job_id.lock().expect("auto queue mutex poisoned");
            *active = None;
        }
        if let Err(e) = app.emit("transcription://queue-updated", ()) {
            tracing::debug!("Failed to emit queue-updated: {}", e);
        }

        Box::pin(Self::process_next(repo, app, active_job_id)).await?;

        Ok(())
    }

    async fn process_entry(
        entry: &TranscriptionQueueEntry,
        repo: &Repository,
        app: &AppHandle,
    ) -> anyhow::Result<()> {
        ensure_local_provider(&entry.provider)?;
        let engine = TranscriptionEngine::new(app.clone());
        let model_manager = ModelManager::new(app)?;

        let model_path = match crate::models::hf::manager::resolve_installed_path(
            repo.pool(),
            &entry.model_id,
        )
        .await
        {
            Some(p) => p,
            None => model_manager.get_model_path(&entry.model_id),
        };
        if !model_path.exists() {
            return Err(anyhow::anyhow!(
                "Transcription model not found: {}",
                entry.model_id
            ));
        }

        let audio_path = std::path::Path::new(&entry.audio_path);
        if !audio_path.exists() {
            return Err(anyhow::anyhow!(
                "Audio file not found: {}",
                entry.audio_path
            ));
        }

        let chapter_id = entry.transcript_chapter_id();

        // Preserve the transcript row and its checkpointed segments. SQLite
        // REPLACE deletes the existing row, cascading into transcript_segments.
        sqlx::query("INSERT INTO transcripts (book_id, chapter_id, model_used, language, status) VALUES (?, ?, ?, ?, 'processing') ON CONFLICT(book_id, chapter_id) DO UPDATE SET model_used = excluded.model_used, language = excluded.language, status = 'processing', error_message = NULL, updated_at = CURRENT_TIMESTAMP")
            .bind(&entry.document_id)
            .bind(chapter_id)
            .bind(&entry.model_id)
            .bind(&entry.language)
            .execute(repo.pool())
            .await?;

        let transcript_id: i64 =
            sqlx::query_scalar("SELECT id FROM transcripts WHERE book_id = ? AND chapter_id = ?")
                .bind(&entry.document_id)
                .bind(chapter_id)
                .fetch_one(repo.pool())
                .await?;
        let resume_start_ms: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(end_ms), 0) FROM transcript_segments WHERE transcript_id = ?",
        )
        .bind(transcript_id)
        .fetch_one(repo.pool())
        .await?;

        // Prepare only the untranscribed tail. New segment timestamps are
        // offset onto the original media timeline in the callback below.
        let wav_path = engine
            .prepare_audio_from(std::path::Path::new(&entry.audio_path), resume_start_ms)
            .await?;
        let remaining_duration_ms = engine.wav_duration_ms(&wav_path).unwrap_or(0);
        let progress_floor = entry
            .progress
            .max(checkpoint_progress(resume_start_ms, remaining_duration_ms))
            .clamp(0, 99);
        repo.update_transcription_progress(&entry.id, progress_floor)
            .await?;

        let repo_clone = repo.clone();
        let app_clone = app.clone();

        // Throttle per-tick progress writes (Finding G, Part 2): emit/DB-write
        // only when the integer percent changed by >= 1 AND >= 50ms elapsed since
        // the last emit. The final 100% always emits. Old code gated on a flat
        // +5% delta with no time gate, which still spawned many tasks per second.
        let last_progress: Arc<AtomicI32> = Arc::new(AtomicI32::new(-1));
        let progress_clock = Instant::now();
        let last_progress_emit_ms: Arc<AtomicU64> =
            Arc::new(AtomicU64::new(progress_clock.elapsed().as_millis() as u64));
        let progress_entry_id = entry.id.clone();
        let progress_repo = repo.clone();
        let progress_app = app.clone();
        let progress_cb: Box<dyn Fn(i32) + Send + Sync> = Box::new(move |remaining_p: i32| {
            let p = map_remaining_progress(progress_floor, remaining_p);
            let is_final = p >= 100;
            let last = last_progress.load(Ordering::Relaxed);
            let pct_changed = (p - last).abs() >= 1;
            let now_ms = progress_clock.elapsed().as_millis() as u64;
            let last_emit = last_progress_emit_ms.load(Ordering::Relaxed);
            let time_ok = now_ms.saturating_sub(last_emit) >= 50;
            if !(is_final || (pct_changed && time_ok)) {
                return;
            }
            last_progress.store(p, Ordering::Relaxed);
            last_progress_emit_ms.store(now_ms, Ordering::Relaxed);

            let repo = progress_repo.clone();
            let id = progress_entry_id.clone();
            let app = progress_app.clone();
            tokio::spawn(async move {
                if let Err(e) = repo.update_transcription_progress(&id, p).await {
                    tracing::warn!("Failed to update transcription progress: {}", e);
                }
                if let Err(e) = app.emit("transcription://queue-updated", ()) {
                    tracing::debug!("Failed to emit queue-updated: {}", e);
                }
            });
        });

        // Route to the right engine based on the model family. HF-installed
        // models carry their run contract in the registry; pinned catalog models
        // use the id-prefix convention (parakeet-*, sense-voice-*).
        let route = crate::models::hf::manager::stt_route_for_model(repo.pool(), &entry.model_id)
            .await;

        // Batched per-segment persistence (Finding G, Part 2). The per-segment
        // callback is a cheap `tx.send(seg)` into an mpsc channel; a SINGLE
        // consumer task drains it, doing multi-row INSERTs in batches within one
        // transaction and emitting one `transcription://segments-batch` event per
        // batch. This removes the thundering-herd of spawned tasks racing the pool
        // and preserves FIFO ordering.
        let (seg_tx, seg_rx) = mpsc::unbounded_channel::<TranscriptSegment>();
        let flush_handle: tokio::task::JoinHandle<()> = tokio::spawn(spawn_segment_consumer(
            seg_rx,
            repo_clone,
            app_clone,
            transcript_id,
            entry.document_id.clone(),
            chapter_id.to_string(),
        ));

        // Shared on_segment closure: map the remaining-file timestamp back to
        // the original timeline, then enqueue it for batched persistence.
        let on_segment = move |seg: TranscriptSegment| {
            let seg = offset_segment(seg, resume_start_ms);
            // Unbounded send only fails if the consumer ended (cancelled job);
            // best-effort drop in that case.
            let _ = seg_tx.send(seg);
        };

        let transcription_result = engine
            .transcribe_route(
                &wav_path,
                &model_path,
                &route,
                &entry.language,
                on_segment,
                Some(progress_cb),
            )
            .await;

        // Drop the sender + await the consumer so the final buffered batch is
        // flushed before completion or before a retry after an engine error.
        // (seg_tx is the only sender; it goes out of scope here.)
        let _ = flush_handle.await;
        transcription_result?;

        // Assemble from persisted old + new segments. Using only this run's
        // in-memory vector would overwrite documents.content with the tail.
        let persisted_text: Vec<String> = sqlx::query_scalar(
            "SELECT text FROM transcript_segments WHERE transcript_id = ? ORDER BY start_ms, id",
        )
        .bind(transcript_id)
        .fetch_all(repo.pool())
        .await?;
        let full_text = persisted_text
            .iter()
            .map(|text| text.trim())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(" ");

        if !full_text.is_empty() {
            sqlx::query("UPDATE documents SET content = ? WHERE id = ?")
                .bind(&full_text)
                .bind(&entry.document_id)
                .execute(repo.pool())
                .await?;
        }

        // Mark transcript as completed
        sqlx::query("UPDATE transcripts SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(transcript_id)
        .execute(repo.pool())
        .await?;

        // Cleanup WAV (best-effort)
        if let Err(e) = std::fs::remove_file(&wav_path) {
            tracing::debug!("Failed to clean up WAV file {}: {}", wav_path.display(), e);
        }

        Ok(())
    }
}

fn checkpoint_progress(resume_start_ms: i64, remaining_duration_ms: i64) -> i32 {
    let total = resume_start_ms.saturating_add(remaining_duration_ms);
    if resume_start_ms <= 0 || total <= 0 {
        return 0;
    }
    ((resume_start_ms.saturating_mul(100) / total) as i32).clamp(0, 99)
}

fn map_remaining_progress(progress_floor: i32, remaining_progress: i32) -> i32 {
    let floor = progress_floor.clamp(0, 99);
    let remaining = remaining_progress.clamp(0, 100);
    floor + ((100 - floor) * remaining / 100)
}

fn offset_segment(mut segment: TranscriptSegment, offset_ms: i64) -> TranscriptSegment {
    segment.start_ms = segment.start_ms.saturating_add(offset_ms);
    segment.end_ms = segment.end_ms.saturating_add(offset_ms);
    segment
}

fn ensure_local_provider(provider: &str) -> anyhow::Result<()> {
    if provider != "local" {
        return Err(anyhow::anyhow!(
            "Provider mismatch: the local transcription queue cannot execute provider '{}'.",
            provider
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        checkpoint_progress, ensure_local_provider, map_remaining_progress, offset_segment,
    };
    use crate::transcription::engine::TranscriptSegment;

    #[test]
    fn rejects_non_local_provider_before_model_resolution() {
        let error = ensure_local_provider("groq").unwrap_err().to_string();
        assert!(error.contains("Provider mismatch"));
        assert!(error.contains("groq"));
    }

    #[test]
    fn maps_a_two_and_a_half_hour_checkpoint_onto_the_remaining_audio() {
        let checkpoint_ms = 2 * 60 * 60 * 1_000 + 30 * 60 * 1_000;
        let remaining_ms = 60 * 60 * 1_000;
        let floor = checkpoint_progress(checkpoint_ms, remaining_ms);

        assert_eq!(floor, 71);
        assert_eq!(map_remaining_progress(floor, 0), 71);
        assert_eq!(map_remaining_progress(floor, 50), 85);
        assert_eq!(map_remaining_progress(floor, 100), 100);
    }

    #[test]
    fn offsets_tail_segments_back_to_the_original_media_timeline() {
        let segment = TranscriptSegment {
            start_ms: 0,
            end_ms: 30_000,
            text: "continued text".to_string(),
            confidence: 0.9,
        };

        let resumed = offset_segment(segment, 9_000_000);
        assert_eq!(resumed.start_ms, 9_000_000);
        assert_eq!(resumed.end_ms, 9_030_000);
    }
}

// ── Batched segment persistence (Finding G, Part 2) ────────────────────────
//
// The per-segment `tokio::spawn` (SELECT + INSERT + emit per segment) flooded
// the DB pool and could reorder segments. The consumer below drains a channel
// of segments and persists them in batches. For this queue the transcript row
// is keyed by (book_id = chapter_id = document_id).
//
// Batching strategy: flush when the buffer reaches N_SEGMENTS_PER_BATCH rows OR
// FLUSH_INTERVAL elapses (whichever first). Each batch is a multi-row INSERT via
// sqlx::QueryBuilder, chunked under SQLite's 999-bind limit, in ONE transaction.
// `repository.rs` exposes no batch insert for transcript_segments and can't be
// edited here, so we go through the shared pool directly. A single
// `transcription://segments-batch` event carries the batch. FIFO order preserved.

const N_SEGMENTS_PER_BATCH: usize = 64;
const FLUSH_INTERVAL: Duration = Duration::from_millis(500);
const SEG_ROWS_PER_STMT: usize = 999 / 5;

async fn spawn_segment_consumer(
    mut rx: mpsc::UnboundedReceiver<TranscriptSegment>,
    repo: Repository,
    app_handle: AppHandle,
    transcript_id: i64,
    book_id: String,
    chapter_id: String,
) {
    let mut buffer: Vec<TranscriptSegment> = Vec::with_capacity(N_SEGMENTS_PER_BATCH);
    let mut deadline = tokio::time::Instant::now() + FLUSH_INTERVAL;

    loop {
        tokio::select! {
            maybe_seg = rx.recv() => {
                match maybe_seg {
                    Some(seg) => {
                        buffer.push(seg);
                        if buffer.len() >= N_SEGMENTS_PER_BATCH {
                            flush_segment_batch(&repo, &app_handle, transcript_id, &book_id, &chapter_id, &mut buffer).await;
                            deadline = tokio::time::Instant::now() + FLUSH_INTERVAL;
                        }
                    }
                    None => {
                        if !buffer.is_empty() {
                            flush_segment_batch(&repo, &app_handle, transcript_id, &book_id, &chapter_id, &mut buffer).await;
                        }
                        break;
                    }
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                if !buffer.is_empty() {
                    flush_segment_batch(&repo, &app_handle, transcript_id, &book_id, &chapter_id, &mut buffer).await;
                }
                deadline = tokio::time::Instant::now() + FLUSH_INTERVAL;
            }
        }
    }
}

/// Persist `buffer` as a multi-row INSERT inside one transaction (chunked under
/// the bind limit), then emit one `transcription://segments-batch` event and
/// clear the buffer. FIFO order preserved.
async fn flush_segment_batch(
    repo: &Repository,
    app_handle: &AppHandle,
    transcript_id: i64,
    book_id: &str,
    chapter_id: &str,
    buffer: &mut Vec<TranscriptSegment>,
) {
    if buffer.is_empty() {
        return;
    }

    if transcript_id > 0 {
        let tx_result = repo.pool().begin().await;
        let mut tx = match tx_result {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("Failed to begin segment batch txn: {}", e);
                emit_segment_batch(app_handle, book_id, chapter_id, buffer);
                buffer.clear();
                return;
            }
        };

        for chunk in buffer.chunks(SEG_ROWS_PER_STMT) {
            let mut builder: QueryBuilder<Sqlite> = QueryBuilder::new(
                "INSERT OR IGNORE INTO transcript_segments (transcript_id, start_ms, end_ms, text, confidence) ",
            );
            builder.push_values(chunk.iter(), |mut b, seg| {
                b.push_bind(transcript_id)
                    .push_bind(seg.start_ms)
                    .push_bind(seg.end_ms)
                    .push_bind(&seg.text)
                    .push_bind(seg.confidence);
            });
            if let Err(e) = builder.build().execute(&mut *tx).await {
                tracing::warn!("Failed to insert segment batch: {}", e);
                let _ = tx.rollback().await;
                emit_segment_batch(app_handle, book_id, chapter_id, buffer);
                buffer.clear();
                return;
            }
        }

        if let Err(e) = tx.commit().await {
            tracing::warn!("Failed to commit segment batch: {}", e);
        }
    }

    emit_segment_batch(app_handle, book_id, chapter_id, buffer);
    buffer.clear();
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SegmentBatchPayload {
    book_id: String,
    chapter_id: String,
    segments: Vec<TranscriptSegment>,
}

fn emit_segment_batch(
    app_handle: &AppHandle,
    book_id: &str,
    chapter_id: &str,
    segments: &[TranscriptSegment],
) {
    if segments.is_empty() {
        return;
    }
    let payload = SegmentBatchPayload {
        book_id: book_id.to_string(),
        chapter_id: chapter_id.to_string(),
        segments: segments.to_vec(),
    };
    if let Err(e) = app_handle.emit("transcription://segments-batch", payload) {
        tracing::debug!("Failed to emit segments-batch: {}", e);
    }
}
