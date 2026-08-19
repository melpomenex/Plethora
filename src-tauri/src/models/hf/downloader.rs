//! Streaming download manager for HF model artifacts (requirement #19,
//! "Safe installation lifecycle").
//!
//! Extracts the streaming+progress+cancel+retry+SHA-256+atomic-rename+
//! partial-cleanup download pattern from the legacy
//! `transcription/model_manager.rs` into a reusable module. Files are written
//! to a `.part` sibling and atomically renamed only after hash verification, so
//! a failed, canceled, or tampered download never leaves a "half installed"
//! file at the final path.

use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use reqwest::Client;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
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

/// Download `url` to `dest`, streaming to a `.part` file with progress events,
/// optional SHA-256 verification, retries, and atomic rename.
///
/// On cancel or failure the partial file is removed and `dest` is untouched.
/// `progress` is optional so tests can exercise the download machinery without
/// a Tauri app handle.
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
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| anyhow!("Failed to create {}: {}", parent.display(), e))?;
    }
    let part_path = dest.with_extension("part");

    let total_hint = expected_size;
    let mut last_error: Option<anyhow::Error> = None;

    for attempt in 0..=MAX_RETRIES {
        if let Some(token) = cancel {
            if token.is_cancelled() {
                let _ = std::fs::remove_file(&part_path);
                return Err(anyhow!("Download cancelled"));
            }
        }

        // Re-request on each attempt (fresh stream, no partial reuse).
        let mut response = client.get(url).send().await;
        let mut response = match response {
            Ok(r) => r,
            Err(e) => {
                last_error = Some(anyhow!("Network error: {}", e));
                retry_delay(attempt).await;
                continue;
            }
        };
        if !response.status().is_success() {
            last_error = Some(anyhow!("HTTP {} while downloading {}", response.status(), url));
            retry_delay(attempt).await;
            continue;
        }

        let total = response.content_length().or(total_hint);
        let mut received: u64 = 0;
        let mut file = tokio::fs::File::create(&part_path).await?;
        let mut hasher = Sha256::new();
        let mut stream = response.bytes_stream();
        let mut failed = false;

        // Read chunks, but wake immediately when the caller cancels (select!
        // between the stream and the cancellation token) so cancellation is
        // responsive even while the server holds the connection open.
        loop {
            if let Some(token) = cancel {
                tokio::select! {
                    _ = token.cancelled() => {
                        drop(file);
                        let _ = std::fs::remove_file(&part_path);
                        return Err(anyhow!("Download cancelled"));
                    }
                    maybe_chunk = stream.next() => {
                        if let Some(chunk) = maybe_chunk {
                            match chunk {
                                Ok(bytes) => {
                                    file.write_all(&bytes).await?;
                                    hasher.update(&bytes);
                                    received += bytes.len() as u64;
                                    if let Some(t) = total {
                                        let percent =
                                            (received as f32 / t.max(1) as f32) * 100.0;
                                        if let Some(app) = progress {
                                            let _ = app.emit(
                                                PROGRESS_EVENT,
                                                InstallProgress {
                                                    id: install_id.to_string(),
                                                    file: file_label.to_string(),
                                                    received,
                                                    total: t,
                                                    percent,
                                                },
                                            );
                                        }
                                    }
                                }
                                Err(e) => {
                                    failed = true;
                                    last_error = Some(anyhow!("Stream interrupted: {}", e));
                                    break;
                                }
                            }
                        } else {
                            break; // stream ended
                        }
                    }
                }
            } else {
                match stream.next().await {
                    Some(Ok(bytes)) => {
                        file.write_all(&bytes).await?;
                        hasher.update(&bytes);
                        received += bytes.len() as u64;
                        if let Some(t) = total {
                            let percent = (received as f32 / t.max(1) as f32) * 100.0;
                            if let Some(app) = progress {
                                let _ = app.emit(
                                    PROGRESS_EVENT,
                                    InstallProgress {
                                        id: install_id.to_string(),
                                        file: file_label.to_string(),
                                        received,
                                        total: t,
                                        percent,
                                    },
                                );
                            }
                        }
                    }
                    Some(Err(e)) => {
                        failed = true;
                        last_error = Some(anyhow!("Stream interrupted: {}", e));
                        break;
                    }
                    None => break,
                }
            }
        }

        if failed {
            drop(file);
            let _ = std::fs::remove_file(&part_path);
            retry_delay(attempt).await;
            continue;
        }

        file.flush().await?;
        drop(file);

        // Integrity verification — fail closed.
        let hash = format!("{:x}", hasher.finalize());
        if let Some(expected) = expected_sha256.filter(|e| !e.is_empty()) {
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

        if let Some(app) = progress {
            let _ = app.emit(
                PROGRESS_EVENT,
                InstallProgress {
                    id: install_id.to_string(),
                    file: file_label.to_string(),
                    received,
                    total: total.unwrap_or(received),
                    percent: 100.0,
                },
            );
        }
        return Ok(());
    }

    Err(last_error.unwrap_or_else(|| anyhow!("Download failed after retries")))
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

/// The `.part` temp path for a destination.
pub fn part_path(dest: &Path) -> PathBuf {
    dest.with_extension("part")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::hf::test_support::TestServerBuilder;
    use tempfile::tempdir;

    #[tokio::test]
    async fn downloads_verifies_and_renames_atomically() {
        let body = b"hello model bytes".to_vec();
        let server = TestServerBuilder::new(move |_| (200, body.clone()))
            .spawn()
            .await;
        let dir = tempdir().unwrap();
        let dest = dir.path().join("model.bin");
        // progress emission is optional; None is fine for unit tests
        let app: Option<&AppHandle> = None;

        let expected_sha = format!("{:x}", Sha256::digest(b"hello model bytes"));
        download_file(
            &Client::new(),
            &server.url,
            &dest,
            Some(&expected_sha),
            Some(18),
            app,
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
        // progress emission is optional; None is fine for unit tests
        let app: Option<&AppHandle> = None;

        let wrong_sha = "deadbeef".repeat(8);
        let err = download_file(
            &Client::new(),
            &server.url,
            &dest,
            Some(&wrong_sha),
            None,
            app,
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
        // progress emission is optional; None is fine for unit tests
        let cancel = CancellationToken::new();

        let handle = {
            let cancel = cancel.clone();
            let url = server.url.clone();
            let dest = dest.clone();
            tokio::spawn(async move {
                download_file(
                    &Client::new(),
                    &url,
                    &dest,
                    None,
                    None,
                    None,
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
        // progress emission is optional; None is fine for unit tests
        let app: Option<&AppHandle> = None;

        download_file(
            &Client::new(),
            &server.url,
            &dest,
            None,
            None,
            app,
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
        // progress emission is optional; None is fine for unit tests
        let app: Option<&AppHandle> = None;

        let err = download_file(
            &Client::new(),
            &server.url,
            &dest,
            None,
            None,
            app,
            "test-install",
            "model.bin",
            None,
        )
        .await
        .expect_err("all retries fail");
        server.stop();

        assert!(err.to_string().contains("HTTP 503"), "{}", err);
        assert!(!dest.exists());
        assert!(!part_path(&dest).exists());
    }
}
