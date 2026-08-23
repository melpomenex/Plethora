use super::engine::{TranscriptSegment, TranscriptionEngine};
use super::model_manager::ModelManager;
use crate::database::Repository;
use anyhow::Result;
use serde::Serialize;
use sqlx::{Executor, QueryBuilder, Sqlite};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionJob {
    pub book_id: String,
    pub chapter_id: String,
    pub audio_path: String,
    pub model_id: String,
    pub language: String,
}

pub struct JobQueue {
    sender: mpsc::UnboundedSender<TranscriptionJob>,
    active_job: Arc<Mutex<Option<TranscriptionJob>>>,
}

impl JobQueue {
    pub fn new(app_handle: AppHandle, repo: Repository) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<TranscriptionJob>();
        let active_job = Arc::new(Mutex::new(None));
        let active_job_inner = active_job.clone();

        tokio::spawn(async move {
            let engine = TranscriptionEngine::new(app_handle.clone());
            let model_manager =
                ModelManager::new(&app_handle).expect("failed to create model manager");

            while let Some(job) = rx.recv().await {
                {
                    let mut active = active_job_inner.lock().expect("job queue mutex poisoned");
                    *active = Some(job.clone());
                }

                app_handle
                    .emit("transcription://status-change", &job)
                    .expect("event emit failed");

                if let Err(e) =
                    Self::process_job(&job, &engine, &model_manager, &repo, &app_handle).await
                {
                    eprintln!("Error processing transcription job: {:?}", e);
                    let _ = repo.pool().execute(
                        sqlx::query("UPDATE transcripts SET status = 'failed', error_message = ? WHERE book_id = ? AND chapter_id = ?")
                            .bind(e.to_string())
                            .bind(&job.book_id)
                            .bind(&job.chapter_id)
                    ).await;
                }

                {
                    let mut active = active_job_inner.lock().expect("job queue mutex poisoned");
                    *active = None;
                }
                app_handle
                    .emit("transcription://idle", ())
                    .expect("event emit failed");
            }
        });

        Self {
            sender: tx,
            active_job,
        }
    }

    pub fn enqueue(&self, job: TranscriptionJob) -> Result<()> {
        self.sender.send(job)?;
        Ok(())
    }

    async fn process_job(
        job: &TranscriptionJob,
        engine: &TranscriptionEngine,
        model_manager: &ModelManager,
        repo: &Repository,
        app_handle: &AppHandle,
    ) -> Result<()> {
        // 1. Update status to processing
        sqlx::query("INSERT OR REPLACE INTO transcripts (book_id, chapter_id, model_used, language, status) VALUES (?, ?, ?, ?, 'processing')")
            .bind(&job.book_id)
            .bind(&job.chapter_id)
            .bind(&job.model_id)
            .bind(&job.language)
            .execute(repo.pool())
            .await?;

        if job.model_id == "apple-speech" {
            return Self::process_apple_job(job, repo, app_handle).await;
        }

        // 2. Prepare audio (convert to WAV)
        let wav_path = engine
            .prepare_audio(std::path::Path::new(&job.audio_path))
            .await?;

        // 3. Get model path. HF-installed models resolve from the registry;
        //    pinned catalog models use the legacy get_model_path.
        let model_path = match crate::models::hf::manager::resolve_installed_path(
            repo.pool(),
            &job.model_id,
        )
        .await
        {
            Some(p) => p,
            None => model_manager.get_model_path(&job.model_id),
        };

        // 4. Transcribe
        //
        // Per-segment persistence is BATCHED rather than spawned-per-segment. The
        // old code did `tokio::spawn` per segment (each doing a SELECT + INSERT +
        // event emit), which flooded the DB pool with thousands of racing tasks
        // and could persist segments out of order. Now the per-segment callback
        // does a cheap `tx.send(seg)` into an mpsc channel, and a SINGLE consumer
        // task drains it, doing multi-row INSERTs in batches (≤ N_SEGMENTS_PER_BATCH
        // or every FLUSH_INTERVAL, whichever first) inside one transaction, then
        // emits one `transcription://segments-batch` event per batch. FIFO order is
        // preserved because the channel is FIFO and there's a single consumer.
        let repo_clone = repo.clone();
        let app_handle_clone = app_handle.clone();
        let book_id = job.book_id.clone();
        let chapter_id = job.chapter_id.clone();
        // Route to the right engine based on the model family. HF-installed
        // models carry their run contract in the registry; pinned catalog models
        // use the id-prefix convention (parakeet-*, sense-voice-*).
        let route = crate::models::hf::manager::stt_route_for_model(repo.pool(), &job.model_id)
            .await;

        // Unbounded channel: the per-segment callback is a sync `Fn` that cannot
        // await, so it must never block. Unbounded matches the old fire-and-forget
        // spawn behavior (no backpressure stall on the engine thread) while keeping
        // every segment in memory, in order, for the consumer.
        let (seg_tx, seg_rx) = mpsc::unbounded_channel::<TranscriptSegment>();

        // Single long-running consumer that batches DB writes + event emits.
        let flush_handle: tokio::task::JoinHandle<()> = tokio::spawn(spawn_segment_consumer(
            seg_rx,
            repo_clone,
            app_handle_clone,
            book_id,
            chapter_id,
        ));

        // Cheap, non-async per-segment callback: enqueue into the channel.
        let on_segment = move |seg: TranscriptSegment| {
            // Unbounded send only fails if the consumer task ended (e.g. job
            // cancelled); best-effort drop in that case.
            let _ = seg_tx.send(seg);
        };

        engine
            .transcribe_route(
                &wav_path,
                &model_path,
                &route,
                &job.language,
                on_segment,
                None,
            )
            .await?;

        // Signal the consumer that no more segments are coming (drop the last
        // sender) and wait for it to flush any buffered batch to the DB. This
        // guarantees step 5/6 below see every segment persisted, in order.
        // (seg_tx is the only sender; it goes out of scope here.)
        let _ = flush_handle.await;

        // 5. Update status to completed
        sqlx::query(
            "UPDATE transcripts SET status = 'completed' WHERE book_id = ? AND chapter_id = ?",
        )
        .bind(&job.book_id)
        .bind(&job.chapter_id)
        .execute(repo.pool())
        .await?;

        // 6. Copy transcript text to documents.content for AI assistant access
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT text FROM transcript_segments WHERE transcript_id = (SELECT id FROM transcripts WHERE book_id = ? AND chapter_id = ?) ORDER BY start_ms"
        )
        .bind(&job.book_id)
        .bind(&job.chapter_id)
        .fetch_all(repo.pool())
        .await
        .unwrap_or_default();

        let full_text: String = rows
            .iter()
            .map(|r| r.0.trim())
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join(" ");

        if !full_text.is_empty() {
            let _ = sqlx::query("UPDATE documents SET content = ? WHERE id = ?")
                .bind(&full_text)
                .bind(&job.book_id)
                .execute(repo.pool())
                .await;
        }

        // 7. Cleanup WAV
        let _ = std::fs::remove_file(wav_path);

        Ok(())
    }

    async fn process_apple_job(
        job: &TranscriptionJob,
        repo: &Repository,
        app_handle: &AppHandle,
    ) -> Result<()> {
        let result = plethora_apple_intelligence::transcribe_file_via_app(
            app_handle,
            &job.audio_path,
            &job.language,
        )
        .map_err(|e| anyhow::anyhow!("{}", e))?;

        let transcript_id: i64 =
            sqlx::query_scalar("SELECT id FROM transcripts WHERE book_id = ? AND chapter_id = ?")
                .bind(&job.book_id)
                .bind(&job.chapter_id)
                .fetch_one(repo.pool())
                .await
                .unwrap_or(0);

        for seg in &result.segments {
            let _ = sqlx::query(
                "INSERT INTO transcript_segments (transcript_id, start_ms, end_ms, text, confidence) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(transcript_id)
            .bind(seg.start_ms)
            .bind(seg.end_ms)
            .bind(&seg.text)
            .bind(1.0_f32)
            .execute(repo.pool())
            .await;
        }
        if result.segments.is_empty() && !result.text.is_empty() {
            let _ = sqlx::query(
                "INSERT INTO transcript_segments (transcript_id, start_ms, end_ms, text, confidence) VALUES (?, 0, 0, ?, 1.0)",
            )
            .bind(transcript_id)
            .bind(&result.text)
            .execute(repo.pool())
            .await;
        }

        sqlx::query(
            "UPDATE transcripts SET status = 'completed', model_used = 'apple-speech-transcriber' WHERE book_id = ? AND chapter_id = ?",
        )
        .bind(&job.book_id)
        .bind(&job.chapter_id)
        .execute(repo.pool())
        .await?;

        if !result.text.is_empty() {
            let _ = sqlx::query("UPDATE documents SET content = ? WHERE id = ?")
                .bind(&result.text)
                .bind(&job.book_id)
                .execute(repo.pool())
                .await;
        }
        Ok(())
    }
}

// ── Batched segment persistence ────────────────────────────────────────────
//
// Finding G, Part 2: the per-segment `tokio::spawn` (SELECT + INSERT + emit per
// segment) flooded the DB pool and could reorder segments. The consumer below is
// a single task that drains a channel of segments and persists them in batches.
//
// Batching strategy:
//   - A batch is flushed when it reaches N_SEGMENTS_PER_BATCH rows, OR when
//     FLUSH_INTERVAL elapses since the last flush (whichever first).
//   - Each batch is a multi-row INSERT built with sqlx::QueryBuilder, in chunks
//     small enough to stay under SQLite's 999-bind limit, all within ONE
//     transaction. The repository layer (`repository.rs`) exposes no batch-insert
//     API for `transcript_segments` and cannot be edited here, so we go straight
//     through the shared pool — equivalent to the existing per-row INSERT but
//     amortized across a batch and committed together.
//   - `transcript_id` is resolved once at consumer startup (it's stable for a
//     given job — the transcripts row is created before transcription starts).
//   - A single `transcription://segments-batch` event carries the whole batch,
//     so the frontend appends N segments with one store update instead of N.
//   - FIFO order is preserved: the channel is FIFO and there's one consumer.

/// Max segments buffered before a forced flush.
const N_SEGMENTS_PER_BATCH: usize = 64;
/// Max elapsed time between flushes.
const FLUSH_INTERVAL: Duration = Duration::from_millis(500);
/// transcript_segments has 5 bind columns; 999 / 5 = 199 rows per statement.
const SEG_ROWS_PER_STMT: usize = 999 / 5;

/// Drain `rx`, persisting segments in batches. Resolves `transcript_id` from the
/// transcripts row keyed by `(book_id, chapter_id)` once at startup, then loops
/// accumulating segments and flushing per the batching strategy above. Returns
/// when the channel is closed AND the final buffered batch is flushed.
async fn spawn_segment_consumer(
    mut rx: mpsc::UnboundedReceiver<TranscriptSegment>,
    repo: Repository,
    app_handle: AppHandle,
    book_id: String,
    chapter_id: String,
) {
    // Resolve the transcript row id once (stable for this job). If the row is
    // missing, skip DB writes but still forward events so the UI updates.
    let transcript_id: i64 =
        sqlx::query_scalar("SELECT id FROM transcripts WHERE book_id = ? AND chapter_id = ?")
            .bind(&book_id)
            .bind(&chapter_id)
            .fetch_one(repo.pool())
            .await
            .unwrap_or(0);

    let mut buffer: Vec<TranscriptSegment> = Vec::with_capacity(N_SEGMENTS_PER_BATCH);
    let mut deadline = tokio::time::Instant::now() + FLUSH_INTERVAL;

    loop {
        tokio::select! {
            // A segment arrived (or the channel is still open).
            maybe_seg = rx.recv() => {
                match maybe_seg {
                    Some(seg) => {
                        buffer.push(seg);
                        if buffer.len() >= N_SEGMENTS_PER_BATCH {
                            flush_segment_batch(&repo, &app_handle, transcript_id, &mut buffer).await;
                            deadline = tokio::time::Instant::now() + FLUSH_INTERVAL;
                        }
                    }
                    // Channel closed: flush whatever remains, then stop.
                    None => {
                        if !buffer.is_empty() {
                            flush_segment_batch(&repo, &app_handle, transcript_id, &mut buffer).await;
                        }
                        break;
                    }
                }
            }
            // Time-based flush even if the batch isn't full yet.
            _ = tokio::time::sleep_until(deadline) => {
                if !buffer.is_empty() {
                    flush_segment_batch(&repo, &app_handle, transcript_id, &mut buffer).await;
                }
                deadline = tokio::time::Instant::now() + FLUSH_INTERVAL;
            }
        }
    }
}

/// Persist `buffer` as a multi-row INSERT inside a single transaction (chunked to
/// stay under the bind limit), then emit one `transcription://segments-batch`
/// event carrying the batch and clear the buffer. Emits/inserts in FIFO order.
async fn flush_segment_batch(
    repo: &Repository,
    app_handle: &AppHandle,
    transcript_id: i64,
    buffer: &mut Vec<TranscriptSegment>,
) {
    if buffer.is_empty() {
        return;
    }

    // Only persist if we have a valid transcript row (matches the old guard).
    if transcript_id > 0 {
        // One transaction for the whole batch; chunk the multi-row INSERT so each
        // statement stays under SQLite's 999-bind limit (5 binds/row).
        let tx_result = repo.pool().begin().await;
        let mut tx = match tx_result {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("Failed to begin segment batch txn: {}", e);
                // Still emit the batch so the UI is live; rows will be re-read on
                // completion from whatever did persist.
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
                // Roll back this batch by aborting the txn and emitting anyway.
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

/// Emit the batch as a single `transcription://segments-batch` event. The payload
/// is the slice of segments in FIFO order.
fn emit_segment_batch(app_handle: &AppHandle, segments: &[TranscriptSegment]) {
    if segments.is_empty() {
        return;
    }
    if let Err(e) = app_handle.emit("transcription://segments-batch", segments) {
        tracing::debug!("Failed to emit segments-batch: {}", e);
    }
}
