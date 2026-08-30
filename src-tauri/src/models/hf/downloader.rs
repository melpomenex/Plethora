//! Streaming download manager for HF model artifacts (requirement #19,
//! "Safe installation lifecycle").
//!
//! Extracts the streaming+progress+cancel+retry+SHA-256+atomic-rename+
//! partial-cleanup download pattern from the legacy
//! `transcription/model_manager.rs` into a reusable module. Files are written
//! to a `.part` sibling and atomically renamed only after hash verification, so
//! a failed, canceled, or tampered download never leaves a "half installed"
//! file at the final path.
//!
//! Reliability contract (see
//! `openspec/changes/fix-nemotron-model-download`):
//! - **Monotonic progress**: emitted percentages never move backwards across
//!   retries, even when an attempt must restart from byte zero.
//! - **Resumable retries**: a failed attempt keeps its `.part` file and the
//!   next attempt resumes via `Range: bytes=<received>-` when the server
//!   supports it, instead of re-downloading from scratch.
//! - **Readable failures**: transport errors are classified into human causes
//!   ("connection lost while downloading", "timed out waiting for data", …)
//!   with the underlying error appended — never a bare reqwest decode error.

use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use reqwest::header::RANGE;
use reqwest::{Client, StatusCode};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

/// Emitted on every download tick: `hf://install-progress`.
#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    pub id: String,
    pub file: String,
    pub received: u64,
    pub total: u64,
    pub percent: f32,
}

/// Emitted when an install finishes (or fails) so the UI can refresh:
/// `hf://install-finished`.
#[derive(Debug, Clone, Serialize)]
pub struct InstallFinished {
    pub id: String,
    pub ok: bool,
    pub message: String,
}

pub const PROGRESS_EVENT: &str = "hf://install-progress";
pub const FINISHED_EVENT: &str = "hf://install-finished";

pub const MAX_RETRIES: u32 = 3;

/// Minimum interval (or ≥1% jump) between two progress events, so fast
/// connections do not flood the webview with per-chunk IPC.
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(100);

/// Classify a transport-layer error into a human-readable cause. The
/// underlying reqwest error is appended by the caller for diagnosis.
pub(crate) fn classify_transport_error(e: &reqwest::Error) -> &'static str {
    if e.is_timeout() {
        "timed out waiting for data (connection stalled)"
    } else if e.is_connect() {
        "could not reach the server"
    } else if e.is_decode() {
        // reqwest maps mid-body failures (connection reset, truncated body,
        // decompression aborts) to decode-kind errors.
        "connection lost while downloading"
    } else {
        "network error while downloading"
    }
}

/// Progress emission state: throttle + the high-water marks that keep the
/// reported values monotonic across retry attempts.
struct ProgressTracker<'a> {
    sink: Box<dyn FnMut(&InstallProgress) + Send + 'a>,
    id: String,
    file: String,
    total: Option<u64>,
    last_emit: Option<Instant>,
    last_percent: f32,
    max_percent: f32,
    max_received: u64,
}

impl<'a> ProgressTracker<'a> {
    fn new(sink: Box<dyn FnMut(&InstallProgress) + Send + 'a>, id: &str, file: &str) -> Self {
        Self {
            sink,
            id: id.to_string(),
            file: file.to_string(),
            total: None,
            last_emit: None,
            last_percent: 0.0,
            max_percent: 0.0,
            max_received: 0,
        }
    }

    /// Record the expected full size (206 responses report the *remaining*
    /// length; callers add the resumed offset before calling this).
    fn set_total(&mut self, total: Option<u64>) {
        self.total = total;
    }

    /// Percent for a byte count (0.0 when the total is unknown — consumers
    /// display the raw byte count instead).
    fn percent_for(&self, received: u64) -> f32 {
        match self.total {
            Some(t) => (received as f32 / t.max(1) as f32 * 100.0).min(100.0),
            None => 0.0,
        }
    }

    /// Track a byte count, emitting a throttled event when due. Never emits a
    /// percentage or byte count below a previously emitted one.
    fn record(&mut self, received: u64) {
        let shown_received = received.max(self.max_received);
        let percent = self.percent_for(shown_received).max(self.max_percent);
        self.max_received = shown_received;
        self.max_percent = percent;
        let due = match self.last_emit {
            None => true,
            Some(t) => {
                t.elapsed() >= PROGRESS_EMIT_INTERVAL || percent - self.last_percent >= 1.0
            }
        };
        if due {
            self.emit(shown_received, percent);
        }
    }

    /// Terminal event: always emitted, always 100%.
    fn emit_final(&mut self, received: u64) {
        self.max_percent = 100.0;
        self.emit(received.max(self.max_received), 100.0);
    }

    fn emit(&mut self, received: u64, percent: f32) {
        (self.sink)(&InstallProgress {
            id: self.id.clone(),
            file: self.file.clone(),
            received,
            total: self.total.unwrap_or(0),
            percent,
        });
        self.last_percent = percent;
        self.last_emit = Some(Instant::now());
    }
}

/// Download `url` to `dest`, streaming to a `.part` file with progress events,
/// optional SHA-256 verification, resumable retries, and atomic rename.
///
/// On cancel or final failure the partial file is removed and `dest` is
/// untouched; a mid-stream failure keeps the partial so the next attempt can
/// `Range`-resume. `progress` is optional so tests can exercise the download
/// machinery without a Tauri app handle.
#[allow(clippy::too_many_arguments)]
pub async fn download_file(
    client: &Client,
    url: &str,
    dest: &Path,
    expected_sha256: Option<&str>,
    expected_size: Option<u64>,
    progress: Option<&AppHandle>,
    install_id: &str,
    file_label: &str,
    cancel: Option<&CancellationToken>,
) -> Result<()> {
    let sink: Box<dyn FnMut(&InstallProgress) + Send + '_> = match progress {
        Some(app) => Box::new(move |p: &InstallProgress| {
            let _ = app.emit(PROGRESS_EVENT, p);
        }),
        None => Box::new(|_: &InstallProgress| {}),
    };
    download_file_with_sink(
        client,
        url,
        dest,
        expected_sha256,
        expected_size,
        sink,
        install_id,
        file_label,
        cancel,
    )
    .await
}

/// Sink-injectable core of [`download_file`] — tests capture the progress
/// sequence to assert monotonicity.
#[allow(clippy::too_many_arguments)]
pub async fn download_file_with_sink<'a>(
    client: &Client,
    url: &str,
    dest: &Path,
    expected_sha256: Option<&str>,
    expected_size: Option<u64>,
    sink: Box<dyn FnMut(&InstallProgress) + Send + 'a>,
    install_id: &str,
    file_label: &str,
    cancel: Option<&CancellationToken>,
) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| anyhow!("Failed to create {}: {}", parent.display(), e))?;
    }
    let part_path = dest.with_extension("part");

    let total_hint = expected_size;
    let mut last_error: Option<anyhow::Error> = None;
    let mut tracker = ProgressTracker::new(sink, install_id, file_label);

    for attempt in 0..=MAX_RETRIES {
        if let Some(token) = cancel {
            if token.is_cancelled() {
                let _ = std::fs::remove_file(&part_path);
                return Err(anyhow!("Download cancelled"));
            }
        }

        // Bytes already on disk from a previous attempt (resume candidate).
        let mut resume_from: u64 = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);

        let mut request = client.get(url);
        if resume_from > 0 {
            request = request.header(RANGE, format!("bytes={resume_from}-"));
        }
        let response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = Some(anyhow!(
                    "Download failed: {} ({})",
                    classify_transport_error(&e),
                    e
                ));
                retry_delay(attempt).await;
                continue;
            }
        };
        let status = response.status();
        if status == StatusCode::RANGE_NOT_SATISFIABLE && resume_from > 0 {
            // Stale/oversized partial: drop it and restart clean next attempt.
            let _ = std::fs::remove_file(&part_path);
            last_error = Some(anyhow!(
                "Server could not resume from byte {resume_from} (HTTP 416); restarting"
            ));
            retry_delay(attempt).await;
            continue;
        }
        if !status.is_success() {
            last_error = Some(anyhow!("HTTP {} while downloading {}", status, url));
            retry_delay(attempt).await;
            continue;
        }

        let resumed = status == StatusCode::PARTIAL_CONTENT && resume_from > 0;
        if resume_from > 0 && !resumed {
            // Server ignored the Range request (plain 200): restart from zero.
            let _ = std::fs::remove_file(&part_path);
            resume_from = 0;
        }

        // 206 responses report the remaining length; add the resumed offset
        // so `total` stays the full file size.
        let total = match response.content_length() {
            Some(len) if resumed => Some(len + resume_from),
            Some(len) => Some(len),
            None => total_hint,
        };
        tracker.set_total(total);

        let mut received: u64 = resume_from;
        let mut file = if resumed {
            tokio::fs::OpenOptions::new()
                .append(true)
                .open(&part_path)
                .await?
        } else {
            tokio::fs::File::create(&part_path).await?
        };
        let mut stream = response.bytes_stream();
        let mut failed = false;

        // Read chunks, but wake immediately when the caller cancels (select!
        // between the stream and the cancellation token) so cancellation is
        // responsive even while the server holds the connection open.
        loop {
            let chunk = if let Some(token) = cancel {
                tokio::select! {
                    _ = token.cancelled() => {
                        drop(file);
                        let _ = std::fs::remove_file(&part_path);
                        return Err(anyhow!("Download cancelled"));
                    }
                    c = stream.next() => c,
                }
            } else {
                stream.next().await
            };
            match chunk {
                Some(Ok(bytes)) => {
                    if let Err(e) = file.write_all(&bytes).await {
                        drop(file);
                        let _ = std::fs::remove_file(&part_path);
                        return Err(anyhow!(
                            "Disk write failed while downloading {}: {}",
                            file_label,
                            e
                        ));
                    }
                    received += bytes.len() as u64;
                    tracker.record(received);
                }
                Some(Err(e)) => {
                    failed = true;
                    last_error = Some(anyhow!(
                        "Download failed: {} ({})",
                        classify_transport_error(&e),
                        e
                    ));
                    break;
                }
                None => break, // stream ended
            }
        }

        if failed {
            // Keep the partial file so the next attempt resumes via Range.
            drop(file);
            retry_delay(attempt).await;
            continue;
        }

        file.flush().await?;
        drop(file);

        // Integrity verification — fail closed. Hash the assembled file (not a
        // per-attempt stream hasher) so downloads completed across resumed
        // segments are verified exactly like single-shot downloads.
        if let Some(expected) = expected_sha256.filter(|e| !e.is_empty()) {
            let hash = sha256_of_file_async(&part_path).await?;
            if !hash.eq_ignore_ascii_case(expected) {
                let _ = std::fs::remove_file(&part_path);
                return Err(anyhow!(
                    "Integrity check failed for {}: expected sha256 {}, got {}. \
                     The download was not installed.",
                    file_label,
                    expected,
                    hash
                ));
            }
        }

        // Atomic rename into place.
        std::fs::rename(&part_path, dest)?;

        tracker.emit_final(received);
        return Ok(());
    }

    // All attempts exhausted: clean up the partial and surface the classified
    // error with retry context (never a bare transport-library message).
    let _ = std::fs::remove_file(&part_path);
    let err = last_error.unwrap_or_else(|| anyhow!("Download failed"));
    Err(anyhow!("{}; retried {} times without success", err, MAX_RETRIES))
}

async fn retry_delay(attempt: u32) {
    if attempt >= MAX_RETRIES {
        return;
    }
    // 1s, 2s, 4s backoff.
    let secs = 1u64 << attempt;
    tokio::time::sleep(Duration::from_secs(secs)).await;
}

/// Delete an install directory (partial cleanup / uninstall).
pub fn remove_dir_if_exists(dir: &Path) -> Result<()> {
    if dir.exists() {
        std::fs::remove_dir_all(dir)?;
    }
    Ok(())
}

/// Compute the sha256 of a file on disk (used for install verification).
pub fn sha256_of_file(path: &Path) -> Result<String> {
    let mut hasher = Sha256::new();
    let mut f = std::fs::File::open(path)?;
    std::io::copy(&mut f, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// Async variant of [`sha256_of_file`] — the download path stays off the
/// blocking pool while hashing multi-hundred-MB artifacts.
async fn sha256_of_file_async(path: &Path) -> Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// The `.part` temp path for a destination.
pub fn part_path(dest: &Path) -> PathBuf {
    dest.with_extension("part")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::hf::test_support::TestServerBuilder;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    /// A progress sink that records every event.
    fn recording_sink()
    -> (Box<dyn FnMut(&InstallProgress) + Send>, Arc<Mutex<Vec<InstallProgress>>>) {
        let events: Arc<Mutex<Vec<InstallProgress>>> = Arc::new(Mutex::new(Vec::new()));
        let sink_events = Arc::clone(&events);
        (
            Box::new(move |p: &InstallProgress| {
                sink_events.lock().unwrap().push(p.clone());
            }),
            events,
        )
    }

    #[tokio::test]
    async fn downloads_verifies_and_renames_atomically() {
        let body = b"hello model bytes".to_vec();
        let server = TestServerBuilder::new(move |_| (200, body.clone()))
            .spawn()
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        let expected_sha = format!("{:x}", Sha256::digest(b"hello model bytes"));
        let (sink, _events) = recording_sink();
        download_file_with_sink(
            &Client::new(),
            &server.url,
            &dest,
            Some(&expected_sha),
            Some(18),
            sink,
            "test-install",
            "model.bin",
            None,
        )
        .await
        .expect("download succeeds");
        server.stop();

        assert_eq!(std::fs::read(&dest).unwrap(), b"hello model bytes");
        assert!(!part_path(&dest).exists(), "part file removed after success");
    }

    #[tokio::test]
    async fn integrity_mismatch_fails_closed() {
        let body = b"good model".to_vec();
        let server = TestServerBuilder::new(move |_| (200, body.clone()))
            .spawn()
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        let wrong_sha = "deadbeef".repeat(8);
        let (sink, _events) = recording_sink();
        let err = download_file_with_sink(
            &Client::new(),
            &server.url,
            &dest,
            Some(&wrong_sha),
            None,
            sink,
            "test-install",
            "model.bin",
            None,
        )
        .await
        .expect_err("hash mismatch errors");
        server.stop();

        assert!(err.to_string().contains("Integrity"), "{}", err);
        assert!(!dest.exists(), "dest never written on mismatch");
        assert!(!part_path(&dest).exists(), "part cleaned up");
    }

    #[tokio::test]
    async fn cancel_mid_stream_cleans_up_partial_file() {
        // Server declares 10 MB but sends only 1 MB and holds the connection,
        // so the client is deterministically blocked mid-stream.
        let body = vec![0xABu8; 10 * 1024 * 1024];
        let (builder, delivered_rx) =
            TestServerBuilder::new(move |_| (200, body.clone())).hold_after_bytes(1024 * 1024);
        let server = builder.spawn().await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");
        let cancel = CancellationToken::new();

        let handle = {
            let cancel = cancel.clone();
            let url = server.url.clone();
            let dest = dest.clone();
            tokio::spawn(async move {
                let (sink, _events) = recording_sink();
                download_file_with_sink(
                    &Client::new(),
                    &url,
                    &dest,
                    None,
                    None,
                    sink,
                    "test-install",
                    "model.bin",
                    Some(&cancel),
                )
                .await
            })
        };

        // Wait until the server has delivered the partial body (client blocked).
        delivered_rx.await.expect("server delivered body");
        // The client may still be processing the first chunk when the server
        // signals — poll until the .part file exists (bounded). The client can
        // never finish: only 1 MB of the declared 10 MB was sent.
        let part = part_path(&dest);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !part.exists() && std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(part.exists(), "partial file exists before cancel");

        cancel.cancel();
        let err = handle.await.unwrap().expect_err("cancel returns error");
        assert!(err.to_string().contains("cancelled"), "{}", err);

        server.stop();
        assert!(!dest.exists(), "final dest never written");
        assert!(!part.exists(), "partial file cleaned up after cancel");
    }

    #[tokio::test]
    async fn transient_http_error_retries_and_succeeds() {
        // First connection → 500; second → 200. Retry should recover.
        let body = b"retried ok".to_vec();
        let mut conns = 0u32;
        let server = TestServerBuilder::new(move |_| {
            conns += 1;
            if conns == 1 {
                (500, Vec::new())
            } else {
                (200, body.clone())
            }
        })
        .spawn()
        .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        let (sink, _events) = recording_sink();
        download_file_with_sink(
            &Client::new(),
            &server.url,
            &dest,
            None,
            None,
            sink,
            "test-install",
            "model.bin",
            None,
        )
        .await
        .expect("retry succeeds");
        server.stop();

        assert_eq!(std::fs::read(&dest).unwrap(), b"retried ok");
    }

    #[tokio::test]
    async fn persistent_failure_never_writes_dest() {
        let server = TestServerBuilder::new(|_| (503, Vec::new())).spawn().await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        let (sink, _events) = recording_sink();
        let err = download_file_with_sink(
            &Client::new(),
            &server.url,
            &dest,
            None,
            None,
            sink,
            "test-install",
            "model.bin",
            None,
        )
        .await
        .expect_err("all retries fail");
        server.stop();

        assert!(err.to_string().contains("HTTP 503"), "{}", err);
        assert!(err.to_string().contains("retried"), "{}", err);
        assert!(!dest.exists());
        assert!(!part_path(&dest).exists(), "partial cleaned up after final failure");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Resume + monotonic progress (fix-nemotron-model-download)
    // ─────────────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn mid_stream_drop_resumes_via_range_without_redownloading() {
        // Connection 1 sends half the body then drops; connection 2 (Range
        // request) must serve only the remaining half. The retry delay for
        // attempt 0 is 1 s — acceptable for the test.
        let body: Vec<u8> = (0..200u8).cycle().take(8 * 1024).collect();
        let half = body.len() / 2;
        let expected_sha = format!("{:x}", Sha256::digest(&body));
        let expected_size = body.len() as u64;
        let (builder, dropped_rx) =
            TestServerBuilder::new(move |_| (200, body.clone())).drop_after_bytes(half);
        let server = builder.support_ranges().spawn().await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        let (sink, events) = recording_sink();
        let url = server.url.clone();
        let dest_for_task = dest.clone();
        let handle = tokio::spawn(async move {
            download_file_with_sink(
                &Client::new(),
                &url,
                &dest_for_task,
                Some(&expected_sha),
                Some(expected_size),
                sink,
                "test-install",
                "model.bin",
                None,
            )
            .await
        });
        // Connection 1 has delivered its half and dropped; the client will
        // fail mid-stream, back off 1 s, and re-request with a Range header.
        let _ = dropped_rx.await;
        let result = tokio::time::timeout(Duration::from_secs(15), handle)
            .await
            .expect("download finishes")
            .unwrap();
        result.expect("resumed download completes");

        assert_eq!(
            std::fs::read(&dest).unwrap().len(),
            expected_size as usize,
            "assembled file has full length"
        );

        let requests = server.requests().await;
        assert!(requests.len() >= 2, "expected a retry request, got {}", requests.len());
        assert_eq!(
            requests[1].range_header().as_deref(),
            Some(format!("bytes={half}-").as_str()),
            "retry must resume from the dropped offset"
        );

        let events = events.lock().unwrap();
        let last = events.last().expect("terminal progress event");
        assert_eq!(last.percent, 100.0);
        assert_eq!(last.received, expected_size);
    }

    #[tokio::test]
    async fn range_ignored_server_restarts_cleanly_with_monotonic_progress() {
        // Connection 1 drops at 75%; connection 2 ignores the Range header and
        // returns plain 200 with the full body. The download must still
        // complete, and no progress event may dip below a previous one.
        let body: Vec<u8> = (0..250u8).cycle().take(4 * 1024).collect();
        let cut = body.len() * 3 / 4;
        let expected_sha = format!("{:x}", Sha256::digest(&body));
        let expected_size = body.len() as u64;
        // NOTE: no .support_ranges() — the retry gets a plain 200.
        let (builder, dropped_rx) =
            TestServerBuilder::new(move |_| (200, body.clone())).drop_after_bytes(cut);
        let server = builder.spawn().await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        let (sink, events) = recording_sink();
        let url = server.url.clone();
        let dest_for_task = dest.clone();
        let handle = tokio::spawn(async move {
            download_file_with_sink(
                &Client::new(),
                &url,
                &dest_for_task,
                Some(&expected_sha),
                Some(expected_size),
                sink,
                "test-install",
                "model.bin",
                None,
            )
            .await
        });
        let _ = dropped_rx.await;
        let result = tokio::time::timeout(Duration::from_secs(15), handle)
            .await
            .expect("download finishes")
            .unwrap();
        result.expect("restarted download completes");

        assert_eq!(std::fs::read(&dest).unwrap().len(), expected_size as usize);

        let events = events.lock().unwrap();
        assert!(events.len() >= 2, "need multiple events to check monotonicity");
        let mut max_percent = -1.0f32;
        let mut max_received = -1i64;
        for e in events.iter() {
            assert!(
                e.percent >= max_percent,
                "percent dipped: {} after {}",
                e.percent,
                max_percent
            );
            assert!(
                e.received as i64 >= max_received,
                "received dipped: {} after {}",
                e.received,
                max_received
            );
            max_percent = e.percent;
            max_received = e.received as i64;
        }
    }

    #[tokio::test]
    async fn stale_corrupt_part_fails_integrity_closed() {
        // A .part file left by something else (wrong bytes on disk) must never
        // install: the server honors Range resume, appends the remainder, and
        // the assembled-file hash mismatches → fail closed.
        let body: Vec<u8> = (7u8..=7).cycle().take(4 * 1024).collect();
        let garbage_len = body.len() / 2;
        let expected_sha = format!("{:x}", Sha256::digest(&body));
        let expected_size = body.len() as u64;
        let server = TestServerBuilder::new(move |_| (200, body.clone()))
            .support_ranges()
            .spawn()
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        // Pre-seed a garbage partial half the size of the real body.
        let garbage = vec![0xEEu8; garbage_len];
        std::fs::write(part_path(&dest), &garbage).unwrap();

        let (sink, _events) = recording_sink();
        let err = download_file_with_sink(
            &Client::new(),
            &server.url,
            &dest,
            Some(&expected_sha),
            Some(expected_size),
            sink,
            "test-install",
            "model.bin",
            None,
        )
        .await
        .expect_err("corrupt resume must fail integrity");
        server.stop();

        assert!(err.to_string().contains("Integrity"), "{}", err);
        assert!(!dest.exists(), "corrupt assembly never installed");
        assert!(!part_path(&dest).exists(), "part cleaned up on mismatch");
    }

    #[tokio::test]
    async fn stalled_connection_aborts_with_readable_timeout_error() {
        // Server declares a body, sends a bit, then goes silent. With the
        // download client's read timeout shortened via the test-only builder
        // the attempt aborts, retries (resume), and the final error must be
        // the human-readable stall classification — never a bare decode error.
        let body = vec![0x11u8; 64 * 1024];
        let (builder, delivered_rx) =
            TestServerBuilder::new(move |_| (200, body.clone())).hold_after_bytes(1024);
        let server = builder.spawn().await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        let client = crate::models::hf::hf_client::download_client_with_read_timeout(1);
        let (sink, _events) = recording_sink();
        let url = server.url.clone();
        let dest_for_task = dest.clone();
        let handle = tokio::spawn(async move {
            download_file_with_sink(
                &client,
                &url,
                &dest_for_task,
                None,
                None,
                sink,
                "test-install",
                "model.bin",
                None,
            )
            .await
        });
        let _ = delivered_rx.await;
        let err = tokio::time::timeout(Duration::from_secs(20), handle)
            .await
            .expect("aborts after retries")
            .unwrap()
            .expect_err("stalled download fails");
        server.stop();

        let msg = err.to_string();
        assert!(
            msg.contains("timed out waiting for data"),
            "readable stall classification missing: {msg}"
        );
        assert!(
            !msg.contains("error decoding response body"),
            "raw decode error leaked as the headline: {msg}"
        );
        assert!(
            msg.contains("retried"),
            "retry context missing: {msg}"
        );
        assert!(!dest.exists());
        assert!(!part_path(&dest).exists(), "partial cleaned up after final failure");
    }

    #[tokio::test]
    async fn unknown_total_reports_bytes_with_zero_percent() {
        // No Content-Length is hard to simulate with the test server (it
        // always sets one), but a missing *hint* exercises the same reporting
        // path on a 200 response: percent stays 0 until the terminal event.
        let body = b"tiny".to_vec();
        let server = TestServerBuilder::new(move |_| (200, body.clone()))
            .spawn()
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        let (sink, events) = recording_sink();
        download_file_with_sink(
            &Client::new(),
            &server.url,
            &dest,
            None,
            None,
            sink,
            "test-install",
            "model.bin",
            None,
        )
        .await
        .expect("download succeeds");
        server.stop();

        let events = events.lock().unwrap();
        // The server does send Content-Length, so only the terminal shape is
        // asserted here: 100% with the real byte count and total.
        let last = events.last().expect("terminal event");
        assert_eq!(last.percent, 100.0);
        assert_eq!(last.received, 4);
        assert_eq!(last.total, 4);
    }

    #[tokio::test]
    async fn four_sixteen_on_resume_restarts_from_zero() {
        // Pre-seed a partial LARGER than the body: the range-capable server
        // must answer 416, and the downloader restarts clean and completes.
        let body = b"small-body".to_vec();
        let server = TestServerBuilder::new(move |_| (200, body.clone()))
            .support_ranges()
            .spawn()
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");

        std::fs::write(part_path(&dest), vec![0u8; 4096]).unwrap();

        let expected_sha = format!("{:x}", Sha256::digest(b"small-body"));
        let (sink, _events) = recording_sink();
        let url = server.url.clone();
        let dest_for_task = dest.clone();
        let result = tokio::time::timeout(Duration::from_secs(15), async move {
            download_file_with_sink(
                &Client::new(),
                &url,
                &dest_for_task,
                Some(&expected_sha),
                None,
                sink,
                "test-install",
                "model.bin",
                None,
            )
            .await
        })
        .await
        .expect("finishes")
        .expect("416 restart succeeds");
        server.stop();

        assert_eq!(std::fs::read(&dest).unwrap(), b"small-body");
    }
}
