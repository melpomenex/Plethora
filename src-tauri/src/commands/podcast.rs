//! Podcast subscription commands

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::models::document::{Document, FileType};
use crate::models::extract::Extract;
use crate::models::podcast::{
    ParsedPodcastFeed, PodcastEpisode, PodcastFeed, PodcastFeedResponse, PodcastSearchResponse,
    PodcastSearchResult,
};
use crate::podcast::parser::parse_podcast_feed;
use crate::transcription::engine::TranscriptSegment;
use crate::transcription::engine::TranscriptionEngine;
use crate::transcription::model_manager::ModelManager;
use chrono::Utc;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tokio::io::AsyncWriteExt;

/// Subscribe to a podcast feed
#[tauri::command]
pub async fn subscribe_podcast(
    feed_url: String,
    repo: State<'_, Repository>,
) -> Result<PodcastFeedResponse> {
    if let Some(existing) = repo.get_podcast_feed_by_url(&feed_url).await? {
        let episodes = repo
            .get_podcast_episodes(Some(&existing.id), Some(true))
            .await?;
        let episode_count = episodes.len() as i64;
        let unplayed_count = episodes.iter().filter(|e| !e.played).count() as i64;
        return Ok(PodcastFeedResponse {
            feed: existing,
            episode_count,
            unplayed_count,
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Plethora/1.31.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| PlethoraError::Internal(format!("Failed to build HTTP client: {}", e)))?;

    let response =
        client.get(&feed_url).send().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to fetch podcast feed: {}", e))
        })?;

    if !response.status().is_success() {
        return Err(PlethoraError::Internal(format!(
            "Failed to fetch podcast feed: HTTP {}",
            response.status()
        )));
    }

    let xml = response
        .text()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to read feed response: {}", e)))?;

    let parsed = parse_podcast_feed(&xml)
        .map_err(|e| PlethoraError::Internal(format!("Failed to parse podcast feed: {}", e)))?;

    let feed_id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let feed = PodcastFeed {
        id: feed_id.clone(),
        title: parsed.title,
        description: parsed.description,
        image_url: parsed.image_url,
        author: parsed.author,
        language: parsed.language,
        link: parsed.link,
        feed_url: feed_url.clone(),
        last_fetched: Some(now.clone()),
        subscribed_at: now,
        sort_order: 0,
        auto_transcribe: false,
        transcribe_language: None,
    };

    // Insert feed into DB
    repo.insert_podcast_feed(&feed).await?;

    repo.insert_podcast_episodes_bulk(&feed_id, &parsed.episodes)
        .await?;

    let episode_count = parsed.episodes.len() as i64;

    Ok(PodcastFeedResponse {
        feed,
        episode_count,
        unplayed_count: episode_count, // All new, so all unplayed
    })
}

/// Rename a podcast feed
#[tauri::command]
pub async fn rename_podcast_feed(
    feed_id: String,
    new_title: String,
    repo: State<'_, Repository>,
) -> Result<()> {
    repo.rename_podcast_feed(&feed_id, &new_title).await
}

/// Unsubscribe from a podcast feed (CASCADE deletes episodes)
#[tauri::command]
pub async fn unsubscribe_podcast(feed_id: String, repo: State<'_, Repository>) -> Result<()> {
    repo.delete_podcast_feed(&feed_id).await
}

/// Get all subscribed podcast feeds
#[tauri::command]
pub async fn get_podcast_feeds(repo: State<'_, Repository>) -> Result<Vec<PodcastFeedResponse>> {
    let feeds = repo.get_podcast_feeds().await?;
    let mut results = Vec::new();

    for feed in feeds {
        let episode_count = repo.count_podcast_episodes(&feed.id).await?;
        let unplayed_count = repo.count_unplayed_podcast_episodes(&feed.id).await?;
        results.push(PodcastFeedResponse {
            feed,
            episode_count,
            unplayed_count,
        });
    }

    Ok(results)
}

/// Refresh a podcast feed (refetch RSS, upsert new episodes).
/// If the feed has `auto_transcribe = true`, background transcription is spawned
/// for up to 3 untranscribed episodes after the refresh completes.
#[tauri::command]
pub async fn refresh_podcast_feed(
    feed_id: String,
    app_handle: AppHandle,
    repo: State<'_, Repository>,
    tokens: State<'_, PodcastTranscriptionTokens>,
) -> Result<PodcastFeedResponse> {
    let feed = repo
        .get_podcast_feed(&feed_id)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Podcast feed {}", feed_id)))?;

    let feed_url = feed.feed_url.clone();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Plethora/1.31.0")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| PlethoraError::Internal(format!("Failed to build HTTP client: {}", e)))?;

    let response =
        client.get(&feed_url).send().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to fetch podcast feed: {}", e))
        })?;

    if !response.status().is_success() {
        return Err(PlethoraError::Internal(format!(
            "Failed to fetch podcast feed: HTTP {}",
            response.status()
        )));
    }

    let xml = response
        .text()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to read feed response: {}", e)))?;

    let parsed = parse_podcast_feed(&xml)
        .map_err(|e| PlethoraError::Internal(format!("Failed to parse podcast feed: {}", e)))?;

    let mut updated_feed = feed.clone();
    updated_feed.title = parsed.title;
    updated_feed.description = parsed.description;
    if parsed.image_url.is_some() {
        updated_feed.image_url = parsed.image_url;
    }
    if parsed.author.is_some() {
        updated_feed.author = parsed.author;
    }
    let now = Utc::now().to_rfc3339();
    updated_feed.last_fetched = Some(now.clone());

    repo.update_podcast_feed_metadata(&updated_feed).await?;
    repo.update_podcast_feed_last_fetched(&feed_id, &now)
        .await?;

    // Upsert episodes (INSERT OR IGNORE preserves existing played/position)
    repo.insert_podcast_episodes_bulk(&feed_id, &parsed.episodes)
        .await?;

    let episode_count = repo.count_podcast_episodes(&feed_id).await?;
    let unplayed_count = repo.count_unplayed_podcast_episodes(&feed_id).await?;

    let response = PodcastFeedResponse {
        feed: updated_feed.clone(),
        episode_count,
        unplayed_count,
    };

    // ── Auto-transcribe background job ──────────────────────────────────
    if updated_feed.auto_transcribe {
        let bg_repo = repo.inner().clone();
        let bg_tokens = tokens.inner().clone();
        let bg_app = app_handle.clone();
        let bg_feed_id = feed_id.clone();

        tokio::spawn(async move {
            let config =
                match crate::commands::transcription_config::read_transcription_config(&bg_repo)
                    .await
                {
                    Some(config) => config,
                    None => {
                        eprintln!(
                            "[auto-transcribe] Skipped: transcription_config is missing or invalid"
                        );
                        return;
                    }
                };
            if config.provider != "local" {
                eprintln!(
                    "[auto-transcribe] Skipped: configured provider '{}' is not supported for background transcription",
                    config.provider
                );
                return;
            }
            let configured_model = match config.preferred_model_id {
                Some(model) => model,
                None => {
                    eprintln!("[auto-transcribe] Skipped: no configured transcription model");
                    return;
                }
            };
            let configured_language = config.language;
            match bg_repo.get_untranscribed_episodes(&bg_feed_id).await {
                Ok(episodes) => {
                    for ep in episodes.into_iter().take(3) {
                        let repo = bg_repo.clone();
                        let tokens = bg_tokens.clone();
                        let app = bg_app.clone();
                        let lang = Some(configured_language.clone());
                        let model = configured_model.clone();
                        let ep_id = ep.id.clone();

                        tokio::spawn(async move {
                            // Background best-effort — errors are logged, not propagated
                            if let Err(e) = run_transcription_job(
                                ep_id,
                                Some(model),
                                lang,
                                None,
                                app,
                                repo,
                                tokens,
                            )
                            .await
                            {
                                eprintln!("[auto-transcribe] Transcription failed: {}", e);
                            }
                        });
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[auto-transcribe] Failed to query untranscribed episodes: {}",
                        e
                    );
                }
            }
        });
    }

    Ok(response)
}

/// Get episodes for a podcast feed, or all episodes if feed_id is None
#[tauri::command]
pub async fn get_podcast_episodes(
    feed_id: Option<String>,
    include_played: Option<bool>,
    repo: State<'_, Repository>,
) -> Result<Vec<PodcastEpisode>> {
    repo.get_podcast_episodes(feed_id.as_deref(), include_played)
        .await
}

/// Mark an episode as played or unplayed
#[tauri::command]
pub async fn mark_episode_played(
    episode_id: String,
    played: bool,
    repo: State<'_, Repository>,
) -> Result<()> {
    repo.update_episode_played(&episode_id, played).await
}

/// Update the playback position of an episode
#[tauri::command]
pub async fn update_episode_position(
    episode_id: String,
    position: f64,
    repo: State<'_, Repository>,
) -> Result<()> {
    repo.update_episode_position(&episode_id, position).await
}

/// Get the playback position of an episode
#[tauri::command]
pub async fn get_episode_position(episode_id: String, repo: State<'_, Repository>) -> Result<f64> {
    repo.get_episode_position(&episode_id).await
}

// ── Podcast transcription ──────────────────────────────────────────────────

/// Managed state for podcast transcription cancellation tokens
pub type PodcastTranscriptionTokens = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

/// Minimum integer-percent change required before re-emitting a throttled
/// progress event. Values smaller than this are coalesced.
const PROGRESS_MIN_DELTA_PCT: i32 = 1;
/// Minimum elapsed time between two throttled progress emissions.
const PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(50);

/// Build a progress callback that throttles `podcast://transcription-progress`
/// emissions so the IPC bus isn't flooded (the engine fires the callback many
/// times per second). Emits only when the integer percent changed by
/// >= `PROGRESS_MIN_DELTA_PCT` AND >= `PROGRESS_MIN_INTERVAL` elapsed since the
/// last emit; the final 100% is always emitted. Throttle state lives in `state`
/// (shared `Arc<Mutex<(i32, Instant)>>` of `(last_emitted_pct, last_emit_time)`).
fn throttled_progress_cb(
    app: AppHandle,
    episode_id: String,
    state: Arc<Mutex<(i32, Instant)>>,
) -> Box<dyn Fn(i32) + Send + Sync> {
    Box::new(move |p: i32| {
        // Map the engine's 0..100 progress into the 30..100 band (download took
        // the first 30%). Clamp to [0, 100].
        let mapped = (30 + ((p as f64 / 100.0) * 70.0) as i32).clamp(0, 100);
        let is_final = p >= 100;

        let should_emit = {
            let mut guard = match state.lock() {
                Ok(g) => g,
                Err(e) => e.into_inner(), // poisoned — proceed anyway
            };
            let (last_pct, last_emit) = *guard;
            let pct_changed = (mapped - last_pct).abs() >= PROGRESS_MIN_DELTA_PCT;
            let time_ok = last_emit.elapsed() >= PROGRESS_MIN_INTERVAL;
            if is_final || (pct_changed && time_ok) {
                *guard = (mapped, Instant::now());
                true
            } else {
                false
            }
        };

        if should_emit {
            let _ = app.emit(
                "podcast://transcription-progress",
                serde_json::json!({
                    "episodeId": &episode_id,
                    "status": "transcribing",
                    "progress": mapped
                }),
            );
        }
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PodcastTranscriptResponse {
    pub text: String,
    pub segments: Vec<TranscriptSegmentInfo>,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptSegmentInfo {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    /// Optional per-word timings as JSON: `[{"word":"...", "start_ms":..., "end_ms":...}, ...]`
    /// Present when the transcript was produced via Groq word-level transcription.
    /// Enables word-by-word (karaoke) highlighting synced to audio playback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_timings_json: Option<String>,
}

/// Transcribe a podcast episode using Whisper
#[tauri::command]
pub async fn transcribe_podcast_episode(
    episode_id: String,
    model: Option<String>,
    language: Option<String>,
    auto_segment: Option<bool>,
    app_handle: AppHandle,
    repo: State<'_, Repository>,
    tokens: State<'_, PodcastTranscriptionTokens>,
) -> Result<()> {
    run_transcription_job(
        episode_id,
        model,
        language,
        auto_segment,
        app_handle,
        repo.inner().clone(),
        tokens.inner().clone(),
    )
    .await
}

/// Shared transcription logic used by both manual invocation and auto-transcribe.
/// Downloads audio, runs Whisper, stores transcript, creates Document + Extract records.
async fn run_transcription_job(
    episode_id: String,
    model: Option<String>,
    language: Option<String>,
    auto_segment: Option<bool>,
    app_handle: AppHandle,
    repo: Repository,
    tokens: PodcastTranscriptionTokens,
) -> Result<()> {
    // 1. Get episode
    let episode = repo
        .get_podcast_episode_by_id(&episode_id)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Podcast episode {}", episode_id)))?;

    let audio_url = episode.audio_url.clone();
    let model_id = model.ok_or_else(|| {
        PlethoraError::InvalidInput("No transcription model was requested.".to_string())
    })?;
    let lang = language.unwrap_or_else(|| "auto".to_string());

    // 2. Set status to downloading
    repo.update_episode_transcript_status(&episode_id, "downloading", None, None)
        .await?;

    let _ = app_handle.emit(
        "podcast://transcription-progress",
        serde_json::json!({
            "episodeId": &episode_id,
            "status": "downloading",
            "progress": 0
        }),
    );

    // 3. Download audio to temp file
    let temp_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| PlethoraError::Internal(e.to_string()))?
        .join("temp_transcription");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| PlethoraError::Internal(format!("Failed to create temp dir: {}", e)))?;

    let ext = episode
        .audio_type
        .as_deref()
        .and_then(|t| t.split('/').last())
        .unwrap_or("mp3");
    let temp_file = temp_dir.join(format!("{}_episode.{}", episode_id, ext));

    // Insert cancellation token
    let cancel_token = Arc::new(AtomicBool::new(false));
    {
        let mut map = tokens.lock().expect("podcast tokens mutex poisoned");
        map.insert(episode_id.clone(), cancel_token.clone());
    }

    // Cleanup token when done (success or error)
    let cleanup = |tokens: &PodcastTranscriptionTokens, id: &str| {
        if let Ok(mut map) = tokens.lock() {
            map.remove(id);
        }
    };

    // Download with streaming progress
    let download_result: std::result::Result<(), PlethoraError> = async {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| PlethoraError::Internal(format!("HTTP client error: {}", e)))?;

        let response = client
            .get(&audio_url)
            .send()
            .await
            .map_err(|e| PlethoraError::Internal(format!("Download failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(PlethoraError::Internal(format!(
                "Download failed: HTTP {}",
                response.status()
            )));
        }

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        let mut file = tokio::fs::File::create(&temp_file).await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to create temp file: {}", e))
        })?;

        // Local throttle state for download progress (last_emitted_pct, last_emit).
        let mut dl_throttle: (i32, Instant) = (-1, Instant::now() - Duration::from_secs(1));

        let mut stream = response.bytes_stream();
        while let Some(item) = stream.next().await {
            if cancel_token.load(Ordering::Relaxed) {
                return Err(PlethoraError::Internal(
                    "Transcription cancelled".to_string(),
                ));
            }
            let chunk = item
                .map_err(|e| PlethoraError::Internal(format!("Download stream error: {}", e)))?;
            file.write_all(&chunk)
                .await
                .map_err(|e| PlethoraError::Internal(format!("Write error: {}", e)))?;
            downloaded += chunk.len() as u64;

            if total_size > 0 {
                let download_pct = (downloaded as f64 / total_size as f64) * 30.0;
                let pct = download_pct as i32;
                let pct_changed = (pct - dl_throttle.0).abs() >= PROGRESS_MIN_DELTA_PCT;
                let time_ok = dl_throttle.1.elapsed() >= PROGRESS_MIN_INTERVAL;
                if pct_changed && time_ok {
                    dl_throttle = (pct, Instant::now());
                    let _ = app_handle.emit(
                        "podcast://transcription-progress",
                        serde_json::json!({
                            "episodeId": &episode_id,
                            "status": "downloading",
                            "progress": pct
                        }),
                    );
                }
            }
        }
        file.flush()
            .await
            .map_err(|e| PlethoraError::Internal(format!("Flush error: {}", e)))?;
        Ok(())
    }
    .await;

    if let Err(e) = download_result {
        let _ = std::fs::remove_file(&temp_file);
        repo.update_episode_transcript_status(&episode_id, "error", Some(&e.to_string()), None)
            .await?;
        cleanup(&tokens, &episode_id);
        return Err(e);
    }

    // 5. Set status to transcribing
    repo.update_episode_transcript_status(&episode_id, "transcribing", None, None)
        .await?;
    let _ = app_handle.emit(
        "podcast://transcription-progress",
        serde_json::json!({
            "episodeId": &episode_id,
            "status": "transcribing",
            "progress": 30
        }),
    );

    // 6. Prepare + transcribe using TranscriptionEngine
    let model_manager =
        ModelManager::new(&app_handle).map_err(|e| PlethoraError::Internal(e.to_string()))?;

    let selected_model = model_id;
    let model_path = match crate::models::hf::manager::resolve_installed_path(
        repo.pool(),
        &selected_model,
    )
    .await
    {
        Some(p) => p,
        None => {
            if !model_manager.is_model_installed(&selected_model) {
                let _ = std::fs::remove_file(&temp_file);
                let message = missing_requested_model_message(&selected_model);
                repo.update_episode_transcript_status(&episode_id, "error", Some(&message), None)
                    .await?;
                cleanup(&tokens, &episode_id);
                return Err(PlethoraError::InvalidInput(message));
            }
            model_manager.get_model_path(&selected_model)
        }
    };
    if !model_path.exists() {
        let _ = std::fs::remove_file(&temp_file);
        let message = format!("Model path not found: {}", model_path.display());
        repo.update_episode_transcript_status(&episode_id, "error", Some(&message), None)
            .await?;
        cleanup(&tokens, &episode_id);
        return Err(PlethoraError::InvalidInput(message));
    }

    let engine = TranscriptionEngine::new(app_handle.clone());
    let segments: Arc<Mutex<Vec<TranscriptSegment>>> = Arc::new(Mutex::new(Vec::new()));
    let segments_clone = segments.clone();
    let cancel_clone = cancel_token.clone();
    let app_clone = app_handle.clone();
    let ep_id = episode_id.clone();

    // Throttle progress events so we don't flood the IPC bus on every callback
    // invocation (the engine may fire the progress callback many times per
    // second). An event is emitted only when BOTH:
    //   - the integer percent changed by >= 1, AND
    //   - >= 50ms elapsed since the last emit.
    // The final 100% is always emitted regardless of throttle. State is shared
    // across the engine via an Arc.
    // (last_emitted_pct, last_emit_instant)
    let throttle: Arc<Mutex<(i32, Instant)>> =
        Arc::new(Mutex::new((-1, Instant::now() - Duration::from_secs(1))));

    if cancel_token.load(Ordering::Relaxed) {
        let _ = std::fs::remove_file(&temp_file);
        repo.update_episode_transcript_status(&episode_id, "error", Some("Cancelled"), None)
            .await?;
        cleanup(&tokens, &episode_id);
        return Err(PlethoraError::Internal(
            "Transcription cancelled".to_string(),
        ));
    }

    let transcribe_result = async {
        let prepared = engine
            .prepare_audio(Path::new(&temp_file))
            .await
            .map_err(|e| PlethoraError::Internal(format!("Audio preparation failed: {}", e)))?;

        let route = crate::models::hf::manager::stt_route_for_model(repo.pool(), &selected_model).await;
        let progress_cb: Option<Box<dyn Fn(i32) + Send + Sync>> = Some(throttled_progress_cb(
            app_clone.clone(),
            ep_id.clone(),
            throttle.clone(),
        ));

        let cancel_inner = cancel_clone.clone();
        let segments_inner = segments_clone.clone();
        let on_segment = move |seg: TranscriptSegment| {
            if cancel_inner.load(Ordering::Relaxed) {
                return;
            }
            if let Ok(mut guard) = segments_inner.lock() {
                guard.push(seg);
            }
        };

        let cancel_post = cancel_clone.clone();
        engine
            .transcribe_route(
                &prepared,
                &model_path,
                &route,
                &lang,
                on_segment,
                progress_cb,
            )
            .await
            .map_err(|e| PlethoraError::Internal(format!("Transcription failed: {}", e)))?;

        if cancel_post.load(Ordering::Relaxed) {
            return Err(PlethoraError::Internal(
                "Transcription cancelled".to_string(),
            ));
        }

        Ok::<(), PlethoraError>(())
    }
    .await;

    let _ = std::fs::remove_file(&temp_file);

    if let Err(e) = transcribe_result {
        repo.update_episode_transcript_status(&episode_id, "error", Some(&e.to_string()), None)
            .await?;
        cleanup(&tokens, &episode_id);
        return Err(e);
    }

    // 8. Concatenate segments into full transcript text
    let mut segments_vec = {
        let mut guard = segments.lock().unwrap_or_else(|e| e.into_inner());
        guard.sort_by(|a, b| a.start_ms.cmp(&b.start_ms));
        guard.clone()
    };

    let full_text: String = segments_vec
        .iter()
        .map(|s| s.text.trim())
        .collect::<Vec<&str>>()
        .join(" ");

    // 9. Store transcript in DB (the text blob for backward-compat search)
    repo.update_episode_transcript_status(&episode_id, "done", None, Some(&full_text))
        .await?;

    // 9b. Persist the real per-segment start_ms/end_ms timings so the viewer can
    //     sync highlighting to playback. (Local Whisper is segment-level only;
    //     word_timings_by_segment is all None here. Groq word-level timings are
    //     persisted via the separate save_podcast_transcript_segments path.)
    let word_timings_none: Vec<Option<String>> = segments_vec.iter().map(|_| None).collect();
    if let Err(e) = repo
        .save_podcast_transcript_segments(&episode_id, &segments_vec, &word_timings_none)
        .await
    {
        eprintln!(
            "[transcription] Failed to persist podcast segment timings for {}: {}",
            episode_id, e
        );
        // Non-fatal — the transcript blob is already stored.
    }

    // 10. Create Document + Extract records from transcript
    if let Err(e) =
        create_transcript_extracts(&repo, &episode, &full_text, auto_segment.unwrap_or(false)).await
    {
        eprintln!(
            "[transcription] Failed to create transcript extracts for {}: {}",
            episode_id, e
        );
        // Non-fatal — transcript itself is still stored
    }

    // 11. Emit completion
    let _ = app_handle.emit(
        "podcast://transcription-complete",
        serde_json::json!({
            "episodeId": &episode_id,
            "segmentCount": segments_vec.len(),
            "duration": episode.duration
        }),
    );

    cleanup(&tokens, &episode_id);
    Ok(())
}

fn missing_requested_model_message(model_id: &str) -> String {
    format!(
        "Model '{}' is not installed. Download it in Settings > Audio Transcription.",
        model_id
    )
}

#[cfg(test)]
mod transcription_model_tests {
    use super::missing_requested_model_message;

    #[test]
    fn missing_requested_model_error_names_the_request_without_substitution() {
        let message = missing_requested_model_message("parakeet-tdt-ctc-110m");
        assert!(message.contains("parakeet-tdt-ctc-110m"));
        assert!(!message.contains("distil-small.en"));
        assert!(!message.contains("base"));
    }
}

// ── Transcript → Extract generation ────────────────────────────────────────

/// Create a Document and Extract records from a completed transcript so the
/// content is reviewable in the Incrementum extract system.
async fn create_transcript_extracts(
    repo: &Repository,
    episode: &PodcastEpisode,
    full_text: &str,
    auto_segment: bool,
) -> Result<()> {
    let text = full_text.trim();
    if text.is_empty() {
        return Ok(());
    }

    let doc_title = format!("{} (Transcript)", episode.title);
    let mut doc = Document::new(
        doc_title,
        format!("podcast://{}", episode.id),
        FileType::Other,
    );
    doc.content = Some(text.to_string());
    doc.tags = vec!["podcast".to_string(), "transcript".to_string()];
    doc.is_favorite = false;
    let doc = repo.create_document(&doc).await?;

    if auto_segment {
        // Split transcript into chunks for Extract records.
        // Target ~1500 chars per chunk, breaking at sentence boundaries.
        let chunks = split_transcript_into_chunks(text, 1500);

        for chunk in &chunks {
            let mut extract = Extract::new(doc.id.clone(), chunk.clone());
            extract.tags = vec!["podcast".to_string(), "transcript".to_string()];
            extract.category = Some("podcast".to_string());
            extract.source_url = Some(format!("podcast://{}", episode.id));
            repo.create_extract(&extract).await?;
        }
    }

    Ok(())
}

/// Split text into chunks of roughly `target_len` characters at sentence boundaries.
fn split_transcript_into_chunks(text: &str, target_len: usize) -> Vec<String> {
    let sentences: Vec<&str> = text
        .split(|c: char| c == '.' || c == '!' || c == '?' || c == '\n')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    if sentences.is_empty() {
        return vec![];
    }

    let mut chunks = Vec::new();
    let mut current = String::new();

    for sentence in sentences {
        // Add separator if not the first sentence in the chunk
        if !current.is_empty() {
            if current.len() + sentence.len() + 2 > target_len && !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            } else {
                current.push(' ');
            }
        }
        current.push_str(sentence);
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

/// Get the transcript for a podcast episode
#[tauri::command]
pub async fn get_podcast_transcript(
    episode_id: String,
    repo: State<'_, Repository>,
) -> Result<PodcastTranscriptResponse> {
    let episode = repo
        .get_podcast_episode_by_id(&episode_id)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Podcast episode {}", episode_id)))?;

    let status = episode.transcript_status.clone();
    let text = episode.transcript_text.unwrap_or_default();

    if text.is_empty() {
        return Ok(PodcastTranscriptResponse {
            text,
            segments: Vec::new(),
            status,
        });
    }

    // Prefer real per-segment timings (with optional per-word timings) persisted
    // by transcription. These enable audio-synced highlighting and, when Groq
    // word-level transcription was used, word-by-word (karaoke) highlighting.
    // Fall back to the single-blob segment (old behavior) only when no real
    // segments are stored, so existing transcripts keep working.
    match repo
        .get_podcast_transcript_segments_with_words(&episode_id)
        .await
    {
        Ok(stored) if !stored.is_empty() => {
            return Ok(PodcastTranscriptResponse {
                text,
                segments: stored,
                status,
            });
        }
        _ => {}
    }

    let segments = vec![TranscriptSegmentInfo {
        start_ms: 0,
        end_ms: episode.duration.unwrap_or(0) * 1000,
        text: text.clone(),
        word_timings_json: None,
    }];

    Ok(PodcastTranscriptResponse {
        text,
        segments,
        status,
    })
}

/// Payload for a single segment when persisting Groq transcription results.
/// `word_timings_json` is optional (present for Groq word-level transcription,
/// enabling karaoke highlighting; absent for segment-only).
#[derive(Debug, Deserialize)]
pub struct SaveSegmentInput {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub word_timings_json: Option<String>,
}

/// Resolve a podcast audio URL through its redirect chain to the final media
/// URL. Many podcast feeds wrap the real audio in tracking-redirect chains
/// (podtrac → pdst → chrt → mgln → megaphone, etc., often 5-8 hops). Groq's
/// transcription API does NOT follow redirects on its `url` parameter — it
/// fetches exactly one hop and fails with "received status code: 302". So the
/// mobile Groq transcription path resolves the chain here (reqwest follows up
/// to 10 redirects) and passes the final 200-OK URL to Groq.
#[tauri::command]
pub async fn resolve_podcast_audio_url(url: String) -> Result<String> {
    let client = reqwest::Client::builder()
        // Mirror a browser-ish UA so CDN edge nodes don't block the HEAD.
        .user_agent("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Plethora")
        .build()
        .map_err(|e| PlethoraError::Internal(format!("Failed to build HTTP client: {}", e)))?;
    // Use GET (not HEAD): some podcast CDNs respond 405/404 to HEAD but 200 to
    // a range GET. We request 0 bytes via Range so we don't download the file —
    // we only need the final URL after redirects.
    let resp = client
        .get(&url)
        .header("Range", "bytes=0-0")
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to resolve audio URL: {}", e)))?;
    Ok(resp.url().to_string())
}

/// An audio chunk produced by the mobile splitter (ffmpeg-free). Mirrors the
/// desktop `AudioChunk` shape so the frontend chunked-transcription path is
/// shared, but the offset is in MILLISECONDS (mobile path works in ms) and the
/// path points at a temp file written by this command.
#[derive(Debug, serde::Serialize, Clone)]
pub struct MobileAudioChunk {
    pub index: usize,
    pub path: String,
    /// Approximate start time of this chunk within the original audio, in ms.
    /// Estimated from byte offset ÷ bitrate; the final per-segment timestamps
    /// come from Groq, this is just for assembling chunked results in order.
    pub start_ms: i64,
    pub end_ms: i64,
    pub bytes: u64,
}

/// Remove temporary transcription chunks on every return path, including
/// provider errors and cancelled requests.
struct RemoveDirOnDrop(PathBuf);

impl Drop for RemoveDirOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Target chunk size for the mobile splitter. Groq's free-tier limit is 25 MB;
/// we target 20 MB to stay safely under and leave room for the multipart upload
/// overhead. Podcast MP3s are typically 64-128 kbps, so 20 MB ≈ 20-40 min/chunk.
const MOBILE_CHUNK_TARGET: u64 = 20 * 1024 * 1024;
const CONTAINER_CHUNK_DURATION_SECONDS: f64 = 600.0;

/// Split a remote podcast MP3 into <25 MB chunks on-device without FFmpeg
/// (ffmpeg isn't available on Android). The audio is downloaded in full to a temp
/// file, then split on **MP3 frame boundaries** (the 11-bit sync word 0x7FF) so
/// each chunk is independently decodable by Groq. Non-MP3 containers are rejected
/// with an actionable error instead of being uploaded as invalid byte ranges.
/// Each chunk's start_ms is estimated from byte offset ÷ bitrate (parsed from the
/// first MP3 frame header). This is what makes full-episode (40-100MB) podcast
/// transcription work on mobile within Groq's 25 MB limit.
#[tauri::command]
pub async fn split_audio_for_groq_mobile(
    app_handle: AppHandle,
    url: String,
) -> Result<Vec<MobileAudioChunk>> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Plethora")
        .build()
        .map_err(|e| PlethoraError::Internal(format!("Failed to build HTTP client: {}", e)))?;
    split_audio_for_groq_mobile_inner(&app_handle, &client, &url).await
}

/// Inner split logic, shared by the standalone command and the all-in-one
/// `transcribe_podcast_groq_chunks` command (which already has a client).
/// Downloads the remote audio, then delegates to [`split_audio_bytes_into_groq_chunks`].
async fn split_audio_for_groq_mobile_inner(
    app_handle: &AppHandle,
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<MobileAudioChunk>> {
    use futures_util::StreamExt;

    eprintln!(
        "[podcast-transcribe] split_audio_for_groq_mobile: downloading from {}",
        url
    );

    // 1. Stream-download the full audio to a temp file (follows redirects).
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| PlethoraError::Internal(format!("Failed to resolve cache dir: {}", e)))?;
    let chunks_dir = cache_dir.join("groq_mobile_chunks");
    let _ = std::fs::remove_dir_all(&chunks_dir);
    std::fs::create_dir_all(&chunks_dir)?;

    let full_path = chunks_dir.join("source.bin");
    let mut file = tokio::fs::File::create(&full_path)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to create temp file: {}", e)))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to download audio: {}", e)))?;
    if !resp.status().is_success() {
        return Err(PlethoraError::Internal(format!(
            "Audio download failed: HTTP {}",
            resp.status()
        )));
    }
    // Detect format from Content-Type / URL extension to pick the split strategy.
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let is_mp3 = content_type.contains("mpeg")
        || content_type.contains("mp3")
        || url.to_ascii_lowercase().ends_with(".mp3");

    let mut stream = resp.bytes_stream();
    while let Some(item) = stream.next().await {
        let chunk =
            item.map_err(|e| PlethoraError::Internal(format!("Download stream error: {}", e)))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to write temp file: {}", e)))?;
    }
    file.flush().await?;
    drop(file);

    // 2. Read the downloaded bytes and split them (shared with the local-file path).
    let data = std::fs::read(&full_path)
        .map_err(|e| PlethoraError::Internal(format!("Failed to read temp file: {}", e)))?;
    let chunks_out = split_audio_bytes_into_groq_chunks(&data, is_mp3, &chunks_dir)?;

    // Remove the full source file; chunk files remain for upload + later cleanup.
    let _ = std::fs::remove_file(&full_path);

    if chunks_out.is_empty() {
        return Err(PlethoraError::Internal(
            "Audio split produced no chunks (empty download?)".to_string(),
        ));
    }
    Ok(chunks_out)
}

/// Split already-in-memory MP3 bytes into <25 MB chunks (ffmpeg-free) on MP3
/// frame boundaries. Container formats must use the FFmpeg path below: an
/// arbitrary M4B byte range is not an independently decodable audio file and
/// must never be uploaded as a fake MP3.
fn split_audio_bytes_into_groq_chunks(
    data: &[u8],
    is_mp3: bool,
    chunks_dir: &Path,
) -> Result<Vec<MobileAudioChunk>> {
    if !is_mp3 {
        return Err(PlethoraError::Internal(
            "Safe Groq chunking requires FFmpeg for non-MP3 audiobook containers".to_string(),
        ));
    }
    let total = data.len() as u64;

    // Parse the bitrate from the first valid MP3 frame header for start_ms
    // estimation. A nominal bitrate remains a defensive fallback for malformed
    let bitrate_bps: u64 = find_mp3_frame_bitrate(data).unwrap_or(128_000);

    // Compute split boundaries by advancing to the next MP3 frame sync so each
    // upload starts with a decodable frame.
    let mut boundaries: Vec<u64> = vec![0];
    let mut cursor: u64 = MOBILE_CHUNK_TARGET;
    while cursor < total {
        let boundary = find_next_mp3_frame(data, cursor).unwrap_or(cursor);
        boundaries.push(boundary.min(total));
        cursor = boundary + MOBILE_CHUNK_TARGET;
    }
    if *boundaries.last().unwrap() < total {
        boundaries.push(total);
    }

    // Write each chunk to its own file and record its byte range + est. start_ms.
    let mut chunks_out = Vec::new();
    for i in 0..boundaries.len().saturating_sub(1) {
        let start_byte = boundaries[i];
        let end_byte = boundaries[i + 1];
        let chunk_bytes = &data[start_byte as usize..end_byte as usize];
        let chunk_path = chunks_dir.join(format!("chunk_{:04}.mp3", i));
        std::fs::write(&chunk_path, chunk_bytes).map_err(|e| {
            PlethoraError::Internal(format!("Failed to write chunk {}: {}", i, e))
        })?;
        let start_ms = (start_byte * 8000 / bitrate_bps.max(1)) as i64;
        let end_ms = (end_byte * 8000 / bitrate_bps.max(1)) as i64;
        chunks_out.push(MobileAudioChunk {
            index: i,
            path: chunk_path.to_string_lossy().to_string(),
            start_ms,
            end_ms,
            bytes: (end_byte - start_byte),
        });
    }

    eprintln!(
        "[groq-split] split complete: {} bytes, {} chunks (bitrate {}bps), mp3={}",
        total,
        chunks_out.len(),
        bitrate_bps,
        is_mp3
    );

    Ok(chunks_out)
}

/// Run FFmpeg and return its stderr. This is used for local container formats
/// such as M4B, where raw byte splitting would create invalid uploads.
async fn run_ffmpeg_for_groq(app_handle: &AppHandle, args: &[&str]) -> Result<String> {
    let (mut rx, _) = crate::utils::ffmpeg::ffmpeg_command(app_handle)
        .map_err(|e| PlethoraError::Internal(format!("Failed to get ffmpeg command: {}", e)))?
        .args(args)
        .spawn()
        .map_err(|e| PlethoraError::Internal(format!("Failed to spawn ffmpeg: {}", e)))?;

    let mut stderr = String::new();
    let mut exit_code = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) => stderr.push_str(&String::from_utf8_lossy(&line)),
            CommandEvent::Terminated(payload) => {
                exit_code = Some(payload.code);
                break;
            }
            _ => {}
        }
    }

    if exit_code != Some(Some(0)) {
        let detail = stderr
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("unknown FFmpeg error");
        return Err(PlethoraError::Internal(format!(
            "FFmpeg failed while preparing Groq chunks: {}",
            detail
        )));
    }

    Ok(stderr)
}

fn parse_ffmpeg_duration_seconds(stderr: &str) -> Option<f64> {
    let marker = "Duration:";
    let value = stderr.split(marker).nth(1)?.split(',').next()?.trim();
    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours = parts[0].parse::<f64>().ok()?;
    let minutes = parts[1].parse::<f64>().ok()?;
    let seconds = parts[2].parse::<f64>().ok()?;
    let duration = hours * 3600.0 + minutes * 60.0 + seconds;
    (duration.is_finite() && duration > 0.0).then_some(duration)
}

/// Decode a local container and write short, independently decodable MP3
/// chunks. Fixed low bitrate keeps every multipart body well below Groq's
/// limit even when the source M4B is very large.
async fn split_local_container_for_groq(
    app_handle: &AppHandle,
    file_path: &str,
    chunks_dir: &Path,
) -> Result<Vec<MobileAudioChunk>> {
    let probe_stderr = run_ffmpeg_for_groq(app_handle, &["-hide_banner", "-i", file_path, "-f", "null", "-"]).await?;
    let total_duration = parse_ffmpeg_duration_seconds(&probe_stderr).ok_or_else(|| {
        PlethoraError::Internal(
            "FFmpeg could not determine the audiobook duration for safe Groq chunking".to_string(),
        )
    })?;
    let chunk_count = (total_duration / CONTAINER_CHUNK_DURATION_SECONDS).ceil().max(1.0) as usize;
    let mut chunks = Vec::with_capacity(chunk_count);

    for index in 0..chunk_count {
        let start_time = index as f64 * CONTAINER_CHUNK_DURATION_SECONDS;
        let duration = (total_duration - start_time).min(CONTAINER_CHUNK_DURATION_SECONDS);
        let output_path = chunks_dir.join(format!("chunk_{:04}.mp3", index));
        let start_text = start_time.to_string();
        let duration_text = duration.to_string();
        let output_text = output_path.to_str().ok_or_else(|| {
            PlethoraError::Internal("Groq chunk path is not valid UTF-8".to_string())
        })?;

        run_ffmpeg_for_groq(
            app_handle,
            &[
                "-hide_banner",
                "-y",
                "-i",
                file_path,
                "-ss",
                &start_text,
                "-t",
                &duration_text,
                "-vn",
                "-map_metadata",
                "-1",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "32k",
                "-f",
                "mp3",
                output_text,
            ],
        )
        .await?;

        let bytes = std::fs::metadata(&output_path)
            .map_err(|e| PlethoraError::Internal(format!("Failed to inspect Groq chunk {}: {}", index, e)))?
            .len();
        if bytes >= MOBILE_CHUNK_TARGET {
            return Err(PlethoraError::Internal(format!(
                "FFmpeg produced an over-limit Groq chunk ({bytes} bytes)"
            )));
        }

        chunks.push(MobileAudioChunk {
            index,
            path: output_path.to_string_lossy().to_string(),
            start_ms: (start_time * 1000.0).round() as i64,
            end_ms: ((start_time + duration) * 1000.0).round() as i64,
            bytes,
        });
    }

    Ok(chunks)
}

/// Scan `data` for the first valid MP3 frame header and return its bitrate in
/// bits/sec. MP3 frame headers start with an 11-bit sync word (0x7FF): the first
/// byte is 0xFF and the upper 3 bits of the second byte are all 1. We then read
/// the 4-bit bitrate index from the frame header using the MPEG1 Layer III
/// bitrate table. Returns None if no valid frame is found (non-MP3 data).
fn find_mp3_frame_bitrate(data: &[u8]) -> Option<u64> {
    // MPEG1 Layer III bitrate table (kbps), indexed by the 4-bit bitrate field.
    const BITRATES: [u64; 16] = [
        0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
    ];
    let n = data.len().saturating_sub(4);
    for i in 0..n {
        if data[i] != 0xFF {
            continue;
        }
        let b = data[i + 1];
        // 11-bit sync: 0xFF followed by upper-3-bits set (0xE0 mask). Also
        // require Layer III (bits 2-1 == 01, i.e. (b >> 1) & 0x3 == 0x1).
        if (b & 0xE0) != 0xE0 {
            continue;
        }
        let layer = (b >> 1) & 0x3;
        if layer != 0x1 {
            // Layer III encoded as 01 in the header bits.
            continue;
        }
        // Bitrate index is the high nibble of byte 2.
        let bitrate_index = ((data[i + 2] >> 4) & 0xF) as usize;
        let kbps = BITRATES[bitrate_index];
        if kbps > 0 {
            return Some(kbps * 1000);
        }
    }
    None
}

/// From `min_byte`, scan forward (up to a small window) for the next MP3 frame
/// sync (0xFF then upper-3-bits 0xE0). Returns the byte offset of that frame, or
/// None if no frame is found within the window (caller falls back to raw split).
fn find_next_mp3_frame(data: &[u8], min_byte: u64) -> Option<u64> {
    let start = (min_byte as usize).min(data.len().saturating_sub(2));
    // Search window: ~256 KB. A frame at 128kbps is ~0.5-1.5KB, so 256KB is
    // hundreds of frames — plenty to find a clean boundary. If none, the file is
    // likely not actually MP3 despite the extension; fall back.
    let end = (start + 256 * 1024).min(data.len().saturating_sub(1));
    let mut i = start;
    while i < end {
        if data[i] == 0xFF && i + 1 < data.len() && (data[i + 1] & 0xE0) == 0xE0 {
            return Some(i as u64);
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod mp3_tests {
    use super::*;

    /// Build a synthetic MP3-like byte stream: a valid frame header (0xFF 0xFB =
    /// MPEG1 Layer III, no CRC) followed by `payload_len` padding bytes, repeated
    /// `frame_count` times. The bitrate nibble is set to index 9 (128 kbps).
    fn synthetic_mp3(frame_count: usize, payload_len: usize) -> Vec<u8> {
        let mut out = Vec::new();
        for _ in 0..frame_count {
            out.push(0xFF);
            out.push(0xFB); // sync + MPEG1 Layer III
                            // Byte 2 high nibble = bitrate index 9 (128kbps) → 0x90; low nibble
                            // can be anything valid; use 0x00.
            out.push(0x90);
            out.push(0x00);
            out.extend(std::iter::repeat(0u8).take(payload_len));
        }
        out
    }

    #[test]
    fn finds_bitrate_from_first_mp3_frame() {
        let data = synthetic_mp3(3, 100);
        assert_eq!(find_mp3_frame_bitrate(&data), Some(128_000));
    }

    #[test]
    fn bitrate_none_for_non_mp3_data() {
        // No 0xFF sync byte → not MP3.
        let data = vec![0x00u8; 2048];
        assert_eq!(find_mp3_frame_bitrate(&data), None);
    }

    #[test]
    fn finds_next_frame_after_a_byte_offset() {
        // Two frames of 104 bytes each (4 header + 100 payload).
        let data = synthetic_mp3(3, 100);
        // Look for a frame starting somewhere in the middle of frame 0's payload
        // — should find the start of frame 1.
        let next = find_next_mp3_frame(&data, 50);
        assert_eq!(next, Some(104), "should land on the next frame boundary");
    }

    #[test]
    fn find_next_frame_returns_none_if_no_sync_in_window() {
        let data = vec![0x00u8; 2048]; // no sync bytes at all
        assert_eq!(find_next_mp3_frame(&data, 0), None);
    }

    #[test]
    fn bitrate_ignores_false_sync_followed_by_non_layer3() {
        // 0xFF 0xF0 has the sync bits but layer bits 00 (reserved), not Layer III.
        let mut data = vec![0xFF, 0xF0];
        data.extend(std::iter::repeat(0u8).take(100));
        // A real Layer III frame later in the stream should still be found.
        data.push(0xFF);
        data.push(0xFB);
        data.push(0x90);
        data.push(0x00);
        // Trailing padding so the real frame is within the scanner's bound
        // (find_mp3_frame_bitrate loops i in 0..len-4, so the real frame at the
        // tail needs ≥4 bytes after it to be examined).
        data.extend(std::iter::repeat(0u8).take(10));
        assert_eq!(find_mp3_frame_bitrate(&data), Some(128_000));
    }

    #[test]
    fn parses_ffmpeg_duration() {
        let stderr = "Duration: 01:02:03.50, start: 0.000000, bitrate: 64 kb/s";
        assert_eq!(parse_ffmpeg_duration_seconds(stderr), Some(3723.5));
    }

    #[test]
    fn rejects_raw_container_byte_splitting() {
        let dir = tempfile::tempdir().expect("temp dir");
        let error = split_audio_bytes_into_groq_chunks(&[0, 1, 2], false, dir.path())
            .expect_err("container bytes must use FFmpeg");
        assert!(error.to_string().contains("requires FFmpeg"));
    }
}

/// Clean up temp chunk files created by split_audio_for_groq_mobile after the
/// transcription uploads are done (success or failure).
#[tauri::command]
pub async fn cleanup_mobile_audio_chunks(app_handle: AppHandle) -> Result<()> {
    if let Ok(cache_dir) = app_handle.path().app_cache_dir() {
        let _ = std::fs::remove_dir_all(cache_dir.join("groq_mobile_chunks"));
    }
    Ok(())
}

/// A single Groq-transcribed segment returned by transcribe_podcast_groq_chunks.
#[derive(Debug, serde::Serialize)]
pub struct GroqChunkSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub word_timings_json: Option<String>,
}

/// Transcribe a podcast episode's audio entirely on the Rust side: download →
/// split into <25MB chunks (MP3 frame splitting or FFmpeg for containers) → upload each chunk to Groq with
/// word-level timestamps → combine offsets → return segments. This avoids
/// transferring multi-megabyte chunk bytes over the Tauri IPC as JSON (which is
/// what hung the previous frontend-driven path — serializing ~18MB of bytes per
/// chunk is enormously slow). Everything stays in Rust; only the resulting
/// segment text + timings cross the IPC boundary. Emits progress events.
#[tauri::command]
pub async fn transcribe_podcast_groq_chunks(
    app_handle: AppHandle,
    episode_id: String,
    audio_url: String,
    language: Option<String>,
    groq_api_key: String,
    groq_model: Option<String>,
    api_url: Option<String>,
) -> Result<Vec<GroqChunkSegment>> {
    let model = groq_model.unwrap_or_else(|| "whisper-large-v3-turbo".to_string());
    let endpoint = api_url.unwrap_or_else(|| "https://api.groq.com/openai/v1/audio/transcriptions".to_string());
    let is_openrouter = endpoint.contains("openrouter.ai");
    let provider_name = if is_openrouter { "OpenRouter" } else { "Groq" };
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Plethora")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| PlethoraError::Internal(format!("HTTP client build failed: {}", e)))?;

    // 1. Split on-device into <25 MB chunks (download + MP3 frame split).
    let _ = app_handle.emit(
        "podcast://transcription-progress",
        serde_json::json!({ "episodeId": &episode_id, "status": "processing", "progress": 15, "message": "Splitting audio…" }),
    );
    let chunks = split_audio_for_groq_mobile_inner(&app_handle, &client, &audio_url).await?;
    eprintln!(
        "[podcast-transcribe] {}_chunks: {} chunks to transcribe",
        provider_name.to_lowercase(),
        chunks.len()
    );

    let mut combined: Vec<GroqChunkSegment> = Vec::new();

    for (i, chunk) in chunks.iter().enumerate() {
        let progress = 20 + ((i as f64 / chunks.len() as f64) * 65.0) as i64;
        let _ = app_handle.emit(
            "podcast://transcription-progress",
            serde_json::json!({ "episodeId": &episode_id, "status": "processing", "progress": progress, "message": format!("Transcribing chunk {}/{} via {}…", i + 1, chunks.len(), provider_name) }),
        );

        // Read chunk bytes from disk (stays in Rust — no IPC).
        let chunk_bytes = std::fs::read(&chunk.path).map_err(|e| {
            PlethoraError::Internal(format!("Failed to read chunk {}: {}", i, e))
        })?;
        eprintln!(
            "[podcast-transcribe] {}_chunks: chunk {} = {} bytes",
            provider_name.to_lowercase(),
            i,
            chunk_bytes.len()
        );

        // Upload to cloud as multipart file (verbose_json + segment/word granularity).
        let mut form = reqwest::multipart::Form::new()
            .text("model", model.clone())
            .text("response_format", "verbose_json".to_string())
            .text("timestamp_granularities[]", "segment".to_string())
            .text("timestamp_granularities[]", "word".to_string());
        if let Some(lang) = &language {
            form = form.text("language", lang.clone());
        }
        let part = reqwest::multipart::Part::bytes(chunk_bytes)
            .file_name(format!("chunk_{:04}.mp3", i))
            .mime_str("audio/mp3")
            .map_err(|e| PlethoraError::Internal(format!("mime build failed: {}", e)))?;
        form = form.part("file", part);

        let resp = client
            .post(&endpoint)
            .bearer_auth(&groq_api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| {
                PlethoraError::Internal(format!("{} chunk {} upload failed: {}", provider_name, i, e))
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            eprintln!(
                "[podcast-transcribe] {}_chunks: chunk {} FAILED ({}): {}",
                provider_name.to_lowercase(),
                i,
                status,
                &body[..body.len().min(300)]
            );
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(PlethoraError::Internal(format!(
                    "{} API key is invalid or unauthorized (HTTP 401). Please verify your {} key in Settings.",
                    provider_name, provider_name
                )));
            }
            let detail = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| body[..body.len().min(200)].to_string())
            } else {
                body[..body.len().min(200)].to_string()
            };
            return Err(PlethoraError::Internal(format!(
                "{} chunk {} failed (HTTP {}): {}",
                provider_name, i, status, detail
            )));
        }

        let data: serde_json::Value = resp.json().await.map_err(|e| {
            PlethoraError::Internal(format!("Groq chunk {} JSON parse failed: {}", i, e))
        })?;

        // Map this chunk's segments, adding the chunk's start_ms offset.
        let words = data
            .get("words")
            .and_then(|w| w.as_array())
            .cloned()
            .unwrap_or_default();
        let segments = data
            .get("segments")
            .and_then(|s| s.as_array())
            .cloned()
            .unwrap_or_default();
        let mut wc = 0usize;
        for seg in segments.iter() {
            let seg_start = seg.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let seg_end = seg.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let seg_text = seg
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            // Collect words whose midpoint falls within [seg_start, seg_end].
            let mut seg_words: Vec<serde_json::Value> = Vec::new();
            while wc < words.len() {
                let w = &words[wc];
                let ws = w.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let we = w.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let wmid = (ws + we) / 2.0;
                if wmid < seg_start {
                    wc += 1;
                    continue;
                }
                if wmid >= seg_end {
                    break;
                }
                seg_words.push(serde_json::json!({
                    "word": w.get("word").and_then(|v| v.as_str()).unwrap_or(""),
                    "start_ms": chunk.start_ms + (ws * 1000.0).round() as i64,
                    "end_ms": chunk.start_ms + (we * 1000.0).round() as i64,
                }));
                wc += 1;
            }

            combined.push(GroqChunkSegment {
                start_ms: chunk.start_ms + (seg_start * 1000.0).round() as i64,
                end_ms: chunk.start_ms + (seg_end * 1000.0).round() as i64,
                text: seg_text,
                word_timings_json: if seg_words.is_empty() {
                    None
                } else {
                    Some(serde_json::to_string(&seg_words).unwrap_or_default())
                },
            });
        }

        // Small delay to respect Groq rate limits.
        if i < chunks.len() - 1 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    // Clean up temp chunk files.
    if let Ok(cache_dir) = app_handle.path().app_cache_dir() {
        let _ = std::fs::remove_dir_all(cache_dir.join("groq_mobile_chunks"));
    }

    eprintln!(
        "[podcast-transcribe] groq_chunks: DONE, {} combined segments",
        combined.len()
    );
    Ok(combined)
}

/// Transcribe a LOCAL audio file (an audiobook staged on-device) entirely in
/// Rust: split MP3s on frame boundaries or decode containers into <25 MB MP3
/// chunks → upload each chunk to Groq with word-level timestamps → combine offsets →
/// persist the resulting segments into the document transcript tables (the same
/// `transcripts`/`transcript_segments` tables `get_transcript` reads from, keyed
/// by `book_id = chapter_id = document_id`) → also write the combined full text
/// to `documents.content` so the AI assistant / book sync can see it.
///
/// This mirrors `transcribe_podcast_groq_chunks` but for local audiobook files
/// instead of remote podcast URLs. It exists because the auto-transcription
/// queue worker (`auto_queue::process_entry`) only knows how to run local
/// Whisper/Parakeet/SenseVoice models — it has no Groq path, so on mobile
/// (where local STT is unavailable) audiobooks need this dedicated command.
///
/// Emits `audiobook://transcription-progress` (keyed by documentId) and returns
/// the final segment count.
#[tauri::command]
pub async fn transcribe_audio_file_groq(
    app_handle: AppHandle,
    repo: State<'_, Repository>,
    document_id: String,
    file_path: String,
    language: Option<String>,
    groq_api_key: String,
    groq_model: Option<String>,
    api_url: Option<String>,
) -> Result<i64> {
    let model = groq_model.unwrap_or_else(|| "whisper-large-v3-turbo".to_string());
    let endpoint = api_url.unwrap_or_else(|| "https://api.groq.com/openai/v1/audio/transcriptions".to_string());
    let is_openrouter = endpoint.contains("openrouter.ai");
    let provider_name = if is_openrouter { "OpenRouter" } else { "Groq" };
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Plethora")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| PlethoraError::Internal(format!("HTTP client build failed: {}", e)))?;

    // 1. Read the local audio file.
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(PlethoraError::NotFound(format!(
            "Audio file not found: {}",
            file_path
        )));
    }
    let _ = app_handle.emit(
        "audiobook://transcription-progress",
        serde_json::json!({ "documentId": &document_id, "status": "processing", "progress": 5, "message": "Reading audio…" }),
    );
    let is_mp3 = file_path.to_ascii_lowercase().ends_with(".mp3");
    // Container inputs are decoded by FFmpeg below; avoid loading an entire
    // multi-hundred-megabyte M4B into memory just to split it again.
    let data = if is_mp3 {
        std::fs::read(path).map_err(|e| {
            PlethoraError::Internal(format!("Failed to read audio file {}: {}", file_path, e))
        })?
    } else {
        Vec::new()
    };

    // 2. Split into safe, independently decodable chunks. MP3 can be split
    // without FFmpeg; containers are decoded and re-encoded below.
    let _ = app_handle.emit(
        "audiobook://transcription-progress",
        serde_json::json!({ "documentId": &document_id, "status": "processing", "progress": 10, "message": "Splitting audio…" }),
    );
    let cache_dir = app_handle
        .path()
        .app_cache_dir()
        .map_err(|e| PlethoraError::Internal(format!("Failed to resolve cache dir: {}", e)))?;
    let chunks_dir = cache_dir.join("groq_mobile_chunks");
    let _ = std::fs::remove_dir_all(&chunks_dir);
    std::fs::create_dir_all(&chunks_dir)?;
    let _chunk_cleanup = RemoveDirOnDrop(chunks_dir.clone());
    let chunks = if is_mp3 {
        split_audio_bytes_into_groq_chunks(&data, true, &chunks_dir)?
    } else {
        // M4B/M4A/MP4 are containers; arbitrary byte ranges are not valid
        // standalone uploads. Decode them into small MP3 chunks instead.
        split_local_container_for_groq(&app_handle, &file_path, &chunks_dir).await?
    };
    eprintln!(
        "[audiobook-transcribe] {}: {} chunks for document {}",
        provider_name.to_lowercase(),
        chunks.len(),
        document_id
    );

    // 3. Mark the transcript as processing without replacing its row. Existing
    // segments are checkpoints from an interrupted run and must survive.
    sqlx::query("INSERT INTO transcripts (book_id, chapter_id, model_used, language, status) VALUES (?, ?, ?, ?, 'processing') ON CONFLICT(book_id, chapter_id) DO UPDATE SET model_used = excluded.model_used, language = excluded.language, status = 'processing', error_message = NULL, updated_at = CURRENT_TIMESTAMP")
        .bind(&document_id)
        .bind(&document_id)
        .bind(&model)
        .bind(language.as_deref().unwrap_or("en"))
        .execute(repo.pool())
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to mark transcript processing: {}", e)))?;

    let transcript_id: i64 =
        sqlx::query_scalar("SELECT id FROM transcripts WHERE book_id = ? AND chapter_id = ?")
            .bind(&document_id)
            .bind(&document_id)
            .fetch_one(repo.pool())
            .await
            .map_err(|e| {
                PlethoraError::Internal(format!("Failed to fetch transcript id: {}", e))
            })?;
    let resume_start_ms: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(end_ms), 0) FROM transcript_segments WHERE transcript_id = ?",
    )
    .bind(transcript_id)
    .fetch_one(repo.pool())
    .await
    .map_err(|e| {
        PlethoraError::Internal(format!("Failed to read transcript checkpoint: {}", e))
    })?;

    // 4. Upload each chunk and persist segments as they arrive.
    for (i, chunk) in chunks.iter().enumerate() {
        // A response is persisted only after the whole chunk has returned,
        // so any chunk beginning before the last saved segment belongs to a
        // completed checkpoint. A chunk beginning exactly at the checkpoint is
        // still pending and must run.
        if resume_start_ms > 0 && chunk.start_ms < resume_start_ms {
            continue;
        }
        let progress = 15 + ((i as f64 / chunks.len() as f64) * 70.0) as i64;
        let _ = app_handle.emit(
            "audiobook://transcription-progress",
            serde_json::json!({ "documentId": &document_id, "status": "processing", "progress": progress, "message": format!("Transcribing chunk {}/{} via {}…", i + 1, chunks.len(), provider_name) }),
        );

        let chunk_bytes = std::fs::read(&chunk.path).map_err(|e| {
            PlethoraError::Internal(format!("Failed to read chunk {}: {}", i, e))
        })?;

        let mut form = reqwest::multipart::Form::new()
            .text("model", model.clone())
            .text("response_format", "verbose_json".to_string())
            .text("timestamp_granularities[]", "segment".to_string())
            .text("timestamp_granularities[]", "word".to_string());
        if let Some(lang) = &language {
            form = form.text("language", lang.clone());
        }
        let part = reqwest::multipart::Part::bytes(chunk_bytes)
            .file_name(format!("chunk_{:04}.mp3", i))
            .mime_str("audio/mp3")
            .map_err(|e| PlethoraError::Internal(format!("mime build failed: {}", e)))?;
        form = form.part("file", part);

        let resp = client
            .post(&endpoint)
            .bearer_auth(&groq_api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| {
                PlethoraError::Internal(format!("{} chunk {} upload failed: {}", provider_name, i, e))
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            eprintln!(
                "[audiobook-transcribe] {}: chunk {} FAILED ({}): {}",
                provider_name.to_lowercase(),
                i,
                status,
                &body[..body.len().min(300)]
            );
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err(PlethoraError::Internal(format!(
                    "{} API key is invalid or unauthorized (HTTP 401). Please verify your {} key in Settings.",
                    provider_name, provider_name
                )));
            }
            let detail = if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| body[..body.len().min(200)].to_string())
            } else {
                body[..body.len().min(200)].to_string()
            };
            return Err(PlethoraError::Internal(format!(
                "{} chunk {} failed (HTTP {}): {}",
                provider_name, i, status, detail
            )));
        }

        let data_json: serde_json::Value = resp.json().await.map_err(|e| {
            PlethoraError::Internal(format!("Groq chunk {} JSON parse failed: {}", i, e))
        })?;

        let words = data_json
            .get("words")
            .and_then(|w| w.as_array())
            .cloned()
            .unwrap_or_default();
        let segments = data_json
            .get("segments")
            .and_then(|s| s.as_array())
            .cloned()
            .unwrap_or_default();
        let mut persisted_chunk = Vec::with_capacity(segments.len());
        let mut word_cursor = 0usize;
        for seg in segments.iter() {
            let seg_start = seg.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let seg_end = seg.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let seg_text = seg
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if seg_text.is_empty() {
                continue;
            }

            let start_ms = chunk.start_ms + (seg_start * 1000.0).round() as i64;
            let end_ms = chunk.start_ms + (seg_end * 1000.0).round() as i64;

            let mut seg_words: Vec<serde_json::Value> = Vec::new();
            while word_cursor < words.len() {
                let word = &words[word_cursor];
                let word_start = word.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let word_end = word.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let word_midpoint = (word_start + word_end) / 2.0;
                if word_midpoint < seg_start {
                    word_cursor += 1;
                    continue;
                }
                if word_midpoint >= seg_end {
                    break;
                }
                seg_words.push(serde_json::json!({
                    "word": word.get("word").and_then(|v| v.as_str()).unwrap_or(""),
                    "start_ms": chunk.start_ms + (word_start * 1000.0).round() as i64,
                    "end_ms": chunk.start_ms + (word_end * 1000.0).round() as i64,
                }));
                word_cursor += 1;
            }
            let words_json = if seg_words.is_empty() {
                None
            } else {
                Some(serde_json::to_string(&seg_words).unwrap_or_default())
            };

            persisted_chunk.push((start_ms, end_ms, seg_text, words_json));
        }

        // Commit a Groq chunk atomically. Resume skips chunks before the last
        // persisted timestamp, which is only safe when a crash cannot leave
        // half of a chunk committed.
        let mut tx = repo.pool().begin().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to begin Groq chunk checkpoint: {}", e))
        })?;
        for (start_ms, end_ms, seg_text, words_json) in persisted_chunk {
            sqlx::query("INSERT OR IGNORE INTO transcript_segments (transcript_id, start_ms, end_ms, text, confidence, words_json) VALUES (?, ?, ?, ?, ?, ?)")
                .bind(transcript_id)
                .bind(start_ms)
                .bind(end_ms)
                .bind(&seg_text)
                .bind(1.0)
                .bind(words_json.as_deref())
                .execute(&mut *tx)
                .await
                .map_err(|e| PlethoraError::Internal(format!("Failed to checkpoint Groq chunk: {}", e)))?;
        }
        tx.commit().await.map_err(|e| {
            PlethoraError::Internal(format!("Failed to commit Groq chunk checkpoint: {}", e))
        })?;

        if i < chunks.len() - 1 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }

    // 5. The cleanup guard also covers every early-return error path.

    // 6. Write the combined full text to documents.content (AI assistant / book
    //    sync) and mark the transcript row completed.
    let all_segments: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT start_ms, end_ms, text FROM transcript_segments WHERE transcript_id = ? ORDER BY start_ms, id",
    )
    .bind(transcript_id)
    .fetch_all(repo.pool())
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to assemble resumed transcript: {}", e)))?;
    let full_text = all_segments
        .iter()
        .map(|(_, _, text)| text.trim())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if !full_text.is_empty() {
        let _ = sqlx::query("UPDATE documents SET content = ? WHERE id = ?")
            .bind(&full_text)
            .bind(&document_id)
            .execute(repo.pool())
            .await;
    }
    let _ = sqlx::query(
        "UPDATE transcripts SET status = 'completed' WHERE book_id = ? AND chapter_id = ?",
    )
    .bind(&document_id)
    .bind(&document_id)
    .execute(repo.pool())
    .await;

    let _ = app_handle.emit(
        "audiobook://transcription-complete",
        serde_json::json!({ "documentId": &document_id, "segmentCount": all_segments.len() }),
    );
    eprintln!(
        "[audiobook-transcribe] groq: DONE, {} segments for document {}",
        all_segments.len(),
        document_id
    );
    Ok(all_segments.len() as i64)
}

// ---------------------------------------------------------------------------
// On-device transcription (Android STT plugin, design.md D2)
// ---------------------------------------------------------------------------

/// Bridge to the Android STT plugin. Sync because `run_mobile_plugin` parks
/// the calling thread until Kotlin resolves the Invoke. Faked in tests.
pub trait OnDeviceSttBridge: Send + Sync {
    fn start_job(&self, request: serde_json::Value) -> std::result::Result<serde_json::Value, String>;
    fn job_status(&self, request: serde_json::Value) -> std::result::Result<serde_json::Value, String>;
    fn cancel_job(&self, request: serde_json::Value) -> std::result::Result<serde_json::Value, String>;
}

/// Running on-device jobs keyed by document id → plugin job id, so the UI can
/// cancel an in-flight job (same shape as PodcastTranscriptionTokens).
pub type OnDeviceSttJobs = Arc<Mutex<HashMap<String, String>>>;

#[cfg(target_os = "android")]
pub struct PluginSttBridge(pub plethora_android_stt::Native);

#[cfg(target_os = "android")]
impl OnDeviceSttBridge for PluginSttBridge {
    fn start_job(&self, request: serde_json::Value) -> std::result::Result<serde_json::Value, String> {
        self.0.invoke("sttStartJob", request).map_err(|e| e.to_string())
    }
    fn job_status(&self, request: serde_json::Value) -> std::result::Result<serde_json::Value, String> {
        self.0.invoke("sttJobStatus", request).map_err(|e| e.to_string())
    }
    fn cancel_job(&self, request: serde_json::Value) -> std::result::Result<serde_json::Value, String> {
        self.0.invoke("sttCancelJob", request).map_err(|e| e.to_string())
    }
}

/// Persisted-segment row returned by the plugin (absolute stream ms).
struct OnDeviceSegment {
    start_ms: i64,
    end_ms: i64,
    text: String,
    words_json: Option<String>,
}

fn parse_plugin_segments(payload: &serde_json::Value) -> Vec<OnDeviceSegment> {
    let mut out = Vec::new();
    let Some(segments) = payload.get("segments").and_then(|v| v.as_array()) else {
        return out;
    };
    for seg in segments {
        let start_ms = seg.get("startMs").and_then(|v| v.as_i64()).unwrap_or(0);
        let end_ms = seg.get("endMs").and_then(|v| v.as_i64()).unwrap_or(0);
        let text = seg.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if text.is_empty() || end_ms <= start_ms {
            continue;
        }
        let words_json = seg
            .get("words")
            .filter(|w| w.is_array())
            .and_then(|w| serde_json::to_string(w).ok());
        out.push(OnDeviceSegment { start_ms, end_ms, text, words_json });
    }
    out
}

/// Testable core of `transcribe_audio_file_on_device`: start the plugin job,
/// poll `sttJobStatus`, persist segments incrementally with a checkpoint after
/// every poll, and mirror the Groq command's contract on completion/failure
/// (existing segments always survive; combined text is assembled from the DB).
#[allow(clippy::too_many_arguments)]
async fn run_on_device_transcription_inner(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    jobs: Option<&OnDeviceSttJobs>,
    document_id: &str,
    file_path: &str,
    language: Option<&str>,
    model_id: Option<&str>,
    pacing: Option<&str>,
    title: Option<&str>,
    bridge: Arc<dyn OnDeviceSttBridge>,
    poll_interval: Duration,
    emit: &(dyn Fn(&str, serde_json::Value) + Send + Sync),
) -> Result<i64> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(PlethoraError::NotFound(format!("Audio file not found: {}", file_path)));
    }
    emit(
        "audiobook://transcription-progress",
        serde_json::json!({ "documentId": document_id, "status": "processing", "progress": 5, "message": "Preparing on-device transcription…" }),
    );

    // Mark processing without replacing the row: existing segments are
    // checkpoints from an interrupted run and must survive (Groq contract).
    sqlx::query("INSERT INTO transcripts (book_id, chapter_id, model_used, language, status) VALUES (?, ?, 'android-ondevice', ?, 'processing') ON CONFLICT(book_id, chapter_id) DO UPDATE SET model_used = 'android-ondevice', language = excluded.language, status = 'processing', error_message = NULL, updated_at = CURRENT_TIMESTAMP")
        .bind(document_id)
        .bind(document_id)
        .bind(language.unwrap_or("en"))
        .execute(pool)
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to mark transcript processing: {}", e)))?;
    let transcript_id: i64 =
        sqlx::query_scalar("SELECT id FROM transcripts WHERE book_id = ? AND chapter_id = ?")
            .bind(document_id)
            .bind(document_id)
            .fetch_one(pool)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Failed to fetch transcript id: {}", e)))?;

    // Resume state: the decode offset the last run checkpointed.
    let checkpoint: Option<(String, i64, i64)> = sqlx::query_as(
        "SELECT model_id, decode_offset_ms, segment_cursor FROM transcription_checkpoints WHERE document_id = ?",
    )
    .bind(document_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to read transcription checkpoint: {}", e)))?;
    let resume_from_ms = checkpoint.as_ref().map(|(_, offset, _)| *offset).unwrap_or(0).max(0);

    emit(
        "audiobook://transcription-progress",
        serde_json::json!({ "documentId": document_id, "status": "processing", "progress": 10, "message": "Starting on-device engine…" }),
    );

    let job_id = format!("stt-{}", uuid::Uuid::new_v4());
    // The foreground-service notification shows the document title; look it
    // up when the caller did not pass one.
    let notification_title = match title {
        Some(t) if !t.trim().is_empty() => t.to_string(),
        _ => sqlx::query_scalar::<_, String>("SELECT title FROM documents WHERE id = ?")
            .bind(document_id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| "Transcription".to_string()),
    };
    let start_request = serde_json::json!({
        "jobId": job_id,
        "sourcePath": file_path,
        "title": notification_title,
        "language": language,
        "modelId": model_id.unwrap_or(""),
        "pacing": pacing.unwrap_or("capped"),
        "resumeFromMs": resume_from_ms,
    });
    let start_bridge = Arc::clone(&bridge);
    let start_result = tokio::task::spawn_blocking(move || start_bridge.start_job(start_request))
        .await
        .map_err(|e| PlethoraError::Internal(format!("STT start task failed: {}", e)))?
        .map_err(|e| PlethoraError::Internal(format!("On-device STT failed to start: {}", e)))?;
    let resolved_model = start_result
        .get("modelId")
        .and_then(|v| v.as_str())
        .unwrap_or("android-ondevice")
        .to_string();
    if let Some(jobs) = jobs {
        jobs.lock().unwrap().insert(document_id.to_string(), job_id.clone());
    }

    // Poll until a terminal state, persisting each batch of segments and the
    // decode-position checkpoint as they arrive.
    let mut cursor: i64 = 0;
    let final_state: Result<i64> = loop {
        tokio::time::sleep(poll_interval).await;
        let status_bridge = Arc::clone(&bridge);
        let status_request = serde_json::json!({ "jobId": job_id, "cursor": cursor });
        let status = match tokio::task::spawn_blocking(move || status_bridge.job_status(status_request))
            .await
        {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                break Err(PlethoraError::Internal(format!("On-device STT status failed: {}", e)))
            }
            Err(e) => break Err(PlethoraError::Internal(format!("STT status task failed: {}", e))),
        };
        let state = status.get("status").and_then(|v| v.as_str()).unwrap_or("failed").to_string();
        let progress_raw = status.get("progress").and_then(|v| v.as_i64()).unwrap_or(0);
        let decode_offset_ms = status.get("decodeOffsetMs").and_then(|v| v.as_i64()).unwrap_or(0);

        // Persist completed segments incrementally.
        let segments = parse_plugin_segments(&status);
        if !segments.is_empty() {
            let mut tx = pool
                .begin()
                .await
                .map_err(|e| PlethoraError::Internal(format!("Failed to begin STT checkpoint: {}", e)))?;
            for seg in &segments {
                sqlx::query("INSERT OR IGNORE INTO transcript_segments (transcript_id, start_ms, end_ms, text, confidence, words_json) VALUES (?, ?, ?, ?, 1.0, ?)")
                    .bind(transcript_id)
                    .bind(seg.start_ms)
                    .bind(seg.end_ms)
                    .bind(&seg.text)
                    .bind(seg.words_json.as_deref())
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| PlethoraError::Internal(format!("Failed to checkpoint STT segments: {}", e)))?;
            }
            tx.commit()
                .await
                .map_err(|e| PlethoraError::Internal(format!("Failed to commit STT checkpoint: {}", e)))?;
        }
        cursor = status.get("nextCursor").and_then(|v| v.as_i64()).unwrap_or(cursor);

        // Checkpoint the decode position after the segments are durable.
        let _ = sqlx::query(
            "INSERT INTO transcription_checkpoints (document_id, model_id, decode_offset_ms, segment_cursor, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(document_id) DO UPDATE SET model_id = excluded.model_id, decode_offset_ms = excluded.decode_offset_ms, segment_cursor = excluded.segment_cursor, updated_at = excluded.updated_at",
        )
        .bind(document_id)
        .bind(&resolved_model)
        .bind(decode_offset_ms)
        .bind(cursor)
        .execute(pool)
        .await;

        let progress = 15 + ((progress_raw.clamp(0, 100) as f64) * 0.70) as i64;
        emit(
            "audiobook://transcription-progress",
            serde_json::json!({ "documentId": document_id, "status": "processing", "progress": progress, "message": format!("Transcribing on device… {}%", progress_raw) }),
        );

        match state.as_str() {
            "running" => continue,
            "completed" => break Ok(0),
            "cancelled" => {
                // Spec: cancelled jobs keep every completed segment and the
                // transcript row is marked cancelled (resumable on retry).
                let _ = sqlx::query(
                    "UPDATE transcripts SET status = 'cancelled', error_message = 'Cancelled' WHERE book_id = ? AND chapter_id = ?",
                )
                .bind(document_id)
                .bind(document_id)
                .execute(pool)
                .await;
                break Err(PlethoraError::Internal("transcription_cancelled".to_string()));
            }
            failed => {
                let kind = status.get("errorKind").and_then(|v| v.as_str()).unwrap_or("inference_failed");
                let message = status.get("error").and_then(|v| v.as_str()).unwrap_or("on-device transcription failed");
                if kind == "service_timeout" {
                    // Graceful FGS-timeout stop (design.md D6): leave the
                    // transcript processing with the checkpoint intact so a
                    // retry resumes from where decoding stopped.
                    break Err(PlethoraError::Internal(format!(
                        "On-device transcription was interrupted by the system service timeout; progress is saved and will resume on retry ({})",
                        message
                    )));
                }
                let hard_fail = kind == "codec_unsupported" || kind == "drm_protected";
                let _ = sqlx::query(
                    "UPDATE transcripts SET status = 'failed', error_message = ? WHERE book_id = ? AND chapter_id = ?",
                )
                .bind(format!("{}: {}", kind, message))
                .bind(document_id)
                .bind(document_id)
                .execute(pool)
                .await;
                if hard_fail {
                    // Undecodable input never gets further; drop the checkpoint
                    // so a retry starts clean instead of re-seeking into it.
                    let _ = sqlx::query("DELETE FROM transcription_checkpoints WHERE document_id = ?")
                        .bind(document_id)
                        .execute(pool)
                        .await;
                }
                break Err(PlethoraError::Internal(format!(
                    "On-device transcription failed ({}): {}",
                    kind, message
                )));
            }
        }
    };

    if let Some(jobs) = jobs {
        jobs.lock().unwrap().remove(document_id);
    }

    final_state?;

    // Combined full text is assembled from ALL persisted segments (including
    // prior interrupted runs), then the transcript is completed.
    let all_segments: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT start_ms, end_ms, text FROM transcript_segments WHERE transcript_id = ? ORDER BY start_ms, id",
    )
    .bind(transcript_id)
    .fetch_all(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to assemble on-device transcript: {}", e)))?;
    let full_text = all_segments
        .iter()
        .map(|(_, _, text)| text.trim())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if !full_text.is_empty() {
        let _ = sqlx::query("UPDATE documents SET content = ? WHERE id = ?")
            .bind(&full_text)
            .bind(document_id)
            .execute(pool)
            .await;
    }
    let _ = sqlx::query(
        "UPDATE transcripts SET status = 'completed' WHERE book_id = ? AND chapter_id = ?",
    )
    .bind(document_id)
    .bind(document_id)
    .execute(pool)
    .await;
    let _ = sqlx::query("DELETE FROM transcription_checkpoints WHERE document_id = ?")
        .bind(document_id)
        .execute(pool)
        .await;

    emit(
        "audiobook://transcription-complete",
        serde_json::json!({ "documentId": document_id, "segmentCount": all_segments.len() }),
    );
    eprintln!(
        "[audiobook-transcribe] on-device: DONE, {} segments for document {}",
        all_segments.len(),
        document_id
    );
    Ok(all_segments.len() as i64)
}

/// Transcribe an imported audiobook audio file entirely on device (Android
/// sherpa-onnx engine). Mirrors `transcribe_audio_file_groq`: emits
/// `audiobook://transcription-progress` keyed by documentId, persists timed
/// segments incrementally with a checkpoint per poll, writes the combined
/// text to `documents.content` on completion, and resumes interrupted runs
/// from the checkpoint. Non-Android platforms reject with
/// `platform_unsupported` (the Groq path stays the default there).
#[tauri::command]
pub async fn transcribe_audio_file_on_device(
    app_handle: AppHandle,
    repo: State<'_, Repository>,
    jobs: State<'_, OnDeviceSttJobs>,
    document_id: String,
    file_path: String,
    language: Option<String>,
    model_id: Option<String>,
    pacing: Option<String>,
    title: Option<String>,
) -> Result<i64> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app_handle, &repo, &jobs, &document_id, &file_path, &language, &model_id, &pacing, &title);
        return Err(PlethoraError::Internal(
            "platform_unsupported: on-device transcription is Android-only".to_string(),
        ));
    }
    #[cfg(target_os = "android")]
    {
        let native = app_handle
            .state::<plethora_android_stt::Native>()
            .inner()
            .clone();
        let bridge: Arc<dyn OnDeviceSttBridge> = Arc::new(PluginSttBridge(native));
        let emitter = app_handle.clone();
        run_on_device_transcription_inner(
            repo.pool(),
            Some(&jobs),
            &document_id,
            &file_path,
            language.as_deref(),
            model_id.as_deref(),
            pacing.as_deref(),
            title.as_deref(),
            bridge,
            Duration::from_secs(1),
            &move |event, payload| {
                let _ = emitter.emit(event, payload);
            },
        )
        .await
    }
}

/// Cancel the running on-device transcription job for a document. The plugin
/// stops promptly and every completed segment is preserved.
#[tauri::command]
pub async fn cancel_on_device_transcription(
    app_handle: AppHandle,
    jobs: State<'_, OnDeviceSttJobs>,
    document_id: String,
) -> Result<bool> {
    let job_id = jobs.lock().unwrap().get(&document_id).cloned();
    let Some(job_id) = job_id else {
        return Ok(false);
    };
    #[cfg(not(target_os = "android"))]
    {
        let _ = &app_handle;
        return Err(PlethoraError::Internal(
            "platform_unsupported: on-device transcription is Android-only".to_string(),
        ));
    }
    #[cfg(target_os = "android")]
    {
        let native = app_handle
            .state::<plethora_android_stt::Native>()
            .inner()
            .clone();
        let request = serde_json::json!({ "jobId": job_id });
        let _ = tokio::task::spawn_blocking(move || PluginSttBridge(native).cancel_job(request))
            .await
            .map_err(|e| PlethoraError::Internal(format!("STT cancel task failed: {}", e)))?
            .map_err(|e| PlethoraError::Internal(format!("On-device STT cancel failed: {}", e)))?;
        Ok(true)
    }
}

/// Persist per-segment (and optional per-word) timings produced by Groq cloud
/// transcription. Used by the mobile/Groq transcription path, which runs the
/// transcription in the frontend (plain HTTP) and sends the results here for
/// storage — Groq fetches the audio URL directly, so no FFmpeg/sidecar needed.
/// Also stores the concatenated full text on the episode row for search/back-compat.
#[tauri::command]
pub async fn save_podcast_transcript_segments(
    episode_id: String,
    segments: Vec<SaveSegmentInput>,
    repo: State<'_, Repository>,
) -> Result<()> {
    if segments.is_empty() {
        return Ok(());
    }
    eprintln!(
        "[podcast-transcribe] save_podcast_transcript_segments: {} segments for episode {}",
        segments.len(),
        episode_id
    );
    let full_text = segments
        .iter()
        .map(|s| s.text.trim())
        .collect::<Vec<&str>>()
        .join(" ");

    // Store the text blob (back-compat / search) + mark status done.
    repo.update_episode_transcript_status(&episode_id, "done", None, Some(&full_text))
        .await?;

    // Persist real per-segment timings + per-word timings.
    let seg_models: Vec<TranscriptSegment> = segments
        .iter()
        .map(|s| TranscriptSegment {
            start_ms: s.start_ms,
            end_ms: s.end_ms,
            text: s.text.clone(),
            confidence: 1.0,
            words_json: s.word_timings_json.clone(),
        })
        .collect();
    let word_timings: Vec<Option<String>> = segments
        .iter()
        .map(|s| s.word_timings_json.clone())
        .collect();
    repo.save_podcast_transcript_segments(&episode_id, &seg_models, &word_timings)
        .await?;
    eprintln!(
        "[podcast-transcribe] save_podcast_transcript_segments: SAVED OK for episode {}",
        episode_id
    );
    Ok(())
}

#[tauri::command]
pub async fn cancel_podcast_transcription(
    episode_id: String,
    tokens: State<'_, PodcastTranscriptionTokens>,
) -> Result<()> {
    let map = tokens.lock().expect("podcast tokens mutex poisoned");
    if let Some(token) = map.get(&episode_id) {
        token.store(true, Ordering::Relaxed);
        Ok(())
    } else {
        Err(PlethoraError::NotFound(format!(
            "No active transcription for episode {}",
            episode_id
        )))
    }
}

/// Import a podcast episode as a document in the incremental reading system
#[tauri::command]
pub async fn import_podcast_episode_as_document(
    episode_id: String,
    collection_id: Option<String>,
    app_handle: AppHandle,
    repo: State<'_, Repository>,
) -> Result<Document> {
    let episode = repo
        .get_podcast_episode_by_id(&episode_id)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Podcast episode {}", episode_id)))?;
    import_episode_as_document_inner(&app_handle, &repo, &episode, collection_id).await
}

/// Shared import logic: create (or return an existing) Document for a podcast
/// episode so it appears in the reading queue (the FSRS queue admits documents
/// with next_reading_date <= now; we set it to now + priority 8). Idempotent —
/// if a Document already exists for the episode's audio_url or local download
/// path, it's returned as-is. Used by both the manual "Add to Reading Queue"
/// command AND auto-import on download completion (so downloaded episodes land
/// in the queue without the user having to add them manually).
async fn import_episode_as_document_inner(
    app_handle: &AppHandle,
    repo: &Repository,
    episode: &crate::models::podcast::PodcastEpisode,
    collection_id: Option<String>,
) -> Result<Document> {
    // Check if already imported (by remote URL or local download path).
    let local_path_str =
        find_existing_download(app_handle, &episode.id).map(|p| p.to_string_lossy().to_string());

    if let Some(existing) = repo.find_document_by_url(&episode.audio_url).await? {
        return Ok(existing);
    }
    if let Some(ref local_path) = local_path_str {
        if let Some(existing) = repo.find_document_by_url(local_path).await? {
            return Ok(existing);
        }
    }

    // Create a new Document record, due immediately at high priority.
    let file_path = local_path_str.unwrap_or_else(|| episode.audio_url.clone());
    let mut doc = Document::with_collection(
        episode.title.clone(),
        file_path,
        FileType::Audio,
        collection_id,
    );
    doc.date_added = Utc::now();
    doc.date_modified = Utc::now();
    doc.next_reading_date = Some(Utc::now()); // Make it due immediately
    doc.priority_rating = 8; // High priority for new items
    doc.tags = vec!["podcast".to_string()];
    // Stash the episode id in metadata.source so the viewer can recover it and
    // load the podcast transcript (keyed by episode id) even when the document
    // is rendered via DocumentViewer (which otherwise wouldn't pass episodeId).
    doc.metadata = Some(crate::models::document::DocumentMetadata {
        source: Some(format!("podcast:{}", episode.id)),
        ..Default::default()
    });

    if let Some(image_url) = &episode.image_url {
        doc.cover_image_url = Some(image_url.clone());
        doc.cover_image_source = Some("podcast".to_string());
    }

    let created = repo.create_document(&doc).await?;
    Ok(created)
}

/// Set auto-transcribe settings for a podcast feed
#[tauri::command]
pub async fn set_feed_auto_transcribe(
    feed_id: String,
    enabled: bool,
    language: Option<String>,
    repo: State<'_, Repository>,
) -> Result<()> {
    repo.set_feed_auto_transcribe(&feed_id, enabled, language.as_deref())
        .await
}

fn podcast_audio_dir(app_handle: &AppHandle) -> std::result::Result<PathBuf, PlethoraError> {
    // Use the Tauri-resolved app data dir, which is the app's private writable
    // storage on every platform (on Android this is /data/data/<pkg>/files via
    // app_data_dir; dirs::data_dir() instead resolves to a READ-ONLY system path
    // on Android and fails with "Read-only file system" when creating the dir).
    let base = app_handle.path().app_data_dir().map_err(|e| {
        PlethoraError::Internal(format!("Failed to resolve app_data_dir: {}", e))
    })?;
    let dir = base.join("podcast-audio");
    std::fs::create_dir_all(&dir).map_err(|e| {
        PlethoraError::Internal(format!("Failed to create podcast-audio dir: {}", e))
    })?;
    Ok(dir)
}

/// Resolve the podcast-audio directory for a NotebookLM audio import, so the
/// imported episode file is discoverable by the existing duration backfill
/// (`get_downloaded_episode_path` scans `podcast-audio` for `<episodeId>.*`).
pub fn podcast_audio_dir_public(app_handle: &AppHandle) -> std::result::Result<PathBuf, String> {
    podcast_audio_dir(app_handle).map_err(|e| e.to_string())
}

/// Find existing downloaded file for an episode (checks common extensions)
fn find_existing_download(app_handle: &AppHandle, episode_id: &str) -> Option<PathBuf> {
    let dir = podcast_audio_dir(app_handle).ok()?;
    for entry in std::fs::read_dir(&dir).ok()? {
        let entry = entry.ok()?;
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with(&format!("{}.", episode_id)) {
            return Some(entry.path());
        }
    }
    None
}

/// Download a podcast episode audio file for local playback
#[tauri::command]
pub async fn download_podcast_episode(
    episode_id: String,
    audio_url: String,
    audio_type: Option<String>,
    app_handle: AppHandle,
) -> Result<String> {
    if let Some(existing) = find_existing_download(&app_handle, &episode_id) {
        return Ok(existing.to_string_lossy().to_string());
    }

    let audio_dir = podcast_audio_dir(&app_handle)?;
    let ext = audio_type
        .as_deref()
        .and_then(|t| t.split('/').last())
        .unwrap_or("mp3");
    let dest_path = audio_dir.join(format!("{}.{}", episode_id, ext));
    let temp_path = dest_path.with_extension("downloading");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| PlethoraError::Internal(format!("HTTP client error: {}", e)))?;

    let response = client
        .get(&audio_url)
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Download failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(PlethoraError::Internal(format!(
            "Download failed: HTTP {}",
            response.status()
        )));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut file = tokio::fs::File::create(&temp_path).await.map_err(|e| {
        PlethoraError::Internal(format!("Failed to create temporary download file: {}", e))
    })?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|e| PlethoraError::Internal(format!("Download error: {}", e)))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| PlethoraError::Internal(format!("Write error: {}", e)))?;
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let progress = ((downloaded as f64 / total_size as f64) * 100.0) as u32;
            let _ = app_handle.emit(
                "podcast://download-progress",
                serde_json::json!({ "episodeId": &episode_id, "progress": progress }),
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Flush error: {}", e)))?;

    // Download complete, now handle SponsorBlock skipping
    let repo = app_handle.state::<Repository>();
    let mut video_id = crate::youtube::extract_video_id(&audio_url);
    if video_id.is_none() {
        if let Ok(Some(episode)) = repo.get_podcast_episode_by_id(&episode_id).await {
            if let Some(ref link) = episode.link {
                video_id = crate::youtube::extract_video_id(link);
            }
        }
    }

    let mut cut_applied = false;
    if let Some(ref vid) = video_id {
        println!("[SponsorBlock] Checking segments for video ID: {}", vid);
        if let Ok(segments) = crate::sponsorblock::fetch_sponsorblock_segments(vid).await {
            if !segments.is_empty() {
                println!(
                    "[SponsorBlock] Found {} skippable segments. Cutting using ffmpeg...",
                    segments.len()
                );
                let _ = app_handle.emit(
                    "podcast://download-progress",
                    serde_json::json!({ "episodeId": &episode_id, "progress": 100, "status": "cutting" }),
                );

                match crate::sponsorblock::cut_audio_file(
                    &app_handle,
                    &temp_path,
                    &dest_path,
                    &segments,
                )
                .await
                {
                    Ok(cuts) => {
                        println!(
                            "[SponsorBlock] Cutting successful. Saved {} cuts metadata.",
                            cuts.len()
                        );
                        let _ = crate::sponsorblock::save_cuts_metadata(&episode_id, &cuts);
                        let _ = std::fs::remove_file(&temp_path);
                        cut_applied = true;
                    }
                    Err(e) => {
                        eprintln!(
                            "[SponsorBlock] Cutting failed: {}. Falling back to uncut download.",
                            e
                        );
                    }
                }
            } else {
                println!("[SponsorBlock] No skippable segments found.");
            }
        } else {
            eprintln!("[SponsorBlock] Failed to fetch SponsorBlock segments.");
        }
    }

    if !cut_applied {
        // No cuts applied, rename raw downloaded file to dest path
        std::fs::rename(&temp_path, &dest_path).map_err(|e| {
            PlethoraError::Internal(format!("Failed to save final download file: {}", e))
        })?;
    }

    // Update matching imported document with local download path
    if let Ok(Some(mut doc)) = repo.find_document_by_url(&audio_url).await {
        doc.file_path = dest_path.to_string_lossy().to_string();
        doc.date_modified = Utc::now();
        let _ = repo.update_document(&doc.id, &doc).await;
    }

    // Auto-import the episode as a Document so it appears in the reading queue.
    // Downloaded episodes should flow into the user's review queue without a
    // manual "Add to Reading Queue" step. import_episode_as_document_inner is
    // idempotent (returns the existing doc if already imported), so this is safe
    // on re-downloads. The created doc is due immediately (next_reading_date=now,
    // priority 8), so it surfaces at the top of the FSRS queue.
    if let Ok(Some(episode)) = repo.get_podcast_episode_by_id(&episode_id).await {
        let _ = import_episode_as_document_inner(&app_handle, &repo, &episode, None).await;
    }

    let _ = app_handle.emit(
        "podcast://download-complete",
        serde_json::json!({ "episodeId": &episode_id, "path": dest_path.to_string_lossy() }),
    );

    Ok(dest_path.to_string_lossy().to_string())
}

/// Get the local file path for a downloaded episode (null if not downloaded)
#[tauri::command]
pub async fn get_downloaded_episode_path(
    episode_id: String,
    app_handle: AppHandle,
) -> Result<Option<String>> {
    Ok(find_existing_download(&app_handle, &episode_id).map(|p| p.to_string_lossy().to_string()))
}

/// Delete a downloaded episode audio file
#[tauri::command]
pub async fn delete_downloaded_episode(episode_id: String, app_handle: AppHandle) -> Result<()> {
    if let Some(path) = find_existing_download(&app_handle, &episode_id) {
        std::fs::remove_file(&path)
            .map_err(|e| PlethoraError::Internal(format!("Failed to delete: {}", e)))?;
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ITunesPodcastResult {
    pub collection_name: String,
    pub feed_url: Option<String>,
    pub artist_name: Option<String>,
    pub artwork_url600: Option<String>,
    pub artwork_url100: Option<String>,
    pub track_view_url: Option<String>,
    pub track_count: Option<i64>,
    pub primary_genre_name: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ITunesSearchResponse {
    pub results: Vec<ITunesPodcastResult>,
}

/// Search for podcasts via iTunes Search API (completely keyless and highly reliable)
#[tauri::command]
pub async fn search_podcasts(query: String) -> Result<Vec<PodcastSearchResult>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| PlethoraError::Internal(format!("Failed to build HTTP client: {}", e)))?;

    let response = client
        .get("https://itunes.apple.com/search")
        .query(&[("media", "podcast"), ("term", q)])
        .send()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Search request failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(PlethoraError::Internal(format!(
            "Search API returned HTTP {}",
            response.status()
        )));
    }

    let data: ITunesSearchResponse = response.json().await.map_err(|e| {
        PlethoraError::Internal(format!("Failed to parse search response: {}", e))
    })?;

    let results = data
        .results
        .into_iter()
        .filter_map(|r| {
            let feed_url = r.feed_url?;
            Some(PodcastSearchResult {
                title: r.collection_name,
                url: feed_url,
                author: r.artist_name,
                description: r.primary_genre_name.clone(),
                image_url: r.artwork_url600.or(r.artwork_url100),
                link: r.track_view_url,
                episode_count: r.track_count,
                categories: r.primary_genre_name.map(|genre| {
                    let mut hm = std::collections::HashMap::new();
                    hm.insert("0".to_string(), genre);
                    hm
                }),
            })
        })
        .collect();

    Ok(results)
}

/// Save a podcast transcript from the frontend
#[tauri::command]
pub async fn save_podcast_transcript(
    episode_id: String,
    status: String,
    error: Option<String>,
    transcript: Option<String>,
    repo: State<'_, Repository>,
) -> Result<()> {
    repo.update_episode_transcript_status(
        &episode_id,
        &status,
        error.as_deref(),
        transcript.as_deref(),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod on_device_tests {
    use super::*;
    use crate::database::Database;
    use std::sync::Mutex;

    /// Scripted bridge: start requests are captured; each job_status call
    /// consumes the next scripted response.
    struct MockSttBridge {
        statuses: Mutex<Vec<serde_json::Value>>,
        started: Mutex<Vec<serde_json::Value>>,
    }

    impl OnDeviceSttBridge for MockSttBridge {
        fn start_job(&self, request: serde_json::Value) -> std::result::Result<serde_json::Value, String> {
            self.started.lock().unwrap().push(request);
            Ok(serde_json::json!({ "jobId": "job-1", "modelId": "sense-voice-multi-int8" }))
        }
        fn job_status(&self, _request: serde_json::Value) -> std::result::Result<serde_json::Value, String> {
            self.statuses
                .lock()
                .unwrap()
                .pop()
                .map(Ok::<_, String>)
                .unwrap_or_else(|| Ok(serde_json::json!({ "status": "completed", "progress": 100 })))
        }
        fn cancel_job(&self, _request: serde_json::Value) -> std::result::Result<serde_json::Value, String> {
            Ok(serde_json::json!({ "cancelled": true }))
        }
    }

    async fn test_setup() -> (sqlx::Pool<sqlx::Sqlite>, String, String) {
        let db = Database::new(PathBuf::from(":memory:")).await.expect("db");
        db.migrate().await.expect("migrate");
        let repo = Repository::new(db.pool().clone());
        let doc = repo
            .create_document(&Document::new(
                "Book".to_string(),
                "/tmp/book.m4b".to_string(),
                FileType::Audio,
            ))
            .await
            .expect("doc");
        let audio = std::env::temp_dir().join(format!("stt-test-{}.m4b", doc.id));
        std::fs::write(&audio, b"fake audio").expect("write audio");
        (db.pool().clone(), doc.id, audio.to_string_lossy().to_string())
    }

    fn running_with_segments(segments: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "status": "running", "progress": 40, "decodeOffsetMs": 1200, "nextCursor": 2, "segments": segments })
    }

    /// Terminal completed snapshot with one more segment.
    fn completed_with_segments(next_cursor: i64, segments: serde_json::Value) -> serde_json::Value {
        serde_json::json!({ "status": "completed", "progress": 100, "decodeOffsetMs": 3000, "nextCursor": next_cursor, "segments": segments })
    }

    fn segments_payload() -> serde_json::Value {
        serde_json::json!([
            { "index": 0, "startMs": 0, "endMs": 900, "text": "Hello", "words": [ { "w": "Hello", "t": 0 } ] },
            { "index": 1, "startMs": 1000, "endMs": 1900, "text": "world" },
        ])
    }

    async fn run(
        pool: &sqlx::Pool<sqlx::Sqlite>,
        document_id: &str,
        audio_path: &str,
        bridge: Arc<dyn OnDeviceSttBridge>,
    ) -> (Result<i64>, Vec<(String, serde_json::Value)>) {
        let events: Arc<Mutex<Vec<(String, serde_json::Value)>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        let result = run_on_device_transcription_inner(
            pool,
            None,
            document_id,
            audio_path,
            Some("en"),
            None,
            Some("capped"),
            Some("Book"),
            bridge,
            Duration::from_millis(1),
            &move |event, payload| {
                sink.lock().unwrap().push((event.to_string(), payload));
            },
        )
        .await;
        let events = events.lock().unwrap().clone();
        (result, events)
    }

    #[tokio::test]
    async fn completes_persists_segments_writes_content_and_clears_checkpoint() {
        let (pool, doc_id, audio) = test_setup().await;
        let bridge = Arc::new(MockSttBridge {
            // job_status consumes these like a stack: running first, then
            // the terminal completed snapshot.
            statuses: Mutex::new(vec![
                completed_with_segments(3, serde_json::json!([
                    { "index": 2, "startMs": 2000, "endMs": 2900, "text": "and goodbye" }
                ])),
                running_with_segments(segments_payload()),
            ]),
            started: Mutex::new(Vec::new()),
        });
        let started_ref = Arc::clone(&bridge);
        let (result, events) = run(&pool, &doc_id, &audio, bridge).await;
        assert_eq!(result.expect("ok"), 3);

        // The plugin job started with resume-from 0 and resolved a model.
        let started = started_ref.started.lock().unwrap();
        assert_eq!(started[0]["resumeFromMs"], 0);
        assert_eq!(started[0]["pacing"], "capped");
        drop(started);

        // Segments + word timings persisted in order.
        let rows: Vec<(i64, i64, String, Option<String>)> = sqlx::query_as(
            "SELECT start_ms, end_ms, text, words_json FROM transcript_segments ts \
             JOIN transcripts t ON t.id = ts.transcript_id \
             WHERE t.book_id = ? ORDER BY start_ms",
        )
        .bind(&doc_id)
        .fetch_all(&pool)
        .await
        .expect("segments");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].2, "Hello");
        assert!(rows[0].3.as_deref().unwrap().contains("Hello"));

        // Combined text lands on documents.content; status completed;
        // checkpoint cleared.
        let content: Option<String> =
            sqlx::query_scalar("SELECT content FROM documents WHERE id = ?")
                .bind(&doc_id)
                .fetch_one(&pool)
                .await
                .expect("content");
        assert_eq!(content.as_deref(), Some("Hello world and goodbye"));
        let status: String =
            sqlx::query_scalar("SELECT status FROM transcripts WHERE book_id = ?")
                .bind(&doc_id)
                .fetch_one(&pool)
                .await
                .expect("status");
        assert_eq!(status, "completed");
        let checkpoint: Option<i64> =
            sqlx::query_scalar("SELECT decode_offset_ms FROM transcription_checkpoints WHERE document_id = ?")
                .bind(&doc_id)
                .fetch_optional(&pool)
                .await
                .expect("checkpoint");
        assert_eq!(checkpoint, None);

        // Groq-compatible event payloads on the shared channel.
        let progress_events: Vec<_> = events
            .iter()
            .filter(|(e, _)| e == "audiobook://transcription-progress")
            .collect();
        assert!(progress_events.len() >= 3);
        assert_eq!(progress_events[0].1["documentId"], doc_id);
        assert_eq!(progress_events[0].1["progress"], 5);
        assert_eq!(progress_events[0].1["status"], "processing");
        let complete: Vec<_> = events
            .iter()
            .filter(|(e, _)| e == "audiobook://transcription-complete")
            .collect();
        assert_eq!(complete.len(), 1);
        assert_eq!(complete[0].1["segmentCount"], 3);
        assert_eq!(complete[0].1["documentId"], doc_id);
    }

    #[tokio::test]
    async fn resumes_from_checkpoint_and_preserves_prior_segments() {
        let (pool, doc_id, audio) = test_setup().await;
        // Prior interrupted run: processing transcript with two segments and
        // a decode-position checkpoint.
        sqlx::query("INSERT INTO transcripts (book_id, chapter_id, model_used, language, status) VALUES (?, ?, 'android-ondevice', 'en', 'processing')")
            .bind(&doc_id)
            .bind(&doc_id)
            .execute(&pool)
            .await
            .expect("transcript");
        let transcript_id: i64 =
            sqlx::query_scalar("SELECT id FROM transcripts WHERE book_id = ?")
                .bind(&doc_id)
                .fetch_one(&pool)
                .await
                .expect("tid");
        for (start, end, text) in [(0, 900, "Hello"), (1000, 1900, "world")] {
            sqlx::query("INSERT INTO transcript_segments (transcript_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)")
                .bind(transcript_id)
                .bind(start)
                .bind(end)
                .bind(text)
                .execute(&pool)
                .await
                .expect("seg");
        }
        sqlx::query("INSERT INTO transcription_checkpoints (document_id, model_id, decode_offset_ms, segment_cursor, updated_at) VALUES (?, 'sense-voice-multi-int8', 12000, 2, CURRENT_TIMESTAMP)")
            .bind(&doc_id)
            .execute(&pool)
            .await
            .expect("checkpoint");

        let bridge = Arc::new(MockSttBridge {
            statuses: Mutex::new(vec![completed_with_segments(1, serde_json::json!([
                { "index": 0, "startMs": 12000, "endMs": 12800, "text": "Resumed text" }
            ]))]),
            started: Mutex::new(Vec::new()),
        });
        let started_ref = Arc::clone(&bridge);
        let (result, _) = run(&pool, &doc_id, &audio, bridge).await;
        assert_eq!(result.expect("ok"), 3);

        // The new job MUST resume from the checkpointed decode offset.
        assert_eq!(started_ref.started.lock().unwrap()[0]["resumeFromMs"], 12000);

        // Prior segments survived and the combined text includes them.
        let content: Option<String> =
            sqlx::query_scalar("SELECT content FROM documents WHERE id = ?")
                .bind(&doc_id)
                .fetch_one(&pool)
                .await
                .expect("content");
        assert_eq!(content.as_deref(), Some("Hello world Resumed text"));
    }

    #[tokio::test]
    async fn codec_failure_marks_failed_and_clears_checkpoint() {
        let (pool, doc_id, audio) = test_setup().await;
        let bridge = Arc::new(MockSttBridge {
            statuses: Mutex::new(vec![serde_json::json!({
                "status": "failed", "progress": 0, "decodeOffsetMs": 0, "nextCursor": 0,
                "segments": [], "errorKind": "codec_unsupported", "error": "no decoder for audio/exotic"
            })]),
            started: Mutex::new(Vec::new()),
        });
        let (result, _) = run(&pool, &doc_id, &audio, bridge).await;
        let err = result.expect_err("must fail");
        assert!(err.to_string().contains("codec_unsupported"));
        let (status, error): (String, Option<String>) =
            sqlx::query_as("SELECT status, error_message FROM transcripts WHERE book_id = ?")
                .bind(&doc_id)
                .fetch_one(&pool)
                .await
                .expect("status");
        assert_eq!(status, "failed");
        assert!(error.as_deref().unwrap().contains("codec_unsupported"));
        let checkpoint: Option<i64> =
            sqlx::query_scalar("SELECT decode_offset_ms FROM transcription_checkpoints WHERE document_id = ?")
                .bind(&doc_id)
                .fetch_optional(&pool)
                .await
                .expect("checkpoint");
        assert_eq!(checkpoint, None);
    }

    #[tokio::test]
    async fn service_timeout_keeps_processing_for_resume() {
        let (pool, doc_id, audio) = test_setup().await;
        let bridge = Arc::new(MockSttBridge {
            statuses: Mutex::new(vec![
                serde_json::json!({
                    "status": "failed", "progress": 50, "decodeOffsetMs": 5000, "nextCursor": 1,
                    "segments": [ { "index": 0, "startMs": 0, "endMs": 900, "text": "Half" } ],
                    "errorKind": "service_timeout", "error": "fgs timeout"
                }),
            ]),
            started: Mutex::new(Vec::new()),
        });
        let (result, _) = run(&pool, &doc_id, &audio, bridge).await;
        assert!(result.is_err());

        // Status stays processing (resumable), segments persisted, checkpoint kept.
        let status: String =
            sqlx::query_scalar("SELECT status FROM transcripts WHERE book_id = ?")
                .bind(&doc_id)
                .fetch_one(&pool)
                .await
                .expect("status");
        assert_eq!(status, "processing");
        let checkpoint: Option<i64> =
            sqlx::query_scalar("SELECT decode_offset_ms FROM transcription_checkpoints WHERE document_id = ?")
                .bind(&doc_id)
                .fetch_optional(&pool)
                .await
                .expect("checkpoint");
        assert_eq!(checkpoint, Some(5000));
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM transcript_segments ts JOIN transcripts t ON t.id = ts.transcript_id WHERE t.book_id = ?")
                .bind(&doc_id)
                .fetch_one(&pool)
                .await
                .expect("count");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn cancelled_marks_cancelled_and_keeps_segments() {
        let (pool, doc_id, audio) = test_setup().await;
        let bridge = Arc::new(MockSttBridge {
            statuses: Mutex::new(vec![serde_json::json!({
                "status": "cancelled", "progress": 30, "decodeOffsetMs": 3000, "nextCursor": 1,
                "segments": [ { "index": 0, "startMs": 0, "endMs": 900, "text": "Part" } ]
            })]),
            started: Mutex::new(Vec::new()),
        });
        let (result, _) = run(&pool, &doc_id, &audio, bridge).await;
        assert!(result.is_err());
        let (status, error): (String, Option<String>) =
            sqlx::query_as("SELECT status, error_message FROM transcripts WHERE book_id = ?")
                .bind(&doc_id)
                .fetch_one(&pool)
                .await
                .expect("status");
        assert_eq!(status, "cancelled");
        assert_eq!(error.as_deref(), Some("Cancelled"));
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM transcript_segments ts JOIN transcripts t ON t.id = ts.transcript_id WHERE t.book_id = ?")
                .bind(&doc_id)
                .fetch_one(&pool)
                .await
                .expect("count");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn missing_audio_file_rejects_not_found() {
        let (pool, doc_id, _) = test_setup().await;
        let bridge = Arc::new(MockSttBridge {
            statuses: Mutex::new(Vec::new()),
            started: Mutex::new(Vec::new()),
        });
        let (result, _) = run(&pool, &doc_id, "/nonexistent/audio.m4b", bridge).await;
        assert!(matches!(result, Err(PlethoraError::NotFound(_))));
    }
}
