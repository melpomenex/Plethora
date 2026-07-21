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
            Some(0),
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
        let engine = TranscriptionEngine::new(app.clone());
        let model_manager = ModelManager::new(app)?;

        let model_path = model_manager.get_model_path(&entry.model_id);
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

        // Prepare audio
        let wav_path = engine
            .prepare_audio(std::path::Path::new(&entry.audio_path))
            .await?;

        sqlx::query("INSERT OR REPLACE INTO transcripts (book_id, chapter_id, model_used, language, status) VALUES (?, ?, ?, ?, 'processing')")
            .bind(&entry.document_id)
            .bind(&entry.document_id)
            .bind(&entry.model_id)
            .bind(&entry.language)
            .execute(repo.pool())
            .await?;

        // Collect segments
        let segments: Arc<Mutex<Vec<TranscriptSegment>>> = Arc::new(Mutex::new(Vec::new()));
        let segments_clone = segments.clone();
        let repo_clone = repo.clone();
        let entry_id = entry.id.clone();
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
        let progress_cb: Box<dyn Fn(i32) + Send + Sync> = Box::new(move |p: i32| {
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

        // Route to the right engine based on the model family. Sherpa-onnx models
        // (parakeet-*, sense-voice-*) run via the sherpa-onnx sidecar; everything
        // else is a Whisper (ggml) model.
        let model_id = entry.model_id.as_str();
        let is_parakeet = model_id.starts_with("parakeet-");
        let is_sense_voice = model_id.starts_with("sense-voice-");

        // Batched per-segment persistence (Finding G, Part 2). The per-segment
        // callback is a cheap `tx.send(seg)` into an mpsc channel; a SINGLE
        // consumer task drains it, doing multi-row INSERTs in batches within one
        // transaction and emitting one `transcription://segments-batch` event per
        // batch. This removes the thundering-herd of spawned tasks racing the pool
        // and preserves FIFO ordering. The in-memory `segments_clone` vec is still
        // appended so the final full-text assembly below works regardless of DB
        // timing.
        let (seg_tx, seg_rx) = mpsc::unbounded_channel::<TranscriptSegment>();
        let consumer_doc_id = entry_id.clone();
        let flush_handle: tokio::task::JoinHandle<()> = tokio::spawn(spawn_segment_consumer(
            seg_rx,
            repo_clone,
            app_clone,
            consumer_doc_id,
        ));

        // Shared on_segment closure: append to the in-memory buffer AND enqueue
        // for batched persistence.
        let on_segment = move |seg: TranscriptSegment| {
            segments_clone
                .lock()
                .expect("transcription segments mutex poisoned")
                .push(seg.clone());
            // Unbounded send only fails if the consumer ended (cancelled job);
            // best-effort drop in that case.
            let _ = seg_tx.send(seg);
        };

        if is_sense_voice {
            engine
                .transcribe_sensevoice(
                    &wav_path,
                    &model_path,
                    &entry.language,
                    on_segment,
                    Some(progress_cb),
                )
                .await?;
        } else if is_parakeet {
            engine
                .transcribe_parakeet(
                    &wav_path,
                    &model_path,
                    &entry.language,
                    on_segment,
                    Some(progress_cb),
                )
                .await?;
        } else {
            engine
                .transcribe(
                    &wav_path,
                    &model_path,
                    &entry.language,
                    on_segment,
                    Some(progress_cb),
                )
                .await?;
        }

        // Drop the sender + await the consumer so the final buffered batch is
        // flushed to the DB before we mark the transcript completed.
        // (seg_tx is the only sender; it goes out of scope here.)
        let _ = flush_handle.await;

        let full_text: String = {
            let all_segments = segments
                .lock()
                .expect("transcription segments mutex poisoned");
            all_segments
                .iter()
                .map(|s| s.text.trim())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        };

        if !full_text.is_empty() {
            sqlx::query("UPDATE documents SET content = ? WHERE id = ?")
                .bind(&full_text)
                .bind(&entry.document_id)
                .execute(repo.pool())
                .await?;
        }

        // Mark transcript as completed
        sqlx::query(
            "UPDATE transcripts SET status = 'completed' WHERE book_id = ? AND chapter_id = ?",
        )
        .bind(&entry.document_id)
        .bind(&entry.document_id)
        .execute(repo.pool())
        .await?;

        // Cleanup WAV (best-effort)
        if let Err(e) = std::fs::remove_file(&wav_path) {
            tracing::debug!("Failed to clean up WAV file {}: {}", wav_path.display(), e);
        }

        Ok(())
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
    document_id: String,
) {
    // Resolve transcript_id once (book_id = chapter_id = document_id).
    let transcript_id: i64 =
        sqlx::query_scalar("SELECT id FROM transcripts WHERE book_id = ? AND chapter_id = ?")
            .bind(&document_id)
            .bind(&document_id)
            .fetch_one(repo.pool())
            .await
            .unwrap_or(0);

    let mut buffer: Vec<TranscriptSegment> = Vec::with_capacity(N_SEGMENTS_PER_BATCH);
    let mut deadline = tokio::time::Instant::now() + FLUSH_INTERVAL;

    loop {
        tokio::select! {
            maybe_seg = rx.recv() => {
                match maybe_seg {
                    Some(seg) => {
                        buffer.push(seg);
                        if buffer.len() >= N_SEGMENTS_PER_BATCH {
                            flush_segment_batch(&repo, &app_handle, transcript_id, &mut buffer).await;
                            deadline = tokio::time::Instant::now() + FLUSH_INTERVAL;
                        }
                    }
                    None => {
                        if !buffer.is_empty() {
                            flush_segment_batch(&repo, &app_handle, transcript_id, &mut buffer).await;
                        }
                        break;
                    }
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                if !buffer.is_empty() {
                    flush_segment_batch(&repo, &app_handle, transcript_id, &mut buffer).await;
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
                emit_segment_batch(app_handle, buffer);
                buffer.clear();
                return;
            }
        };

        for chunk in buffer.chunks(SEG_ROWS_PER_STMT) {
            let mut builder: QueryBuilder<Sqlite> = QueryBuilder::new(
                "INSERT INTO transcript_segments (transcript_id, start_ms, end_ms, text, confidence) ",
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
                emit_segment_batch(app_handle, buffer);
                buffer.clear();
                return;
            }
        }

        if let Err(e) = tx.commit().await {
            tracing::warn!("Failed to commit segment batch: {}", e);
        }
    }

    emit_segment_batch(app_handle, buffer);
    buffer.clear();
}

fn emit_segment_batch(app_handle: &AppHandle, segments: &[TranscriptSegment]) {
    if segments.is_empty() {
        return;
    }
    if let Err(e) = app_handle.emit("transcription://segments-batch", segments) {
        tracing::debug!("Failed to emit segments-batch: {}", e);
    }
}
