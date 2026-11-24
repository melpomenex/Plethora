//! Background indexing worker for the semantic index (task 4.3, design D14).
//!
//! Modeled on the transcription `job_queue.rs` / `auto_queue.rs` tokio actor
//! pattern: an `IndexerQueue` handle sends commands over an unbounded mpsc
//! channel to a single worker task that owns the pipeline. The worker is
//! deliberately free of Tauri handles so it is fully unit-testable against an
//! in-memory database.
//!
//! Per-document pipeline:
//!   load doc → chunk (documents, then extracts/annotations/cards, task 4.7)
//!   → diff by content_hash (delete orphans, insert new; retained chunks keep
//!   their embeddings) → embed missing/stale chunks via the backend in small
//!   batches → per-chunk COMMIT (interrupt-safe) → update `ai_index_state`.
//!
//! State machine per document: `unindexed → queued → indexing → indexed |
//! failed`, with `stale` reserved for embedding-version drift. Interruption
//! (pause/cancel/app exit) retains committed chunks; the document returns to
//! `queued` and the next run's hash diff skips everything already stored.
//!
//! Battery policy (design D14): single-document enqueues always run; the bulk
//! backfill (`enqueue_all`) takes `require_charging` — when set and the
//! device is not charging, the queue parks itself paused instead of starting.

use crate::ai_learning::chunker::{
    chunk_document, multimodal_chunk, single_chunk, ChunkContext, ChunkInput, ChunkOptions,
};
use crate::ai_learning::embeddings_backend::{EmbeddingBackend, EmbeddingUnavailable};
use crate::ai_learning::models::{
    AggregateIndexStatus, ChunkModel, DocumentIndexStatus, EmbeddingModelUsage, IndexState,
    SOURCE_TYPE_ANNOTATION, SOURCE_TYPE_CARD, SOURCE_TYPE_DOCUMENT, SOURCE_TYPE_EXTRACT,
    SOURCE_TYPE_FIGURE, SOURCE_TYPE_MEDIA, SOURCE_TYPE_SESSION, SOURCE_TYPE_TRANSCRIPT,
};
use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use byteorder::{ByteOrder, LittleEndian};
use sqlx::Row;
use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

/// Builds the embedding backend to use for a job. The Tauri command layer
/// installs a factory that reads the latest frontend-provided config; tests
/// install a mock factory.
pub type BackendFactory = Arc<dyn Fn() -> EmbeddingBackend + Send + Sync>;

/// Embedding batch size (matches the RAG indexer's batch of 25).
const EMBED_BATCH_SIZE: usize = 25;

#[derive(Debug)]
enum IndexerCommand {
    EnqueueDocument(String),
    EnqueueAll { require_charging: bool },
    Pause,
    Resume,
    CancelDocument(String),
    Reset,
    Shutdown,
}

/// Worker runtime snapshot surfaced through `ai_learning_index_status`.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct IndexerRuntimeStatus {
    pub paused: bool,
    pub active_document: Option<String>,
    pub pending_documents: usize,
}

/// Public handle to the indexing worker.
pub struct IndexerQueue {
    sender: mpsc::UnboundedSender<IndexerCommand>,
    status: Arc<Mutex<IndexerRuntimeStatus>>,
}

impl IndexerQueue {
    /// Spawn the worker. Also resets any `indexing` rows left over from an
    /// interrupted previous run back to `queued` (interrupt-safe resume).
    pub fn new(repo: Repository, factory: BackendFactory) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<IndexerCommand>();
        let status = Arc::new(Mutex::new(IndexerRuntimeStatus::default()));

        let worker = Worker {
            repo,
            factory,
            status: Arc::clone(&status),
            backlog: VecDeque::new(),
            paused: false,
            resume_notify: Arc::new(tokio::sync::Notify::new()),
        };

        tokio::spawn(async move {
            worker.run(&mut rx).await;
        });

        Self { sender: tx, status }
    }

    pub fn enqueue_document(&self, document_id: impl Into<String>) -> Result<()> {
        self.sender
            .send(IndexerCommand::EnqueueDocument(document_id.into()))
            .map_err(|_| PlethoraError::Internal("indexer worker stopped".into()))
    }

    pub fn enqueue_all(&self, require_charging: bool) -> Result<()> {
        self.sender
            .send(IndexerCommand::EnqueueAll { require_charging })
            .map_err(|_| PlethoraError::Internal("indexer worker stopped".into()))
    }

    pub fn pause(&self) -> Result<()> {
        self.sender
            .send(IndexerCommand::Pause)
            .map_err(|_| PlethoraError::Internal("indexer worker stopped".into()))
    }

    pub fn resume(&self) -> Result<()> {
        self.sender
            .send(IndexerCommand::Resume)
            .map_err(|_| PlethoraError::Internal("indexer worker stopped".into()))
    }

    pub fn cancel_document(&self, document_id: impl Into<String>) -> Result<()> {
        self.sender
            .send(IndexerCommand::CancelDocument(document_id.into()))
            .map_err(|_| PlethoraError::Internal("indexer worker stopped".into()))
    }

    pub fn reset(&self) -> Result<()> {
        self.sender
            .send(IndexerCommand::Reset)
            .map_err(|_| PlethoraError::Internal("indexer worker stopped".into()))
    }

    pub fn shutdown(&self) -> Result<()> {
        self.sender
            .send(IndexerCommand::Shutdown)
            .map_err(|_| PlethoraError::Internal("indexer worker stopped".into()))
    }

    pub fn runtime_status(&self) -> IndexerRuntimeStatus {
        self.status.lock().map(|s| s.clone()).unwrap_or_default()
    }
}

struct Worker {
    repo: Repository,
    factory: BackendFactory,
    status: Arc<Mutex<IndexerRuntimeStatus>>,
    backlog: VecDeque<String>,
    paused: bool,
    resume_notify: Arc<tokio::sync::Notify>,
}

impl Worker {
    fn set_status(&self, f: impl FnOnce(&mut IndexerRuntimeStatus)) {
        if let Ok(mut s) = self.status.lock() {
            f(&mut s);
        }
    }

    async fn run(mut self, rx: &mut mpsc::UnboundedReceiver<IndexerCommand>) {
        // Resume rows stranded in `indexing` by a previous run.
        if let Err(e) =
            sqlx::query("UPDATE ai_index_state SET state = 'queued' WHERE state = 'indexing'")
                .execute(self.repo.pool())
                .await
        {
            warn!("failed to reset interrupted index states: {}", e);
        }

        // Reconcile any queued, stale, or newly imported documents that have
        // usable content and are not AI-excluded so a restart or crash after
        // commit never permanently loses indexing work.
        match sqlx::query_scalar::<_, String>(
            r#"
            SELECT d.id
            FROM documents d
            LEFT JOIN ai_index_state s ON s.document_id = d.id
            WHERE d.is_ai_excluded = 0
              AND (
                s.state IN ('queued', 'stale')
                OR (s.document_id IS NULL AND COALESCE(NULLIF(trim(d.content), ''), '') != '')
              )
            ORDER BY d.date_modified DESC
            LIMIT 500
            "#,
        )
        .fetch_all(self.repo.pool())
        .await
        {
            Ok(pending_ids) => {
                for doc_id in pending_ids {
                    if !self.backlog.contains(&doc_id) {
                        self.backlog.push_back(doc_id);
                    }
                }
                self.set_status(|s| {
                    s.pending_documents = self.backlog_len();
                });
            }
            Err(e) => {
                warn!("failed to reconcile pending AI index documents: {}", e);
            }
        }

        #[derive(PartialEq)]
        enum StopReason {
            None,
            Pause,
            Cancel,
            Shutdown,
        }

        let mut shutdown = false;
        'outer: loop {
            // Drain the backlog while unpaused.
            while !self.paused && !shutdown {
                let Some(doc_id) = self.backlog.pop_front() else {
                    break;
                };
                self.set_status(|s| {
                    s.active_document = Some(doc_id.clone());
                    s.pending_documents = self.backlog_len();
                });

                // Split borrows so the sync interrupt-check closure can touch
                // the control state (pause flag, backlog, channel) while the
                // pipeline borrows the repository.
                let Worker {
                    repo,
                    factory,
                    backlog,
                    paused,
                    ..
                } = &mut self;
                let mut parked: Vec<IndexerCommand> = Vec::new();
                let mut stop = StopReason::None;
                let backend = (factory)();

                let result = index_document_once(repo, &doc_id, &backend, &mut || {
                    // Interrupt check between embedding batches: control
                    // commands take effect immediately; the rest are parked
                    // and handled after the current document.
                    while let Ok(cmd) = rx.try_recv() {
                        match cmd {
                            IndexerCommand::Pause => {
                                *paused = true;
                                stop = StopReason::Pause;
                            }
                            IndexerCommand::CancelDocument(id) => {
                                backlog.retain(|d| *d != id);
                                if id == doc_id {
                                    stop = StopReason::Cancel;
                                }
                            }
                            IndexerCommand::Resume => {
                                *paused = false;
                            }
                            IndexerCommand::Shutdown => {
                                stop = StopReason::Shutdown;
                            }
                            other => parked.push(other),
                        }
                        if stop != StopReason::None {
                            break;
                        }
                    }
                    stop == StopReason::None
                })
                .await;

                if let Err(e) = result {
                    warn!("indexing document {} failed: {}", doc_id, e);
                }

                // Paused mid-document: requeue it at the front so resume
                // continues where the backlog left off.
                if stop == StopReason::Pause {
                    self.backlog.push_front(doc_id.clone());
                }
                if stop == StopReason::Shutdown {
                    shutdown = true;
                }
                for cmd in parked.drain(..) {
                    self.handle_command(cmd).await;
                }
                self.set_status(|s| {
                    s.active_document = None;
                    s.pending_documents = self.backlog_len();
                });
            }

            self.set_status(|s| {
                s.paused = self.paused;
                s.pending_documents = self.backlog_len();
            });

            if shutdown {
                break 'outer;
            }

            // Wait for commands (or a resume).
            tokio::select! {
                cmd = rx.recv() => {
                    match cmd {
                        None => break 'outer,
                        Some(IndexerCommand::Shutdown) => break 'outer,
                        Some(other) => {
                            self.handle_command(other).await;
                        }
                    }
                }
                _ = self.resume_notify.notified(), if self.paused => {}
            }
        }
        info!("ai_learning indexer worker stopped");
    }

    fn backlog_len(&self) -> usize {
        self.backlog.len()
    }

    async fn handle_command(&mut self, cmd: IndexerCommand) {
        match cmd {
            IndexerCommand::EnqueueDocument(id) => {
                self.set_state_if(&id, IndexState::Queued).await;
                if !self.backlog.contains(&id) {
                    self.backlog.push_back(id);
                }
                if !self.paused {
                    self.resume_notify.notify_waiters();
                }
            }
            IndexerCommand::EnqueueAll { require_charging } => {
                if require_charging && !crate::battery::get_battery_state().is_charging {
                    // Bulk backfill only while charging (design D14). Park
                    // the queue paused; `resume` overrides on user action.
                    self.paused = true;
                    self.set_status(|s| s.paused = true);
                    info!("bulk index enqueue skipped: battery not charging (require_charging)");
                    return;
                }
                let ids = list_indexable_documents(&self.repo)
                    .await
                    .unwrap_or_default();
                let added = ids.len();
                for id in ids {
                    self.set_state_if(&id, IndexState::Queued).await;
                    if !self.backlog.contains(&id) {
                        self.backlog.push_back(id);
                    }
                }
                debug!("bulk index enqueued {} documents", added);
                if !self.paused {
                    self.resume_notify.notify_waiters();
                }
            }
            IndexerCommand::Pause => {
                self.paused = true;
                self.set_status(|s| s.paused = true);
            }
            IndexerCommand::Resume => {
                self.paused = false;
                self.set_status(|s| s.paused = false);
                self.resume_notify.notify_waiters();
            }
            IndexerCommand::CancelDocument(id) => {
                self.backlog.retain(|d| *d != id);
                self.set_state_if(&id, IndexState::Queued).await;
            }
            IndexerCommand::Reset => {
                self.backlog.clear();
                if let Err(e) = reset_index(&self.repo).await {
                    warn!("index reset failed: {}", e);
                }
            }
            IndexerCommand::Shutdown => {}
        }
    }

    async fn set_state_if(&self, document_id: &str, state: IndexState) {
        if let Err(e) = set_state(&self.repo, document_id, state, None).await {
            warn!("failed to set state for {}: {}", document_id, e);
        }
    }
}

/// Outcome of one indexing pass over a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexOutcome {
    Completed,
    Cancelled,
    Paused,
}

/// Result of the embedding phase. `embedded` is the authoritative count of
/// chunks whose stored vector matches the active backend model/version, not
/// the number of attempts.
struct EmbedOutcome {
    embedded: i64,
    error: Option<String>,
}

async fn current_embedding_count(
    repo: &Repository,
    document_id: &str,
    model: &str,
    version: i64,
) -> Result<i64> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)
         FROM semantic_chunks c
         JOIN semantic_chunk_embeddings e ON e.chunk_id = c.id
         WHERE c.document_id = ?1 AND e.model = ?2 AND e.embedding_version = ?3",
    )
    .bind(document_id)
    .bind(model)
    .bind(version)
    .fetch_one(repo.pool())
    .await?;
    Ok(count)
}

/// Index one document end-to-end. `should_continue` is checked between
/// embedding batches; returning `false` aborts the pass (already-committed
/// chunks are retained and the state is left `queued` for resume). Exposed
/// publicly so the interruption semantics are directly unit-testable.
pub async fn index_document_once(
    repo: &Repository,
    document_id: &str,
    backend: &EmbeddingBackend,
    should_continue: &mut (dyn FnMut() -> bool + Send),
) -> Result<IndexOutcome> {
    // Cancellation before any work.
    if !should_continue() {
        set_state(repo, document_id, IndexState::Queued, None).await?;
        return Ok(IndexOutcome::Cancelled);
    }

    let Some(doc) = repo.get_document(document_id).await? else {
        // Document is gone; the FK cascade should have removed chunks and
        // state. Defensively clean up a stray state row.
        sqlx::query("DELETE FROM ai_index_state WHERE document_id = ?1")
            .bind(document_id)
            .execute(repo.pool())
            .await?;
        return Ok(IndexOutcome::Completed);
    };

    repo.ensure_document_ai_allowed(document_id, false).await?;

    set_state(repo, document_id, IndexState::Indexing, None).await?;

    let content = doc.content.clone().unwrap_or_default();

    // 1. Chunk the document body. Transcript-backed documents (recording
    // sessions, YouTube, video/audio) have no `documents.content`, so the
    // body chunker must get a chance to read their transcript tables.
    let chunks = build_document_chunks(repo, &doc, &content).await;

    // 2. Extra sources (task 4.7): extracts, annotations, card fronts.
    let mut all_chunks = chunks;
    all_chunks.extend(build_extract_chunks(repo, document_id).await);
    all_chunks.extend(build_annotation_chunks(repo, document_id).await);
    all_chunks.extend(build_card_chunks(repo, document_id).await);

    let total = all_chunks.len() as i64;
    // Reconcile stored chunks before the empty-result return so stale source
    // content is removed when a document no longer produces indexable chunks.
    apply_chunk_diff(repo, document_id, &all_chunks).await?;

    if all_chunks.is_empty() {
        // Nothing indexable (e.g. a scanned PDF awaiting OCR): record an
        // honest empty success so the document is not perpetually requeued.
        upsert_state_row(
            repo,
            document_id,
            IndexState::Indexed,
            Some(backend),
            0,
            0,
            None,
        )
        .await?;
        return Ok(IndexOutcome::Completed);
    }

    // 4. Embed missing/stale chunks, per-chunk commits, interrupt checks.
    let embed = embed_chunks(repo, document_id, backend, should_continue).await?;

    if !should_continue() {
        // Interrupted: keep what was committed; resume later from queued.
        set_state_raw(
            repo,
            document_id,
            IndexState::Queued,
            embed.embedded,
            total,
            embed.error.as_deref(),
        )
        .await?;
        return Ok(if embed.embedded < total {
            IndexOutcome::Paused
        } else {
            IndexOutcome::Completed
        });
    }

    // Chunks are committed and usable even if vector generation was
    // incomplete. Record `lexical_only` (not `indexed`) when vectors failed
    // or are incomplete so the UI and retry paths reflect partial state.
    let final_state = if embed.error.is_some() && embed.embedded < total {
        IndexState::LexicalOnly
    } else {
        IndexState::Indexed
    };
    upsert_state_row(
        repo,
        document_id,
        final_state,
        Some(backend),
        embed.embedded,
        total,
        embed.error.as_deref(),
    )
    .await?;
    let chunk_rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id, text FROM semantic_chunks WHERE document_id = ?1")
            .bind(document_id)
            .fetch_all(repo.pool())
            .await
            .unwrap_or_default();
    crate::ai_learning::spotlight::donate_document_chunks(document_id, &doc.title, &chunk_rows);
    Ok(IndexOutcome::Completed)
}

/// Chunk the document body using the source-appropriate strategy.
async fn build_document_chunks(
    repo: &Repository,
    doc: &crate::models::Document,
    content: &str,
) -> Vec<ChunkModel> {
    if let Some(transcript_chunks) = build_transcript_document_chunks(repo, doc).await {
        if !transcript_chunks.is_empty() {
            return transcript_chunks;
        }
    }
    let location_type = match doc.file_type {
        crate::models::FileType::Pdf => "pdf",
        crate::models::FileType::Epub => "epub",
        crate::models::FileType::Html => "html",
        crate::models::FileType::Markdown => "markdown",
        _ => "text",
    };
    let ctx = ChunkContext {
        document_id: &doc.id,
        source_type: SOURCE_TYPE_DOCUMENT,
        source_id: None,
        location_source_type: location_type,
        spine_index: None,
    };

    let html = if matches!(
        doc.file_type,
        crate::models::FileType::Html | crate::models::FileType::Epub
    ) {
        load_html_content(repo, &doc.id).await
    } else {
        None
    };
    let mut chunks = match build_rich_text_chunks(repo, &ctx, &doc.file_path, html.as_deref()).await {
        Some(chunks) => chunks,
        None => {
            let input = match doc.file_type {
                crate::models::FileType::Markdown => ChunkInput::Markdown { text: content },
                _ => ChunkInput::Plain {
                    text: content,
                    heading_heuristic: matches!(location_type, "pdf" | "epub" | "html"),
                },
            };
            chunk_document(&ctx, input, &ChunkOptions::default())
        }
    };

    // Extract embedded figures from documents (PDFs) and schedule them as figure chunks
    if doc.file_type == crate::models::FileType::Pdf {
        let figures = crate::processor::pdf::extract_pdf_figures(&doc.file_path).await;
        let base_ordinal = chunks.len() as i64;
        for (i, (page_num, caption, asset_url)) in figures.into_iter().enumerate() {
            let fig_ctx = ChunkContext {
                document_id: &doc.id,
                source_type: SOURCE_TYPE_FIGURE,
                source_id: None,
                location_source_type: location_type,
                spine_index: None,
            };
            if let Some(fig_chunk) = multimodal_chunk(
                &fig_ctx,
                &caption,
                base_ordinal + (i as i64),
                Some(page_num),
                Some(asset_url),
                None,
            ) {
                chunks.push(fig_chunk);
            }
        }
    }

    chunks
}

fn extract_podcast_episode_id(doc: &crate::models::Document) -> Option<String> {
    doc.metadata
        .as_ref()
        .and_then(|meta| meta.source.as_deref())
        .and_then(|source| source.strip_prefix("podcast:"))
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .or_else(|| {
            doc.file_path
                .strip_prefix("podcast://")
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(str::to_string)
        })
}

fn chunk_timed_transcript(
    document_id: &str,
    segments: &[crate::ai_learning::chunker::TranscriptChunkSegment],
) -> Vec<ChunkModel> {
    let ctx = ChunkContext {
        document_id,
        source_type: SOURCE_TYPE_TRANSCRIPT,
        source_id: None,
        location_source_type: SOURCE_TYPE_TRANSCRIPT,
        spine_index: None,
    };
    chunk_document(
        &ctx,
        ChunkInput::Transcript {
            segments,
            chapters: &[],
        },
        &ChunkOptions::default(),
    )
}

fn parse_transcript_segments_json(
    raw_json: &str,
) -> Vec<crate::ai_learning::chunker::TranscriptChunkSegment> {
    let Ok(values) = serde_json::from_str::<Vec<serde_json::Value>>(raw_json) else {
        return Vec::new();
    };
    values
        .iter()
        .filter_map(|value| {
            let text = value.get("text")?.as_str()?.trim();
            if text.is_empty() {
                return None;
            }
            let start = value
                .get("start")
                .or_else(|| value.get("time"))
                .or_else(|| value.get("startSeconds"))
                .and_then(|v| v.as_f64())
                .or_else(|| {
                    value
                        .get("startMs")
                        .or_else(|| value.get("start_ms"))
                        .and_then(|v| v.as_f64())
                        .map(|ms| ms / 1000.0)
                })
                .unwrap_or(0.0);
            let duration = value
                .get("duration")
                .and_then(|v| v.as_f64())
                .unwrap_or_else(|| {
                    let end = value
                        .get("end")
                        .or_else(|| value.get("endTime"))
                        .and_then(|v| v.as_f64())
                        .or_else(|| {
                            value
                                .get("endMs")
                                .or_else(|| value.get("end_ms"))
                                .and_then(|v| v.as_f64())
                                .map(|ms| ms / 1000.0)
                        })
                        .unwrap_or(start + 5.0);
                    (end - start).max(0.0)
                });
            Some(crate::ai_learning::chunker::TranscriptChunkSegment {
                start: start.max(0.0),
                duration: duration.max(0.0),
                text: text.to_string(),
            })
        })
        .collect()
}

async fn build_transcript_document_chunks(
    repo: &Repository,
    doc: &crate::models::Document,
) -> Option<Vec<ChunkModel>> {
    // 1. Canonical recording session transcript segments
    let session_transcript_info: Option<(i64, i64)> = sqlx::query_as(
        "SELECT transcript_id, transcript_revision FROM recording_sessions WHERE (document_id = ?1 OR id = ?1) AND transcript_id IS NOT NULL",
    )
    .bind(&doc.id)
    .fetch_optional(repo.pool())
    .await
    .ok()
    .flatten();

    if let Some((transcript_id, _rev)) = session_transcript_info {
        let seg_rows = sqlx::query(
            "SELECT segment_key, ordinal, text, timing_kind, start_ms, end_ms, speaker_id \
             FROM transcript_segments WHERE transcript_id = ?1 ORDER BY ordinal, id",
        )
        .bind(transcript_id)
        .fetch_all(repo.pool())
        .await
        .ok();

        if let Some(rows) = seg_rows {
            if !rows.is_empty() {
                let segments = rows
                    .into_iter()
                    .map(
                        |r| crate::ai_learning::chunker::SessionTranscriptChunkSegment {
                            segment_key: r.try_get("segment_key").unwrap_or_default(),
                            ordinal: r.try_get("ordinal").unwrap_or(0),
                            text: r.try_get("text").unwrap_or_default(),
                            timing_kind: r.try_get("timing_kind").unwrap_or_else(|_| "none".into()),
                            start_ms: r.try_get("start_ms").ok().flatten(),
                            end_ms: r.try_get("end_ms").ok().flatten(),
                            speaker_id: r.try_get("speaker_id").ok().flatten(),
                        },
                    )
                    .collect::<Vec<_>>();

                let ctx = ChunkContext {
                    document_id: &doc.id,
                    source_type: SOURCE_TYPE_SESSION,
                    source_id: None,
                    location_source_type: "session",
                    spine_index: None,
                };
                return Some(chunk_document(
                    &ctx,
                    ChunkInput::SessionTranscript {
                        segments: &segments,
                    },
                    &ChunkOptions::default(),
                ));
            }
        }
    }

    // 2. Podcast transcript segments (handles promoted FileType::Other podcast docs too)
    if let Some(episode_id) = extract_podcast_episode_id(doc) {
        if let Ok(rows) = sqlx::query_as::<_, (i64, i64, String)>(
            "SELECT start_ms, end_ms, text FROM podcast_transcript_segments WHERE episode_id = ?1 ORDER BY segment_index",
        )
        .bind(&episode_id)
        .fetch_all(repo.pool())
        .await
        {
            let segments: Vec<crate::ai_learning::chunker::TranscriptChunkSegment> = rows
                .into_iter()
                .filter_map(|(start_ms, end_ms, text)| {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        return None;
                    }
                    Some(crate::ai_learning::chunker::TranscriptChunkSegment {
                        start: (start_ms.max(0) as f64) / 1000.0,
                        duration: ((end_ms - start_ms).max(0) as f64) / 1000.0,
                        text: trimmed.to_string(),
                    })
                })
                .collect();
            if !segments.is_empty() {
                return Some(chunk_timed_transcript(&doc.id, &segments));
            }
        }
    }

    // 3. Non-session `transcripts` + `transcript_segments` (audiobooks, Whisper/Apple STT jobs)
    if let Ok(rows) = sqlx::query_as::<_, (Option<i64>, Option<i64>, String)>(
        "SELECT ts.start_ms, ts.end_ms, ts.text
         FROM transcript_segments ts
         JOIN transcripts t ON t.id = ts.transcript_id
         WHERE t.book_id = ?1
         ORDER BY t.id, ts.ordinal, ts.start_ms, ts.id",
    )
    .bind(&doc.id)
    .fetch_all(repo.pool())
    .await
    {
        let segments: Vec<crate::ai_learning::chunker::TranscriptChunkSegment> = rows
            .into_iter()
            .filter_map(|(start_ms, end_ms, text)| {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return None;
                }
                let start = (start_ms.unwrap_or(0).max(0) as f64) / 1000.0;
                let end = (end_ms.unwrap_or(0).max(0) as f64) / 1000.0;
                Some(crate::ai_learning::chunker::TranscriptChunkSegment {
                    start,
                    duration: (end - start).max(0.0),
                    text: trimmed.to_string(),
                })
            })
            .collect();
        if !segments.is_empty() {
            return Some(chunk_timed_transcript(&doc.id, &segments));
        }
    }

    // 4. YouTube & local video/audio transcripts (`youtube_transcripts` / `video_transcripts`)
    if matches!(
        doc.file_type,
        crate::models::FileType::Youtube
            | crate::models::FileType::Video
            | crate::models::FileType::Audio
    ) {
        let mut fallback_plain: Option<String> = None;
        let youtube = match repo.get_youtube_transcript_by_document_id(&doc.id).await {
            Ok(Some((plain, json))) => {
                if !plain.trim().is_empty() {
                    fallback_plain = Some(plain);
                }
                Some(json)
            }
            _ => {
                if let Some(video_id) = crate::youtube::extract_video_id(&doc.file_path) {
                    sqlx::query_as::<_, (String, String)>(
                        "SELECT transcript, segments_json FROM youtube_transcripts WHERE video_id = ?1 ORDER BY date_modified DESC LIMIT 1",
                    )
                    .bind(video_id)
                    .fetch_optional(repo.pool())
                    .await
                    .ok()
                    .flatten()
                    .map(|(plain, json)| {
                        if !plain.trim().is_empty() {
                            fallback_plain = Some(plain);
                        }
                        json
                    })
                } else {
                    None
                }
            }
        };

        let json = match youtube {
            Some(json) => Some(json),
            None => sqlx::query_as::<_, (String, String)>(
                "SELECT transcript, segments_json FROM video_transcripts WHERE document_id = ?1 LIMIT 1",
            )
            .bind(&doc.id)
            .fetch_optional(repo.pool())
            .await
            .ok()
            .flatten()
            .map(|(plain, json)| {
                if !plain.trim().is_empty() {
                    fallback_plain = Some(plain);
                }
                json
            }),
        };

        if let Some(raw_json) = json {
            let segments = parse_transcript_segments_json(&raw_json);
            if !segments.is_empty() {
                return Some(chunk_timed_transcript(&doc.id, &segments));
            }
        }

        if let Some(plain) = fallback_plain {
            let ctx = ChunkContext {
                document_id: &doc.id,
                source_type: SOURCE_TYPE_TRANSCRIPT,
                source_id: None,
                location_source_type: SOURCE_TYPE_TRANSCRIPT,
                spine_index: None,
            };
            let chunks = chunk_document(
                &ctx,
                ChunkInput::Plain {
                    text: &plain,
                    heading_heuristic: false,
                },
                &ChunkOptions::default(),
            );
            if !chunks.is_empty() {
                return Some(chunks);
            }
        }
    }

    None
}

/// Rebuild the text chunks from the same PDF pages or preserved markup used
/// by indexing. This reads source material only and leaves the index untouched.
pub(crate) async fn build_rich_text_chunks(
    repo: &Repository,
    ctx: &ChunkContext<'_>,
    file_path: &str,
    html: Option<&str>,
) -> Option<Vec<ChunkModel>> {
    let input = match ctx.location_source_type {
        "pdf" => return build_pdf_page_chunks(repo, ctx, file_path).await,
        "epub" | "html" => ChunkInput::Html {
            html: html.filter(|html| !html.trim().is_empty())?,
        },
        _ => return None,
    };
    Some(chunk_document(ctx, input, &ChunkOptions::default()))
}

async fn build_pdf_page_chunks(
    repo: &Repository,
    ctx: &ChunkContext<'_>,
    file_path: &str,
) -> Option<Vec<ChunkModel>> {
    use crate::ai_learning::models::ChunkLocation;
    use crate::commands::pdf_mobile::registered_pdf_revision;
    use std::{collections::BTreeMap, path::Path};

    let path = Path::new(file_path);
    let revision = registered_pdf_revision(path);
    let native_pages = crate::processor::pdf::extract_pdf_pages_text(file_path).await;
    let projected = match &revision {
        Some(revision) => crate::pdf::semantic_projection::load_pages(repo, ctx.document_id, revision)
            .await
            .unwrap_or_default(),
        None => Vec::new(),
    };
    if registered_pdf_revision(path) != revision {
        return None;
    }
    if native_pages.is_err() && projected.is_empty() {
        return None;
    }
    let pages = native_pages.unwrap_or_default();
    let mut by_page = BTreeMap::<u32, Vec<(ChunkModel, ChunkLocation)>>::new();
    for chunk in chunk_document(ctx, ChunkInput::Paged { pages: &pages }, &ChunkOptions::default()) {
        if let Ok(mut location) = serde_json::from_str::<ChunkLocation>(&chunk.location_json) {
            if let Some(evidence) = &mut location.pdf_evidence {
                evidence.source_revision.clone_from(&revision);
            }
            if let Some(page) = location.page_number.and_then(|number| u32::try_from(number).ok()) {
                by_page.entry(page).or_default().push((chunk, location));
            }
        }
    }
    let revision = revision.as_deref().unwrap_or_default();
    for (page, evidence) in projected {
        let chunks: Vec<_> = crate::ai_learning::chunker::chunk_projected_pdf_page(ctx, page, revision, &evidence)
            .into_iter()
            .filter_map(|chunk| serde_json::from_str(&chunk.location_json).ok().map(|loc| (chunk, loc)))
            .collect();
        if !chunks.is_empty() {
            by_page.insert(page, chunks);
        }
    }
    Some(by_page.into_values().flatten().enumerate().map(|(ordinal, (mut chunk, mut location))| {
        chunk.ordinal = ordinal as i64;
        location.ordinal = chunk.ordinal;
        chunk.location_json = serde_json::to_string(&location).unwrap_or_default();
        chunk
    }).collect())
}

async fn load_html_content(repo: &Repository, document_id: &str) -> Option<String> {
    sqlx::query("SELECT html_content FROM documents WHERE id = ?1")
        .bind(document_id)
        .fetch_optional(repo.pool())
        .await
        .ok()
        .flatten()
        .and_then(|row| {
            row.try_get::<Option<String>, _>("html_content")
                .ok()
                .flatten()
        })
}

/// Extracts become single chunks with their own location payload (task 4.7).
async fn build_extract_chunks(repo: &Repository, document_id: &str) -> Vec<ChunkModel> {
    let Ok(extracts) = repo.list_extracts_by_document(document_id).await else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (ordinal, ext) in extracts.iter().enumerate() {
        let location_type = document_location_type(repo, document_id).await;
        let ctx = ChunkContext {
            document_id,
            source_type: SOURCE_TYPE_EXTRACT,
            source_id: Some(&ext.id),
            location_source_type: &location_type,
            spine_index: None,
        };
        if let Some(chunk) = single_chunk(
            &ctx,
            &ext.content,
            ordinal as i64,
            ext.page_number.map(|p| p as i64),
            0,
            ext.content.chars().count(),
        ) {
            out.push(chunk);
        }
    }
    out
}

/// Annotations (highlights/notes with per-page rects) become single chunks.
async fn build_annotation_chunks(repo: &Repository, document_id: &str) -> Vec<ChunkModel> {
    let rows = sqlx::query(
        "SELECT id, page_number, content FROM annotations WHERE document_id = ?1 ORDER BY date_created",
    )
    .bind(document_id)
    .fetch_all(repo.pool())
    .await;
    let Ok(rows) = rows else { return Vec::new() };

    let location_type = document_location_type(repo, document_id).await;
    let mut out = Vec::new();
    for (ordinal, row) in rows.into_iter().enumerate() {
        let Ok(id) = row.try_get::<String, _>("id") else {
            continue;
        };
        let Ok(page) = row.try_get::<i64, _>("page_number") else {
            continue;
        };
        let content: Option<String> = row.try_get("content").ok().flatten();
        let Some(text) = content else { continue };
        let ctx = ChunkContext {
            document_id,
            source_type: SOURCE_TYPE_ANNOTATION,
            source_id: Some(&id),
            location_source_type: &location_type,
            spine_index: None,
        };
        if let Some(chunk) = single_chunk(
            &ctx,
            &text,
            ordinal as i64,
            Some(page),
            0,
            text.chars().count(),
        ) {
            out.push(chunk);
        }
    }
    out
}

/// Card question fronts become single chunks (answers stay out of the index
/// so they cannot leak into retrieval context).
async fn build_card_chunks(repo: &Repository, document_id: &str) -> Vec<ChunkModel> {
    let Ok(items) = repo.get_learning_items_by_document(document_id).await else {
        return Vec::new();
    };
    let location_type = document_location_type(repo, document_id).await;
    let mut out = Vec::new();
    for (ordinal, item) in items.iter().enumerate() {
        if !repo
            .card_source_index_allowed(&item.id, document_id)
            .await
            .unwrap_or(false)
        {
            continue;
        }
        let question = item
            .cloze_text
            .as_deref()
            .filter(|c| !c.trim().is_empty())
            .unwrap_or(&item.question);
        let ctx = ChunkContext {
            document_id,
            source_type: SOURCE_TYPE_CARD,
            source_id: Some(&item.id),
            location_source_type: &location_type,
            spine_index: None,
        };
        if let Some(chunk) = single_chunk(
            &ctx,
            question,
            ordinal as i64,
            None,
            0,
            question.chars().count(),
        ) {
            out.push(chunk);
        }
    }
    out
}

async fn document_location_type(repo: &Repository, document_id: &str) -> String {
    sqlx::query("SELECT file_type FROM documents WHERE id = ?1")
        .bind(document_id)
        .fetch_optional(repo.pool())
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<String, _>("file_type").ok())
        .map(|ft| match ft.as_str() {
            "pdf" => "pdf".to_string(),
            "epub" => "epub".to_string(),
            "html" => "html".to_string(),
            "markdown" => "markdown".to_string(),
            _ => "text".to_string(),
        })
        .unwrap_or_else(|| "text".to_string())
}

/// Content-hash diff: delete stored chunks whose id is absent from the new
/// set (orphans), insert new ids, and refresh ordinals/locations of retained
/// chunks (cheap metadata UPDATE, never a re-embed).
fn disambiguate_duplicate_chunk_ids(chunks: &[ChunkModel]) -> Vec<ChunkModel> {
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    chunks
        .iter()
        .cloned()
        .map(|mut chunk| {
            let count = seen.entry(chunk.id.clone()).or_insert(0);
            if *count > 0 {
                chunk.id = format!("{}#occ:{}", chunk.id, *count);
            }
            *count += 1;
            chunk
        })
        .collect()
}

async fn apply_chunk_diff(
    repo: &Repository,
    document_id: &str,
    new_chunks: &[ChunkModel],
) -> Result<()> {
    let new_chunks = disambiguate_duplicate_chunk_ids(new_chunks);
    let new_chunks = new_chunks.as_slice();
    let stored_rows: Vec<(String, i64, String, String)> = sqlx::query_as(
        "SELECT id, ordinal, location_json, heading_path FROM semantic_chunks WHERE document_id = ?1",
    )
    .bind(document_id)
    .fetch_all(repo.pool())
    .await?;
    let stored: std::collections::HashMap<_, _> = stored_rows
        .iter()
        .map(|(id, ordinal, location, heading)| (id.as_str(), (*ordinal, location, heading)))
        .collect();

    let new_ids: HashSet<&str> = new_chunks.iter().map(|c| c.id.as_str()).collect();

    // Delete orphans (embeddings cascade via FK).
    let orphans: Vec<&str> = stored
        .keys()
        .copied()
        .filter(|id| !new_ids.contains(id))
        .collect();
    if !orphans.is_empty() {
        let mut tx = repo.pool().begin().await?;
        for id in &orphans {
            sqlx::query("DELETE FROM semantic_chunks WHERE id = ?1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        debug!(
            "removed {} orphan chunks for {}",
            orphans.len(),
            document_id
        );
    }

    // Insert new chunks one by one (per-chunk commit: interruption-safe).
    for chunk in new_chunks {
        let heading_path =
            serde_json::to_string(&chunk.heading_path).unwrap_or_else(|_| "[]".into());
        if let Some(&(ordinal, location, heading)) = stored.get(chunk.id.as_str()) {
            // Locator repairs can change the physical page without moving
            // the ordinal or changing the text and its embedding.
            if ordinal != chunk.ordinal
                || location != &chunk.location_json
                || heading != &heading_path
            {
                sqlx::query(
                    "UPDATE semantic_chunks SET ordinal = ?2, location_json = ?3, heading_path = ?4, updated_at = datetime('now') WHERE id = ?1",
                )
                .bind(&chunk.id)
                .bind(chunk.ordinal)
                .bind(&chunk.location_json)
                .bind(&heading_path)
                .execute(repo.pool())
                .await?;
            }
            continue;
        }
        sqlx::query(
            "INSERT OR IGNORE INTO semantic_chunks
             (id, document_id, source_type, source_id, ordinal, text, heading_path, location_json, content_hash, token_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        )
        .bind(&chunk.id)
        .bind(&chunk.document_id)
        .bind(&chunk.source_type)
        .bind(&chunk.source_id)
        .bind(chunk.ordinal)
        .bind(&chunk.text)
        .bind(&heading_path)
        .bind(&chunk.location_json)
        .bind(&chunk.content_hash)
        .bind(chunk.token_count)
        .execute(repo.pool())
        .await?;
    }
    Ok(())
}

/// Embed chunks whose stored embedding is missing or stale for the active
/// backend. Chunks are committed (inserted) by the diff step; embeddings are
/// upserted per chunk after each batch, and `should_continue` is checked
/// between batches so pause/cancel take effect promptly.
async fn embed_chunks(
    repo: &Repository,
    document_id: &str,
    backend: &EmbeddingBackend,
    should_continue: &mut (dyn FnMut() -> bool + Send),
) -> Result<EmbedOutcome> {
    let rows: Vec<(String, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT c.id, e.embedding_version, e.model
         FROM semantic_chunks c
         LEFT JOIN semantic_chunk_embeddings e ON e.chunk_id = c.id
         WHERE c.document_id = ?1
         ORDER BY c.source_type, c.ordinal",
    )
    .bind(document_id)
    .fetch_all(repo.pool())
    .await?;

    let model = backend.model_name();
    let version = backend.embedding_version();

    // Staleness (task 4.4): no embedding row, or the stored row's
    // version/model no longer match the active backend. A mismatched
    // content_hash is impossible for retained rows (chunk ids are
    // content-addressed), so version/model drive re-embedding; the stored
    // content_hash is refreshed on every upsert.
    let pending: Vec<String> = rows
        .iter()
        .filter(|(_, ev, em)| match (ev, em) {
            (Some(v), Some(m)) => *v != version || m.as_str() != model.as_str(),
            _ => true,
        })
        .map(|(id, ..)| id.clone())
        .collect();

    let total_chunks = rows.len() as i64;
    let done_before = total_chunks - pending.len() as i64;

    if pending.is_empty() {
        return Ok(EmbedOutcome {
            embedded: total_chunks,
            error: None,
        });
    }

    if !backend.is_available() {
        // No backend (on-device stub before task 4.5, provider down): store
        // nothing; chunks remain for lexical retrieval. Not an error.
        info!(
            "skipping embeddings for {} ({} chunks): backend {} unavailable",
            document_id,
            pending.len(),
            backend.kind_name()
        );
        return Ok(EmbedOutcome {
            embedded: done_before,
            error: None,
        });
    }

    let mut embedded = done_before;
    for batch in pending.chunks(EMBED_BATCH_SIZE) {
        if !should_continue() {
            return Ok(EmbedOutcome {
                embedded,
                error: None,
            });
        }
        let mut texts: Vec<String> = Vec::with_capacity(batch.len());
        for id in batch {
            texts.push(chunk_text(repo, id).await.unwrap_or_default());
        }
        // Only on-device and deterministic mocks prove local execution.
        // A configured Ollama URL may point to a remote machine.
        let remote = !matches!(
            backend.kind(),
            crate::ai_learning::embeddings_backend::EmbeddingBackendKind::OnDevice
                | crate::ai_learning::embeddings_backend::EmbeddingBackendKind::Mock
        );
        repo.ensure_document_ai_allowed(document_id, remote).await?;
        repo.ensure_index_batch_sources_allowed(batch, document_id)
            .await?;
        let vectors: Vec<Vec<f32>> = match backend.embed_texts(&texts).await {
            Ok(v) => v,
            Err(EmbeddingUnavailable { reason }) => {
                // If a multi-chunk batch failed (e.g. one oversized chunk or transient timeout),
                // fall back to single-chunk embedding so healthy chunks still commit.
                if batch.len() > 1 {
                    let mut last_reason = reason.clone();
                    let mut any_failed = false;
                    for (chunk_id, text) in batch.iter().zip(texts.iter()) {
                        if !should_continue() {
                            return Ok(EmbedOutcome {
                                embedded,
                                error: None,
                            });
                        }
                        match backend.embed_texts(std::slice::from_ref(text)).await {
                            Ok(single_vecs) => {
                                if let Some(vector) = single_vecs.first() {
                                    if !vector.is_empty() {
                                        store_embedding_row(
                                            repo,
                                            chunk_id,
                                            vector,
                                            &model,
                                            version,
                                            document_id,
                                        )
                                        .await?;
                                        embedded += 1;
                                    }
                                }
                            }
                            Err(EmbeddingUnavailable { reason: item_reason }) => {
                                any_failed = true;
                                last_reason = item_reason;
                            }
                        }
                    }
                    if any_failed {
                        warn!(
                            "embedding batch partially failed for {}: {}",
                            document_id, last_reason
                        );
                        return Ok(EmbedOutcome {
                            embedded,
                            error: Some(format_safe_embedding_error(&last_reason)),
                        });
                    }
                    continue;
                }
                warn!("embedding batch failed for {}: {}", document_id, reason);
                return Ok(EmbedOutcome {
                    embedded,
                    error: Some(format_safe_embedding_error(&reason)),
                });
            }
        };
        for (chunk_id, vector) in batch.iter().zip(vectors.iter()) {
            if vector.is_empty() {
                continue;
            }
            store_embedding_row(repo, chunk_id, vector, &model, version, document_id).await?;
            embedded += 1;
        }
    }
    Ok(EmbedOutcome {
        embedded,
        error: (embedded < total_chunks)
            .then(|| "Embedding backend returned incomplete vectors".into()),
    })
}

fn format_safe_embedding_error(reason: &str) -> String {
    let trimmed = reason.trim();
    if trimmed.is_empty() {
        return "Embedding backend could not complete the request".to_string();
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("context length") || lower.contains("too many tokens") {
        "Embedding failed: chunk exceeded the model context length".to_string()
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "Embedding failed: embedding request timed out".to_string()
    } else if lower.contains("connection refused") || lower.contains("connect error") {
        "Embedding failed: could not connect to embedding provider".to_string()
    } else {
        "Embedding backend could not complete the request".to_string()
    }
}

async fn chunk_text(repo: &Repository, chunk_id: &str) -> Option<String> {
    sqlx::query("SELECT text FROM semantic_chunks WHERE id = ?1")
        .bind(chunk_id)
        .fetch_optional(repo.pool())
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<String, _>("text").ok())
}

/// Upsert one embedding row (per-chunk commit).
async fn store_embedding_row(
    repo: &Repository,
    chunk_id: &str,
    vector: &[f32],
    model: &str,
    version: i64,
    document_id: &str,
) -> Result<()> {
    let bytes = embedding_bytes(vector);
    let dimension = vector.len() as i64;
    // Content hash of the chunk's current text (staleness check on read).
    let content_hash: String =
        sqlx::query_scalar("SELECT content_hash FROM semantic_chunks WHERE id = ?1")
            .bind(chunk_id)
            .fetch_optional(repo.pool())
            .await?
            .unwrap_or_default();

    sqlx::query(
        "INSERT INTO semantic_chunk_embeddings (chunk_id, embedding, model, dimension, embedding_version, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(chunk_id) DO UPDATE SET
            embedding = excluded.embedding,
            model = excluded.model,
            dimension = excluded.dimension,
            embedding_version = excluded.embedding_version,
            content_hash = excluded.content_hash",
    )
    .bind(chunk_id)
    .bind(&bytes)
    .bind(model)
    .bind(dimension)
    .bind(version)
    .bind(&content_hash)
    .execute(repo.pool())
    .await?;
    Ok(())
}

fn embedding_bytes(vector: &[f32]) -> Vec<u8> {
    let mut bytes = vec![0u8; vector.len() * 4];
    byteorder::LittleEndian::write_f32_into(vector, &mut bytes);
    bytes
}

// ── ai_index_state helpers ─────────────────────────────────────────────────

async fn set_state(
    repo: &Repository,
    document_id: &str,
    state: IndexState,
    error: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO ai_index_state (document_id, state, error) VALUES (?1, ?2, ?3)
         ON CONFLICT(document_id) DO UPDATE SET
            state = excluded.state,
            error = excluded.error,
            updated_at = datetime('now')",
    )
    .bind(document_id)
    .bind(state.as_str())
    .bind(error)
    .execute(repo.pool())
    .await?;
    Ok(())
}

async fn set_state_raw(
    repo: &Repository,
    document_id: &str,
    state: IndexState,
    chunks_indexed: i64,
    total_chunks: i64,
    error: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO ai_index_state (document_id, state, chunks_indexed, total_chunks, error)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(document_id) DO UPDATE SET
            state = excluded.state,
            chunks_indexed = excluded.chunks_indexed,
            total_chunks = excluded.total_chunks,
            error = excluded.error,
            updated_at = datetime('now')",
    )
    .bind(document_id)
    .bind(state.as_str())
    .bind(chunks_indexed)
    .bind(total_chunks)
    .bind(error)
    .execute(repo.pool())
    .await?;
    Ok(())
}

async fn upsert_state_row(
    repo: &Repository,
    document_id: &str,
    state: IndexState,
    backend: Option<&EmbeddingBackend>,
    chunks_indexed: i64,
    total_chunks: i64,
    error: Option<&str>,
) -> Result<()> {
    let (version, model) = match backend {
        Some(b) => (Some(b.embedding_version()), Some(b.model_name())),
        None => (None, None),
    };
    sqlx::query(
        "INSERT INTO ai_index_state
            (document_id, state, embedding_version, chunks_indexed, total_chunks, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(document_id) DO UPDATE SET
            state = excluded.state,
            embedding_version = excluded.embedding_version,
            chunks_indexed = excluded.chunks_indexed,
            total_chunks = excluded.total_chunks,
            error = excluded.error,
            updated_at = datetime('now')",
    )
    .bind(document_id)
    .bind(state.as_str())
    .bind(version)
    .bind(chunks_indexed)
    .bind(total_chunks)
    .bind(error)
    .execute(repo.pool())
    .await?;
    let _ = model;
    Ok(())
}

/// Wipe the rebuildable index (chunks cascade their embeddings).
pub async fn reset_index(repo: &Repository) -> Result<u64> {
    let result = sqlx::query("DELETE FROM semantic_chunks")
        .execute(repo.pool())
        .await?;
    sqlx::query("DELETE FROM ai_index_state")
        .execute(repo.pool())
        .await?;
    Ok(result.rows_affected())
}

/// Mark every indexed document stale (used when the embedding model changes).
pub async fn mark_all_stale(repo: &Repository) -> Result<u64> {
    let result = sqlx::query("UPDATE ai_index_state SET state = 'stale' WHERE state = 'indexed'")
        .execute(repo.pool())
        .await?;
    Ok(result.rows_affected())
}

/// Documents worth bulk-indexing: non-archived, non-excluded docs with text
/// content, HTML content, transcripts, sessions, or extracts.
async fn list_indexable_documents(repo: &Repository) -> Result<Vec<String>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT d.id FROM documents d
         WHERE d.is_archived = 0
           AND d.is_ai_excluded = 0
           AND (
                length(trim(COALESCE(d.content, ''))) > 0
                OR EXISTS (SELECT 1 FROM pdf_page_evidence pe WHERE pe.document_id = d.id)
                OR length(trim(COALESCE(d.html_content, ''))) > 0
                OR EXISTS (SELECT 1 FROM youtube_transcripts yt WHERE yt.document_id = d.id)
                OR EXISTS (SELECT 1 FROM video_transcripts vt WHERE vt.document_id = d.id)
                OR EXISTS (SELECT 1 FROM transcripts t WHERE t.book_id = d.id)
                OR EXISTS (SELECT 1 FROM recording_sessions rs WHERE rs.document_id = d.id AND rs.transcript_id IS NOT NULL)
                OR EXISTS (SELECT 1 FROM extracts e WHERE e.document_id = d.id)
           )",
    )
    .fetch_all(repo.pool())
    .await?;
    Ok(ids)
}

/// Deterministically builds/refreshes canonical chunks (and `semantic_chunks_fts`)
/// for the specified documents without running paid embeddings. Respects
/// `is_archived` and `is_ai_excluded`.
pub async fn ensure_documents_chunks_indexed(
    repo: &Repository,
    document_ids: &[String],
) -> Result<Vec<DocumentIndexStatus>> {
    let mut seen = HashSet::new();
    let ordered_ids: Vec<String> = document_ids
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .collect();
    if ordered_ids.is_empty() {
        return Ok(Vec::new());
    }

    for doc_id in &ordered_ids {
        let Some(doc) = repo.get_document(doc_id).await? else {
            continue;
        };
        if doc.is_archived || doc.is_ai_excluded {
            continue;
        }

        let readiness: Option<(Option<String>, Option<bool>, i64)> = sqlx::query_as(
            "SELECT i.state,
                    (i.document_id IS NOT NULL
                     AND datetime(i.updated_at) >= datetime(COALESCE(d.content_updated_at, d.date_added, ''))) AS is_fresh,
                    (SELECT COUNT(*) FROM semantic_chunks sc WHERE sc.document_id = d.id) AS chunk_count
             FROM documents d
             LEFT JOIN ai_index_state i ON i.document_id = d.id
             WHERE d.id = ?1
             LIMIT 1",
        )
        .bind(doc_id)
        .fetch_optional(repo.pool())
        .await?;

        let already_ready = readiness.is_some_and(|(state, is_fresh, chunk_count)| {
            chunk_count > 0
                && is_fresh.unwrap_or(false)
                && matches!(state.as_deref(), Some("indexed" | "lexical_only"))
        });
        if already_ready {
            continue;
        }

        let content = doc.content.clone().unwrap_or_default();
        let mut all_chunks = build_document_chunks(repo, &doc, &content).await;
        all_chunks.extend(build_extract_chunks(repo, doc_id).await);
        all_chunks.extend(build_annotation_chunks(repo, doc_id).await);
        all_chunks.extend(build_card_chunks(repo, doc_id).await);

        apply_chunk_diff(repo, doc_id, &all_chunks).await?;

        if all_chunks.is_empty() {
            upsert_state_row(repo, doc_id, IndexState::Indexed, None, 0, 0, None).await?;
            continue;
        }

        let total = all_chunks.len() as i64;
        let embedded: i64 = sqlx::query_scalar(
            "SELECT COUNT(DISTINCT e.chunk_id)
             FROM semantic_chunk_embeddings e
             JOIN semantic_chunks c ON c.id = e.chunk_id
             WHERE c.document_id = ?1",
        )
        .bind(doc_id)
        .fetch_one(repo.pool())
        .await
        .unwrap_or(0);

        let next_state = if embedded >= total {
            IndexState::Indexed
        } else {
            IndexState::LexicalOnly
        };
        set_state_raw(repo, doc_id, next_state, embedded, total, None).await?;
    }

    let mut builder: sqlx::QueryBuilder<sqlx::Sqlite> = sqlx::QueryBuilder::new(
        "SELECT document_id, state, embedding_version, chunks_indexed, total_chunks, error, updated_at
         FROM ai_index_state
         WHERE document_id IN (",
    );
    let mut separated = builder.separated(", ");
    for id in &ordered_ids {
        separated.push_bind(id);
    }
    separated.push_unseparated(")");

    let rows = builder.build().fetch_all(repo.pool()).await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(DocumentIndexStatus {
                document_id: row.try_get("document_id").ok()?,
                state: row.try_get("state").ok()?,
                embedding_version: row.try_get("embedding_version").ok(),
                chunks_indexed: row.try_get("chunks_indexed").ok()?,
                total_chunks: row.try_get("total_chunks").ok()?,
                error: row.try_get("error").ok(),
                updated_at: row.try_get("updated_at").ok()?,
            })
        })
        .collect())
}

/// Per-document status rows, most recently updated first.
pub async fn document_statuses(repo: &Repository, limit: i64) -> Result<Vec<DocumentIndexStatus>> {
    let rows = sqlx::query(
        "SELECT document_id, state, embedding_version, chunks_indexed, total_chunks, error, updated_at
         FROM ai_index_state
         ORDER BY updated_at DESC
         LIMIT ?1",
    )
    .bind(limit)
    .fetch_all(repo.pool())
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(DocumentIndexStatus {
                document_id: row.try_get("document_id").ok()?,
                state: row.try_get("state").ok()?,
                embedding_version: row.try_get("embedding_version").ok(),
                chunks_indexed: row.try_get("chunks_indexed").ok()?,
                total_chunks: row.try_get("total_chunks").ok()?,
                error: row.try_get("error").ok(),
                updated_at: row.try_get("updated_at").ok()?,
            })
        })
        .collect())
}

/// Aggregate status combining DB counts with worker runtime state.
pub async fn aggregate_status(
    repo: &Repository,
    runtime: &IndexerRuntimeStatus,
) -> Result<AggregateIndexStatus> {
    let counts: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT
            COUNT(*),
            COALESCE(SUM(CASE WHEN state = 'indexed' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN state = 'indexing' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN state = 'stale' THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END), 0)
         FROM ai_index_state",
    )
    .fetch_one(repo.pool())
    .await?;
    let coalesce = |v: i64| if v < 0 { 0 } else { v };

    let (total_chunks,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM semantic_chunks")
        .fetch_one(repo.pool())
        .await?;
    let (total_embeddings, storage_bytes): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*), COALESCE(SUM(LENGTH(embedding)), 0) FROM semantic_chunk_embeddings",
    )
    .fetch_one(repo.pool())
    .await?;

    let usage_rows: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT model, embedding_version, COUNT(*) FROM semantic_chunk_embeddings
         GROUP BY model, embedding_version
         ORDER BY COUNT(*) DESC",
    )
    .fetch_all(repo.pool())
    .await?;

    Ok(AggregateIndexStatus {
        total_documents: counts.0,
        indexed_documents: coalesce(counts.1),
        queued_documents: coalesce(counts.2),
        indexing_documents: coalesce(counts.3),
        stale_documents: coalesce(counts.4),
        failed_documents: coalesce(counts.5),
        total_chunks,
        total_embeddings,
        embedding_storage_bytes: storage_bytes,
        embedding_models: usage_rows
            .into_iter()
            .map(|(model, version, chunks)| EmbeddingModelUsage {
                model,
                embedding_version: version,
                chunks,
            })
            .collect(),
        paused: runtime.paused,
        active_document: runtime.active_document.clone(),
        pending_documents: runtime.pending_documents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_learning::embeddings_backend::{EmbeddingBackend, EmbeddingBackendKind};
    use crate::ai_learning::models::IndexState;
    use crate::ai_learning::test_support::{seed_document, test_pool};

    #[tokio::test]
    async fn pdf_index_repairs_a_page_locator_without_changing_chunk_identity() {
        let pool = test_pool().await;
        seed_document(&pool, "pdf-page-repair", "", "pdf").await;
        let repo = Repository::new(pool.clone());
        let ctx = ChunkContext {
            document_id: "pdf-page-repair",
            source_type: SOURCE_TYPE_DOCUMENT,
            source_id: None,
            location_source_type: "pdf",
            spine_index: None,
        };
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/pdf-baseline/blank-middle-page.pdf"
        );
        let and_blank = build_rich_text_chunks(&repo, &ctx, path, None).await.unwrap();
        let page_of = |chunk: &ChunkModel| {
            serde_json::from_str::<crate::ai_learning::models::ChunkLocation>(&chunk.location_json)
                .unwrap()
                .page_number
        };
        let third = and_blank
            .iter()
            .find(|chunk| chunk.text.contains("Third physical page"))
            .unwrap();
        assert_eq!(page_of(third), Some(3));
        let mut old = third.clone();
        let mut locator: serde_json::Value = serde_json::from_str(&old.location_json).unwrap();
        locator["pageNumber"] = serde_json::json!(2);
        old.location_json = locator.to_string();
        apply_chunk_diff(&repo, ctx.document_id, &[old])
            .await
            .unwrap();
        apply_chunk_diff(&repo, ctx.document_id, &and_blank)
            .await
            .unwrap();
        let repaired: String =
            sqlx::query_scalar("SELECT location_json FROM semantic_chunks WHERE id = ?1")
                .bind(&third.id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(repaired, third.location_json);
    }

    #[tokio::test]
    async fn duplicate_text_chunks_retain_per_occurrence_identities_and_locators() {
        let pool = test_pool().await;
        seed_document(&pool, "pdf-dup-text", "", "pdf").await;
        let repo = Repository::new(pool.clone());
        let first = ChunkModel {
            id: "shared-content-id".to_string(),
            document_id: "pdf-dup-text".to_string(),
            source_type: SOURCE_TYPE_DOCUMENT.to_string(),
            source_id: None,
            ordinal: 0,
            text: "Repeated passage across pages.".to_string(),
            heading_path: vec![],
            location_json: serde_json::json!({
                "sourceType": "pdf",
                "ordinal": 0,
                "pageNumber": 1
            })
            .to_string(),
            content_hash: "dup-hash".to_string(),
            token_count: 4,
        };
        let mut second = first.clone();
        second.ordinal = 1;
        second.location_json = serde_json::json!({
            "sourceType": "pdf",
            "ordinal": 1,
            "pageNumber": 3
        })
        .to_string();

        apply_chunk_diff(&repo, "pdf-dup-text", &[first, second])
            .await
            .unwrap();

        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, location_json FROM semantic_chunks WHERE document_id = 'pdf-dup-text' ORDER BY ordinal",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "shared-content-id");
        assert_eq!(rows[1].0, "shared-content-id#occ:1");
        assert!(rows[0].1.contains("\"pageNumber\":1"));
        assert!(rows[1].1.contains("\"pageNumber\":3"));
    }

    pub(crate) async fn state_of(pool: &sqlx::SqlitePool, id: &str) -> Option<(String, i64, i64)> {
        sqlx::query_as(
            "SELECT state, chunks_indexed, total_chunks FROM ai_index_state WHERE document_id = ?1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .expect("read state")
    }

    pub(crate) fn mock_backend() -> EmbeddingBackend {
        EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-test",
        }
    }

    #[tokio::test]
    async fn lifecycle_state_machine_reaches_indexed() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        let content = (0..30)
            .map(|i| format!("Paragraph {i} with enough text to accumulate into several chunks of moderate size."))
            .collect::<Vec<_>>()
            .join("\n\n");
        seed_document(&pool, "doc-1", &content, "markdown").await;

        let backend = mock_backend();
        let outcome = index_document_once(&repo, "doc-1", &backend, &mut || true)
            .await
            .expect("index");
        assert_eq!(outcome, IndexOutcome::Completed);

        let state = state_of(&pool, "doc-1").await.expect("state row exists");
        assert_eq!(state.0, "indexed");
        assert_eq!(state.1, state.2, "all chunks indexed");
        assert!(state.2 > 1, "multiple chunks expected");

        let (chunks, embeddings): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM semantic_chunks WHERE document_id = 'doc-1'),
                    (SELECT COUNT(*) FROM semantic_chunk_embeddings)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(chunks, state.2);
        assert_eq!(embeddings, chunks, "every chunk embedded");
    }

    #[tokio::test]
    async fn hash_diff_reembeds_only_changed_chunks() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        let content = format!(
            "# Head\n\n{}",
            (0..40)
                .map(|i| format!(
                    "Original paragraph {i} with stable content that will not change at all."
                ))
                .collect::<Vec<_>>()
                .join("\n\n")
        );
        seed_document(&pool, "doc-2", &content, "markdown").await;

        let backend = mock_backend();
        index_document_once(&repo, "doc-2", &backend, &mut || true)
            .await
            .expect("first index");

        // Record the stored chunk ids (content-addressed) before the edit.
        let ids_before: Vec<String> = sqlx::query_as(
            "SELECT id FROM semantic_chunks WHERE document_id = 'doc-2' ORDER BY ordinal",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .into_iter()
        .map(|(id,)| id)
        .collect();
        assert!(
            ids_before.len() >= 2,
            "expected several chunks, got {}",
            ids_before.len()
        );

        // Edit: append one new paragraph — every unchanged paragraph keeps
        // its content hash, so only the tail chunk(s) change identity.
        let edited = format!(
            "{content}\n\nA brand new paragraph with fresh unique content never seen before in this document."
        );
        sqlx::query("UPDATE documents SET content = ?1 WHERE id = 'doc-2'")
            .bind(&edited)
            .execute(&pool)
            .await
            .unwrap();

        index_document_once(&repo, "doc-2", &backend, &mut || true)
            .await
            .expect("reindex");

        let ids_after: Vec<String> = sqlx::query_as(
            "SELECT id FROM semantic_chunks WHERE document_id = 'doc-2' ORDER BY ordinal",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
        .into_iter()
        .map(|(id,)| id)
        .collect();

        // Most chunk ids are retained: only the chunks whose text actually
        // changed got new content-addressed ids. This is the incremental
        // guarantee — an edit to one paragraph must not re-embed the rest.
        let retained = ids_after
            .iter()
            .filter(|id| ids_before.contains(id))
            .count();
        assert!(
            retained * 2 > ids_before.len(),
            "expected most chunks retained, {retained}/{} ",
            ids_before.len()
        );
        assert!(
            retained < ids_after.len(),
            "the edited tail must produce at least one new chunk"
        );

        // Every stored chunk has a current embedding (nothing orphaned).
        let (missing,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM semantic_chunks c
             LEFT JOIN semantic_chunk_embeddings e ON e.chunk_id = c.id
             WHERE e.chunk_id IS NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(missing, 0);

        let state = state_of(&pool, "doc-2").await.unwrap();
        assert_eq!(state.0, "indexed");
    }

    #[tokio::test]
    async fn interruption_retains_committed_chunks_and_resumes() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        let content = (0..80)
            .map(|i| format!("Paragraph {i} with sufficient text to force many chunks across several sections."))
            .collect::<Vec<_>>()
            .join("\n\n");
        seed_document(&pool, "doc-3", &content, "text").await;

        let backend = mock_backend();
        // "Drop the worker" mid-run: stop after the first embedding batch.
        let mut calls = 0;
        let outcome = index_document_once(&repo, "doc-3", &backend, &mut || {
            calls += 1;
            calls <= 2
        })
        .await
        .expect("interrupted run");

        let state = state_of(&pool, "doc-3").await.expect("state exists");
        assert_eq!(
            state.0, "queued",
            "interrupted doc returns to queued, got {}",
            state.0
        );
        let (committed,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM semantic_chunks WHERE document_id = 'doc-3'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(committed > 0, "chunks committed before interruption");

        // Resume: full run completes; diff skips already-stored chunks.
        let outcome2 = index_document_once(&repo, "doc-3", &backend, &mut || true)
            .await
            .expect("resume run");
        assert_eq!(outcome2, IndexOutcome::Completed);
        let state = state_of(&pool, "doc-3").await.unwrap();
        assert_eq!(state.0, "indexed");
        assert_eq!(state.1, state.2);
        assert!(matches!(
            outcome,
            IndexOutcome::Paused | IndexOutcome::Cancelled | IndexOutcome::Completed
        ));
    }

    #[tokio::test]
    async fn deletion_cascades_chunks_and_state() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(
            &pool,
            "doc-4",
            "Some content to index here. More text follows for chunking. ",
            "text",
        )
        .await;
        let backend = mock_backend();
        index_document_once(&repo, "doc-4", &backend, &mut || true)
            .await
            .expect("index");

        let (chunks,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM semantic_chunks WHERE document_id = 'doc-4'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(chunks > 0);

        sqlx::query("DELETE FROM documents WHERE id = 'doc-4'")
            .execute(&pool)
            .await
            .unwrap();

        let (chunks_after, state_after, embeddings_after): (i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM semantic_chunks WHERE document_id = 'doc-4'),
                    (SELECT COUNT(*) FROM ai_index_state WHERE document_id = 'doc-4'),
                    (SELECT COUNT(*) FROM semantic_chunk_embeddings)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(chunks_after, 0, "chunks cascade with document");
        assert_eq!(state_after, 0, "state cascades with document");
        assert_eq!(embeddings_after, 0, "embeddings cascade with chunks");
    }

    #[tokio::test]
    async fn unavailable_backend_stores_chunks_without_embeddings() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(
            &pool,
            "doc-5",
            "Text content for lexical-only indexing. ",
            "text",
        )
        .await;
        let backend = EmbeddingBackend::OnDevice {
            model: crate::ai_learning::embeddings_backend::ON_DEVICE_MODEL,
        };
        index_document_once(&repo, "doc-5", &backend, &mut || true)
            .await
            .expect("index without backend");

        let state = state_of(&pool, "doc-5").await.unwrap();
        assert_eq!(state.0, "indexed");
        let (chunks, embeddings): (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM semantic_chunks WHERE document_id = 'doc-5'),
                    (SELECT COUNT(*) FROM semantic_chunk_embeddings)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(chunks > 0);
        assert_eq!(embeddings, 0, "no embeddings stored without a backend");
    }

    #[tokio::test]
    async fn embedding_error_preserves_lexical_readiness() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(
            &pool,
            "embedding-failure",
            "Quantum tunneling explains alpha decay.",
            "text",
        )
        .await;
        let backend = EmbeddingBackend::OnDeviceLive {
            model: crate::ai_learning::embeddings_backend::ON_DEVICE_MODEL,
            embedder: std::sync::Arc::new(|_, _, _| {
                Err(
                    crate::ai_learning::embeddings_backend::OnDeviceEmbedFailure {
                        code: "inference_failed".into(),
                        message: "provider error detail".into(),
                    },
                )
            }),
        };
        index_document_once(&repo, "embedding-failure", &backend, &mut || true)
            .await
            .expect("record embedding failure");
        let (state, embedded, total) = state_of(&pool, "embedding-failure").await.unwrap();
        assert_eq!((state.as_str(), embedded, total), ("lexical_only", 0, 1));
        let error: String = sqlx::query_scalar(
            "SELECT error FROM ai_index_state WHERE document_id = 'embedding-failure'",
        )
        .fetch_one(&pool)
        .await
        .expect("read safe embedding error");
        assert_eq!(error, "Embedding backend could not complete the request");
        let chunks: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM semantic_chunks WHERE document_id = 'embedding-failure'",
        )
        .fetch_one(&pool)
        .await
        .expect("read lexical chunks");
        assert_eq!(chunks, 1);
    }

    #[tokio::test]
    async fn extra_sources_become_single_chunks() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(
            &pool,
            "doc-6",
            "Document body content for chunking purposes. ",
            "pdf",
        )
        .await;

        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, date_created, date_modified)
             VALUES ('ext-1', 'doc-6', 'An extract about something interesting.', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO annotations (id, document_id, type, page_number, content, color, date_created, date_modified)
             VALUES ('ann-1', 'doc-6', 'note', 7, 'A note scribbled on page seven.', '#FFFF00', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO learning_items (id, item_type, question, answer, cloze_text, document_id, date_created, date_modified, due_date)
             VALUES ('item-1', 'flashcard', 'What is the answer?', '42', NULL, 'doc-6', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let backend = mock_backend();
        index_document_once(&repo, "doc-6", &backend, &mut || true)
            .await
            .expect("index");

        let rows: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT source_type, source_id FROM semantic_chunks WHERE document_id = 'doc-6' ORDER BY source_type",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        let types: Vec<&str> = rows.iter().map(|(t, _)| t.as_str()).collect();
        assert!(types.contains(&"document"), "document chunks: {:?}", types);
        assert!(types.contains(&"extract"), "extract chunk: {:?}", types);
        assert!(
            types.contains(&"annotation"),
            "annotation chunk: {:?}",
            types
        );
        assert!(types.contains(&"card"), "card chunk: {:?}", types);

        let extract_chunk = rows.iter().find(|(t, _)| t == "extract").unwrap();
        assert_eq!(extract_chunk.1.as_deref(), Some("ext-1"));

        // Extract location carries the pdf source type + extract id.
        let location: String = sqlx::query_scalar(
            "SELECT location_json FROM semantic_chunks WHERE document_id = 'doc-6' AND source_type = 'extract'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let loc: serde_json::Value = serde_json::from_str(&location).unwrap();
        assert_eq!(loc["sourceType"], "pdf");
        assert_eq!(loc["extractId"], "ext-1");

        // Card front indexes the question.
        let card_text: String = sqlx::query_scalar(
            "SELECT text FROM semantic_chunks WHERE document_id = 'doc-6' AND source_type = 'card'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(card_text, "What is the answer?");
    }

    #[tokio::test]
    async fn deleted_extract_orphan_removed_on_reindex() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-7", "Body content. ", "text").await;
        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, date_created, date_modified)
             VALUES ('ext-doomed', 'doc-7', 'Extract that will be deleted.', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let backend = mock_backend();
        index_document_once(&repo, "doc-7", &backend, &mut || true)
            .await
            .expect("index");

        sqlx::query("DELETE FROM extracts WHERE id = 'ext-doomed'")
            .execute(&pool)
            .await
            .unwrap();

        index_document_once(&repo, "doc-7", &backend, &mut || true)
            .await
            .expect("reindex");

        let (orphans,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM semantic_chunks WHERE source_id = 'ext-doomed'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(orphans, 0, "deleted extract's chunk removed by diff");
    }

    #[tokio::test]
    async fn embedding_version_change_reembeds() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(
            &pool,
            "doc-8",
            "Content that will be re-embedded after a version bump. ",
            "text",
        )
        .await;

        let v1 = EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-a",
        };
        index_document_once(&repo, "doc-8", &v1, &mut || true)
            .await
            .expect("index v1");

        let (version_a,): (i64,) =
            sqlx::query_as("SELECT embedding_version FROM semantic_chunk_embeddings LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();

        let v2 = EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-b",
        };
        index_document_once(&repo, "doc-8", &v2, &mut || true)
            .await
            .expect("reindex v2");

        let (versions,): (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT embedding_version) FROM semantic_chunk_embeddings",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(versions, 1, "all embeddings converge on the new version");
        let (version_b,): (i64,) =
            sqlx::query_as("SELECT embedding_version FROM semantic_chunk_embeddings LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_ne!(version_a, version_b, "version actually changed");
        assert_eq!(version_b, v2.embedding_version());
    }

    #[tokio::test]
    async fn reset_wipes_index_but_not_documents() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-9", "Content to index then reset. ", "text").await;
        let backend = mock_backend();
        index_document_once(&repo, "doc-9", &backend, &mut || true)
            .await
            .expect("index");

        reset_index(&repo).await.expect("reset");

        let (chunks, state, docs): (i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM semantic_chunks),
                    (SELECT COUNT(*) FROM ai_index_state),
                    (SELECT COUNT(*) FROM documents WHERE id = 'doc-9')",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(chunks, 0);
        assert_eq!(state, 0);
        assert_eq!(docs, 1, "user content survives an index reset");
    }

    #[tokio::test]
    async fn empty_content_documents_finish_indexed_with_zero_chunks() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-10", "", "pdf").await;
        let backend = mock_backend();
        index_document_once(&repo, "doc-10", &backend, &mut || true)
            .await
            .expect("index empty");

        let state = state_of(&pool, "doc-10").await.unwrap();
        assert_eq!(state.0, "indexed");
        assert_eq!(state.2, 0);
    }

    #[tokio::test]
    async fn queue_lifecycle_pause_resume_cancel() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "q-1", "Queue test content one. ", "text").await;
        seed_document(&pool, "q-2", "Queue test content two. ", "text").await;

        let factory: BackendFactory = Arc::new(|| EmbeddingBackend::Mock {
            dim: 32,
            model: "mock-queue",
        });
        let queue = IndexerQueue::new(repo.clone(), factory);

        queue.enqueue_all(false).expect("enqueue all");
        queue.pause().expect("pause");
        // Give the worker a moment to process commands.
        for _ in 0..200 {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            if queue.runtime_status().paused {
                break;
            }
        }
        // Pause takes effect; resume drains the backlog.
        queue.resume().expect("resume");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let s1 = state_of(&pool, "q-1").await;
            let s2 = state_of(&pool, "q-2").await;
            if matches!(&s1, Some(s) if s.0 == "indexed")
                && matches!(&s2, Some(s) if s.0 == "indexed")
            {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "queue did not finish in time: {:?} {:?}",
                s1,
                s2
            );
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }

        // Cancel removes a queued document before it runs.
        queue.pause().expect("pause for cancel test");
        for _ in 0..200 {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            if queue.runtime_status().paused {
                break;
            }
        }
        queue.enqueue_document("q-2").expect("enqueue q-2 again");
        queue.cancel_document("q-2").expect("cancel");
        queue.resume().expect("resume");
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        queue.shutdown().ok();
    }

    #[tokio::test]
    async fn mark_all_stale_flags_indexed_rows() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-11", "Staleness marker test. ", "text").await;
        let backend = mock_backend();
        index_document_once(&repo, "doc-11", &backend, &mut || true)
            .await
            .expect("index");

        let updated = mark_all_stale(&repo).await.expect("mark stale");
        assert_eq!(updated, 1);
        assert_eq!(state_of(&pool, "doc-11").await.unwrap().0, "stale");
        assert_eq!(
            EmbeddingBackendKind::Mock.as_str(),
            "mock",
            "sanity: enum naming"
        );
    }

    #[tokio::test]
    async fn aggregate_status_counts_states() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-12", "Aggregate status content. ", "text").await;
        let backend = mock_backend();
        index_document_once(&repo, "doc-12", &backend, &mut || true)
            .await
            .expect("index");

        let runtime = IndexerRuntimeStatus::default();
        let status = aggregate_status(&repo, &runtime).await.expect("aggregate");
        assert_eq!(status.indexed_documents, 1);
        assert_eq!(status.total_documents, 1);
        assert!(status.total_chunks > 0);
        assert_eq!(status.total_embeddings as i64, status.total_chunks);
        assert!(!status.embedding_models.is_empty());
        assert_eq!(status.embedding_models[0].model, "mock-test");

        let docs = document_statuses(&repo, 10).await.expect("doc statuses");
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].state, "indexed");
        assert_eq!(IndexState::parse("indexed"), Some(IndexState::Indexed));
    }

    #[tokio::test]
    async fn end_to_end_youtube_transcript_empty_content_indexes_retrieves_and_verifies() {
        use crate::ai_learning::models::{RetrievalFilters, SOURCE_TYPE_TRANSCRIPT};
        use crate::ai_learning::retrieval::retrieve;
        use crate::database::StudySourceRepository;
        use crate::models::{
            RevisionKind, StudySourceChunk, StudySourceNavigation, StudySourceRefInput,
            StudySourceStatus,
        };

        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());

        // Seed a YouTube document with empty `documents.content` and a cached `youtube_transcripts` row.
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, content_hash, date_added, date_modified, content_updated_at, is_ai_excluded)
             VALUES ('yt-doc-1', 'Eigenvalues Lecture', 'https://www.youtube.com/watch?v=abc123XYZ00', 'youtube', '', NULL, '2026-11-01T10:00:00Z', '2026-11-12T10:00:00Z', '2026-11-01T10:00:00Z', 0)",
        )
        .execute(&pool)
        .await
        .expect("seed yt-doc-1");

        // Excluded document with matching terms that MUST be skipped by both indexing and retrieval.
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, content, content_hash, date_added, date_modified, content_updated_at, is_ai_excluded)
             VALUES ('yt-doc-excl', 'Excluded Lecture', 'https://www.youtube.com/watch?v=excl9990001', 'youtube', 'Linear eigenvalues secret excluded lecture transcript.', 'hash-excl', '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z', 1)",
        )
        .execute(&pool)
        .await
        .expect("seed yt-doc-excl");

        let transcript_text =
            "Linear eigenvalues govern differential stability across coupled dynamical oscillators.";
        let segments_json = serde_json::json!([
            {
                "start": 15.0,
                "duration": 6.0,
                "text": transcript_text
            }
        ])
        .to_string();

        sqlx::query(
            "INSERT INTO youtube_transcripts (id, document_id, video_id, transcript, segments_json, date_created, date_modified)
             VALUES ('yt-tr-1', 'yt-doc-1', 'abc123XYZ00', ?1, ?2, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z')",
        )
        .bind(transcript_text)
        .bind(&segments_json)
        .execute(&pool)
        .await
        .expect("seed youtube_transcripts");

        let _statuses = ensure_documents_chunks_indexed(
            &repo,
            &["yt-doc-1".to_string(), "yt-doc-excl".to_string()],
        )
        .await
        .expect("ensure_documents_chunks_indexed succeeds");

        let (yt_chunks, excl_chunks): (i64, i64) = sqlx::query_as(
            "SELECT
                (SELECT COUNT(*) FROM semantic_chunks WHERE document_id = 'yt-doc-1' AND source_type = ?1),
                (SELECT COUNT(*) FROM semantic_chunks WHERE document_id = 'yt-doc-excl')",
        )
        .bind(SOURCE_TYPE_TRANSCRIPT)
        .fetch_one(&pool)
        .await
        .expect("count chunks");
        assert!(yt_chunks >= 1, "expected transcript chunks for yt-doc-1");
        assert_eq!(
            excl_chunks, 0,
            "is_ai_excluded document must not be chunked"
        );

        let backend = EmbeddingBackend::OnDevice {
            model: "embeddinggemma",
        };
        let response = retrieve(
            &repo,
            &backend,
            "eigenvalues stability",
            5,
            &RetrievalFilters {
                document_ids: Some(vec!["yt-doc-1".to_string(), "yt-doc-excl".to_string()]),
                source_types: None,
            },
        )
        .await
        .expect("lexical retrieve succeeds");

        assert_eq!(response.mode, "lexicalOnly");
        assert!(
            response
                .results
                .iter()
                .all(|r| r.document_id != "yt-doc-excl"),
            "is_ai_excluded doc must never appear in retrieval results"
        );
        let hit = response
            .results
            .iter()
            .find(|r| r.document_id == "yt-doc-1")
            .expect("yt-doc-1 retrieved");
        assert_eq!(hit.source_type, SOURCE_TYPE_TRANSCRIPT);
        assert_eq!(hit.location["timestampMs"], 15000);

        let study_repo = StudySourceRepository::new(pool.clone());
        let resolved = study_repo
            .resolve_study_source_refs(&[StudySourceRefInput {
                document_id: hit.document_id.clone(),
                extract_id: None,
                excerpt: hit.text.clone(),
                excerpt_sha256: None,
                revision: Some("2026-11-01T10:00:00Z".to_string()),
                revision_kind: Some(RevisionKind::ModifiedAt),
                document_title: hit.document_title.clone(),
                source_type: Some("youtube".to_string()),
                jump: Some(serde_json::json!({
                    "kind": "youtube",
                    "timeSeconds": 15
                })),
                chunk: Some(StudySourceChunk {
                    chunk_id: hit.chunk_id.clone(),
                    ordinal: hit.ordinal as i32,
                    start_offset: hit.location["startOffset"].as_i64().unwrap_or(0) as i32,
                    end_offset: hit.location["endOffset"].as_i64().unwrap_or(0) as i32,
                }),
                section_label: None,
            }])
            .await
            .expect("resolve_study_source_refs");

        assert_eq!(resolved.len(), 1);
        assert_eq!(
            resolved[0].status,
            StudySourceStatus::Current,
            "unexpected status/reason: {:?}",
            resolved[0].reason_key
        );
        assert_eq!(resolved[0].navigation, StudySourceNavigation::Exact);
    }
}
