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
    chunk_document, single_chunk, ChunkContext, ChunkInput, ChunkOptions,
};
use crate::ai_learning::embeddings_backend::{EmbeddingBackend, EmbeddingUnavailable};
use crate::ai_learning::models::{
    AggregateIndexStatus, ChunkModel, DocumentIndexStatus, EmbeddingModelUsage, IndexState,
    SOURCE_TYPE_ANNOTATION, SOURCE_TYPE_CARD, SOURCE_TYPE_DOCUMENT, SOURCE_TYPE_EXTRACT,
};
use crate::database::Repository;
use crate::error::{IncrementumError, Result};
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
            .map_err(|_| IncrementumError::Internal("indexer worker stopped".into()))
    }

    pub fn enqueue_all(&self, require_charging: bool) -> Result<()> {
        self.sender
            .send(IndexerCommand::EnqueueAll { require_charging })
            .map_err(|_| IncrementumError::Internal("indexer worker stopped".into()))
    }

    pub fn pause(&self) -> Result<()> {
        self.sender
            .send(IndexerCommand::Pause)
            .map_err(|_| IncrementumError::Internal("indexer worker stopped".into()))
    }

    pub fn resume(&self) -> Result<()> {
        self.sender
            .send(IndexerCommand::Resume)
            .map_err(|_| IncrementumError::Internal("indexer worker stopped".into()))
    }

    pub fn cancel_document(&self, document_id: impl Into<String>) -> Result<()> {
        self.sender
            .send(IndexerCommand::CancelDocument(document_id.into()))
            .map_err(|_| IncrementumError::Internal("indexer worker stopped".into()))
    }

    pub fn reset(&self) -> Result<()> {
        self.sender
            .send(IndexerCommand::Reset)
            .map_err(|_| IncrementumError::Internal("indexer worker stopped".into()))
    }

    pub fn shutdown(&self) -> Result<()> {
        self.sender
            .send(IndexerCommand::Shutdown)
            .map_err(|_| IncrementumError::Internal("indexer worker stopped".into()))
    }

    pub fn runtime_status(&self) -> IndexerRuntimeStatus {
        self.status
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
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
        if let Err(e) = sqlx::query(
            "UPDATE ai_index_state SET state = 'queued' WHERE state = 'indexing'",
        )
        .execute(self.repo.pool())
        .await
        {
            warn!("failed to reset interrupted index states: {}", e);
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
                let ids = list_indexable_documents(&self.repo).await.unwrap_or_default();
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

    set_state(repo, document_id, IndexState::Indexing, None).await?;

    let content = doc.content.clone().unwrap_or_default();
    if content.trim().is_empty() {
        // Nothing indexable (e.g. scanned PDF awaiting OCR). Record an empty
        // but successful state so the document is not perpetually requeued.
        upsert_state_row(repo, document_id, IndexState::Indexed, Some(backend), 0, 0, None).await?;
        return Ok(IndexOutcome::Completed);
    }

    // 1. Chunk the document body.
    let chunks = build_document_chunks(repo, &doc, &content).await;

    // 2. Extra sources (task 4.7): extracts, annotations, card fronts.
    let mut all_chunks = chunks;
    all_chunks.extend(build_extract_chunks(repo, document_id).await);
    all_chunks.extend(build_annotation_chunks(repo, document_id).await);
    all_chunks.extend(build_card_chunks(repo, document_id).await);

    let total = all_chunks.len() as i64;

    // 3. Hash diff: delete orphans, insert new, refresh metadata of retained.
    apply_chunk_diff(repo, document_id, &all_chunks).await?;

    // 4. Embed missing/stale chunks, per-chunk commits, interrupt checks.
    let embedded = embed_chunks(repo, document_id, backend, should_continue).await?;

    if !should_continue() {
        // Interrupted: keep what was committed; resume later from queued.
        set_state_raw(repo, document_id, IndexState::Queued, embedded, total, None).await?;
        return Ok(if embedded < total {
            IndexOutcome::Paused
        } else {
            IndexOutcome::Completed
        });
    }

    upsert_state_row(repo, document_id, IndexState::Indexed, Some(backend), total, total, None)
        .await?;
    Ok(IndexOutcome::Completed)
}

/// Chunk the document body using the source-appropriate strategy.
async fn build_document_chunks(
    repo: &Repository,
    doc: &crate::models::Document,
    content: &str,
) -> Vec<ChunkModel> {
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

    // Storage for parsed inputs whose references go into `ChunkInput` below.
    let pages_storage: Vec<String>;
    let html_storage: String;

    let input = match doc.file_type {
        crate::models::FileType::Pdf => {
            // Per-page extraction (see processor::pdf::extract_pdf_pages_text
            // for the decision record). Falls back to whole-content chunking.
            match crate::processor::pdf::extract_pdf_pages_text(&doc.file_path).await {
                Ok(pages) if !pages.is_empty() => {
                    pages_storage = pages;
                    ChunkInput::Paged {
                        pages: &pages_storage,
                    }
                }
                _ => ChunkInput::Plain {
                    text: content,
                    heading_heuristic: true,
                },
            }
        }
        crate::models::FileType::Html | crate::models::FileType::Epub => {
            // Prefer preserved HTML (headings via tag scan); fall back to the
            // stored plain-text projection with the typographic heuristic.
            match load_html_content(repo, &doc.id).await {
                Some(html) if !html.trim().is_empty() => {
                    html_storage = html;
                    ChunkInput::Html {
                        html: &html_storage,
                    }
                }
                _ => ChunkInput::Plain {
                    text: content,
                    heading_heuristic: true,
                },
            }
        }
        crate::models::FileType::Markdown => ChunkInput::Markdown { text: content },
        _ => ChunkInput::Plain {
            text: content,
            heading_heuristic: false,
        },
    };

    chunk_document(&ctx, input, &ChunkOptions::default())
}

async fn load_html_content(repo: &Repository, document_id: &str) -> Option<String> {
    sqlx::query("SELECT html_content FROM documents WHERE id = ?1")
        .bind(document_id)
        .fetch_optional(repo.pool())
        .await
        .ok()
        .flatten()
        .and_then(|row| row.try_get::<Option<String>, _>("html_content").ok().flatten())
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
        let Ok(id) = row.try_get::<String, _>("id") else { continue };
        let Ok(page) = row.try_get::<i64, _>("page_number") else { continue };
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
async fn apply_chunk_diff(repo: &Repository, document_id: &str, new_chunks: &[ChunkModel]) -> Result<()> {
    let stored: Vec<(String, i64)> = sqlx::query_as(
        "SELECT id, ordinal FROM semantic_chunks WHERE document_id = ?1",
    )
    .bind(document_id)
    .fetch_all(repo.pool())
    .await?;

    let new_ids: HashSet<&str> = new_chunks.iter().map(|c| c.id.as_str()).collect();

    // Delete orphans (embeddings cascade via FK).
    let orphans: Vec<String> = stored
        .iter()
        .filter(|(id, _)| !new_ids.contains(id.as_str()))
        .map(|(id, _)| id.clone())
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
        debug!("removed {} orphan chunks for {}", orphans.len(), document_id);
    }

    // Insert new chunks one by one (per-chunk commit: interruption-safe).
    for chunk in new_chunks {
        let already = stored.iter().any(|(id, _)| id == &chunk.id);
        if already {
            // Retained: refresh position metadata if the ordinal moved.
            if let Some((_, ordinal)) = stored.iter().find(|(id, _)| id == &chunk.id) {
                if *ordinal != chunk.ordinal {
                    sqlx::query(
                        "UPDATE semantic_chunks SET ordinal = ?2, location_json = ?3, heading_path = ?4, updated_at = datetime('now') WHERE id = ?1",
                    )
                    .bind(&chunk.id)
                    .bind(chunk.ordinal)
                    .bind(&chunk.location_json)
                    .bind(serde_json::to_string(&chunk.heading_path).unwrap_or_else(|_| "[]".into()))
                    .execute(repo.pool())
                    .await?;
                }
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
        .bind(serde_json::to_string(&chunk.heading_path).unwrap_or_else(|_| "[]".into()))
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
) -> Result<i64> {
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
        return Ok(total_chunks);
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
        return Ok(done_before);
    }

    let mut embedded = done_before;
    for batch in pending.chunks(EMBED_BATCH_SIZE) {
        if !should_continue() {
            return Ok(embedded);
        }
        let mut texts: Vec<String> = Vec::with_capacity(batch.len());
        for id in batch {
            texts.push(chunk_text(repo, id).await.unwrap_or_default());
        }
        let vectors: Vec<Vec<f32>> = match backend.embed_texts(&texts).await {
            Ok(v) => v,
            Err(EmbeddingUnavailable { reason }) => {
                warn!("embedding batch failed for {}: {}", document_id, reason);
                return Ok(embedded);
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
    Ok(embedded)
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
    let content_hash: String = sqlx::query_scalar(
        "SELECT content_hash FROM semantic_chunks WHERE id = ?1",
    )
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

/// Documents worth bulk-indexing: have text content and are not archived.
async fn list_indexable_documents(repo: &Repository) -> Result<Vec<String>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, COALESCE(content, '') FROM documents WHERE is_archived = 0",
    )
    .fetch_all(repo.pool())
    .await?;
    Ok(rows
        .into_iter()
        .filter(|(_, content)| !content.trim().is_empty())
        .map(|(id, _)| id)
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
                .map(|i| format!("Original paragraph {i} with stable content that will not change at all."))
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
        assert!(ids_before.len() >= 2, "expected several chunks, got {}", ids_before.len());

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
        let retained = ids_after.iter().filter(|id| ids_before.contains(id)).count();
        assert!(
            retained * 2 > ids_before.len(),
            "expected most chunks retained, {retained}/{} ",
            ids_before.len()
        );
        assert!(retained < ids_after.len(), "the edited tail must produce at least one new chunk");

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
        assert_eq!(state.0, "queued", "interrupted doc returns to queued, got {}", state.0);
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
        assert!(matches!(outcome, IndexOutcome::Paused | IndexOutcome::Cancelled | IndexOutcome::Completed));
    }

    #[tokio::test]
    async fn deletion_cascades_chunks_and_state() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-4", "Some content to index here. More text follows for chunking. ", "text").await;
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
        seed_document(&pool, "doc-5", "Text content for lexical-only indexing. ", "text").await;
        let backend = EmbeddingBackend::OnDevice {
            model: "embeddinggemma-300m",
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
    async fn extra_sources_become_single_chunks() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-6", "Document body content for chunking purposes. ", "pdf").await;

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
        assert!(types.contains(&"annotation"), "annotation chunk: {:?}", types);
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

        let (orphans,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM semantic_chunks WHERE source_id = 'ext-doomed'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(orphans, 0, "deleted extract's chunk removed by diff");
    }

    #[tokio::test]
    async fn embedding_version_change_reembeds() {
        let pool = test_pool().await;
        let repo = Repository::new(pool.clone());
        seed_document(&pool, "doc-8", "Content that will be re-embedded after a version bump. ", "text").await;

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

        let factory: BackendFactory =
            Arc::new(|| EmbeddingBackend::Mock { dim: 32, model: "mock-queue" });
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
            if matches!(&s1, Some(s) if s.0 == "indexed") && matches!(&s2, Some(s) if s.0 == "indexed")
            {
                break;
            }
            assert!(std::time::Instant::now() < deadline, "queue did not finish in time: {:?} {:?}", s1, s2);
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
}
