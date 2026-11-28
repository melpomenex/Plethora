//! Multi-stage Podcast Ad Detection Orchestrator
//!
//! Coordinates chapter ingestion & classification, transcript cue detection,
//! word/silence boundary snapping, and interval merging/persistence.

use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::commands::podcast::{
    find_existing_download, run_transcription_job, PodcastTranscriptionTokens,
};
use crate::commands::transcription_config::read_transcription_config;
use crate::database::Repository;
use crate::error::{PlethoraError, Result};
use crate::mobile::scheduler::MobileScheduler;
use crate::models::{
    AdDetectionMethod, PodcastAdDetectionStatus, PodcastAdInterval, PodcastAdSettings,
    PodcastChapter, PodcastProcessingJob,
};
use crate::podcast::ad::boundary_refiner::{
    detect_silence_gaps_around_points, refine_boundary_with_window, SilenceGap,
};
use crate::podcast::ad::chapter_classifier::classify_chapter_metadata;
use crate::podcast::ad::cue_detector::detect_cue_spans;
use crate::podcast::ad::interval_merger::merge_and_filter_intervals;
use crate::podcast::chapter_service::{
    resolve_and_persist_episode_chapters, ChapterResolutionInput,
};
use crate::transcription::engine::TranscriptSegment;
use crate::transcription::manager::collect_tokens_from_segments;
use crate::transcription::model_manager::ModelManager;

/// Pure, testable core: combines chapter metadata classification and transcript
/// cue detection + word/silence boundary snapping + interval merging/filtering.
pub fn detect_ad_intervals_from_sources(
    episode_id: &str,
    media_revision: &str,
    chapters: &[PodcastChapter],
    transcript_segments: &[TranscriptSegment],
    episode_duration_ms: i64,
    min_ad_duration_ms: i64,
) -> Vec<PodcastAdInterval> {
    detect_ad_intervals_from_sources_with_silence(
        episode_id,
        media_revision,
        chapters,
        transcript_segments,
        episode_duration_ms,
        min_ad_duration_ms,
        &[],
        2500,
    )
}

/// Core ad-detection pipeline with optional acoustic silence gaps and configurable snap window.
pub fn detect_ad_intervals_from_sources_with_silence(
    episode_id: &str,
    media_revision: &str,
    chapters: &[PodcastChapter],
    transcript_segments: &[TranscriptSegment],
    episode_duration_ms: i64,
    min_ad_duration_ms: i64,
    silence_gaps: &[SilenceGap],
    boundary_snap_window_ms: i64,
) -> Vec<PodcastAdInterval> {
    let mut raw_intervals = Vec::new();

    if !chapters.is_empty() {
        raw_intervals.extend(classify_chapter_metadata(
            episode_id,
            media_revision,
            chapters,
        ));
    }

    if !transcript_segments.is_empty() {
        let cue_spans = detect_cue_spans(transcript_segments);
        if !cue_spans.is_empty() {
            let tokens = collect_tokens_from_segments(transcript_segments);
            for span in cue_spans {
                let start_ms = refine_boundary_with_window(
                    &tokens,
                    silence_gaps,
                    span.start_ms,
                    true,
                    boundary_snap_window_ms,
                );
                let end_ms = refine_boundary_with_window(
                    &tokens,
                    silence_gaps,
                    span.end_ms,
                    false,
                    boundary_snap_window_ms,
                );
                if end_ms > start_ms {
                    raw_intervals.push(PodcastAdInterval {
                        id: Uuid::new_v4().to_string(),
                        episode_id: episode_id.to_string(),
                        media_revision: media_revision.to_string(),
                        start_ms,
                        end_ms,
                        category: span.category,
                        confidence: span.score,
                        origin: AdDetectionMethod::ClassifierLlm.as_str().to_string(),
                        metadata_json: Some(
                            serde_json::json!({
                                "matchedCues": span.matched_cues,
                                "source": "cue_detector",
                            })
                            .to_string(),
                        ),
                    });
                }
            }
        }
    }

    let merged =
        merge_and_filter_intervals(raw_intervals, episode_duration_ms, min_ad_duration_ms);
    merged.intervals
}

async fn update_job_status(
    repo: &Repository,
    app_handle: &AppHandle,
    episode_id: &str,
    status: PodcastAdDetectionStatus,
    stage_progress: i32,
    overall_progress: i32,
    error_message: Option<String>,
    deferral_reason: Option<String>,
) {
    let status_str = status.as_str().to_string();
    let job = PodcastProcessingJob {
        id: repo
            .get_podcast_processing_job(episode_id)
            .await
            .ok()
            .flatten()
            .map(|j| j.id)
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        episode_id: episode_id.to_string(),
        status: status_str.clone(),
        stage_progress,
        overall_progress,
        error_message,
        deferral_reason,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    let _ = repo.upsert_podcast_processing_job(&job).await;
    let _ = repo
        .update_episode_ad_status(episode_id, &status_str)
        .await;
    let _ = app_handle.emit(
        "podcast://ad-detection-progress",
        serde_json::json!({
            "episodeId": episode_id,
            "status": status_str,
            "progress": overall_progress,
        }),
    );
}

/// Execute the full ad-detection pipeline for a podcast episode.
///
/// Runs:
/// 1. Policy & mobile battery/thermal gate (when `!is_manual`)
/// 2. Chapter resolution (external JSON, local ID3/MP4, description timestamps) + chapter classification
/// 3. Transcript cue detection + word-boundary refinement (if transcript segments exist)
/// 4. Optional background transcription trigger if no transcript exists and a local STT model is configured
/// 5. Interval merging, persistence, and `"podcast://ad-detection-complete"` event emission.
pub fn run_episode_ad_detection(
    episode_id: String,
    app_handle: AppHandle,
    repo: Repository,
    tokens: PodcastTranscriptionTokens,
    is_manual: bool,
    trigger_transcription_if_missing: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<PodcastAdInterval>>> + Send>> {
    Box::pin(async move {
        run_episode_ad_detection_inner(
            episode_id,
            app_handle,
            repo,
            tokens,
            is_manual,
            trigger_transcription_if_missing,
        )
        .await
    })
}

async fn run_episode_ad_detection_inner(
    episode_id: String,
    app_handle: AppHandle,
    repo: Repository,
    tokens: PodcastTranscriptionTokens,
    is_manual: bool,
    trigger_transcription_if_missing: bool,
) -> Result<Vec<PodcastAdInterval>> {
    let settings: PodcastAdSettings = repo.get_podcast_ad_settings().await.unwrap_or_default();

    if !is_manual && (!settings.auto_detect_ads || settings.processing_mode == "manual") {
        return Ok(repo.get_ad_intervals(&episode_id).await.unwrap_or_default());
    }

    if !is_manual && cfg!(any(target_os = "android", target_os = "ios")) {
        let battery = crate::battery::get_battery_state();
        if let Err(reason) = MobileScheduler::evaluate_deferral(&battery, &settings) {
            update_job_status(
                &repo,
                &app_handle,
                &episode_id,
                PodcastAdDetectionStatus::Deferred,
                0,
                0,
                None,
                Some(reason.as_str().to_string()),
            )
            .await;
            return Ok(repo.get_ad_intervals(&episode_id).await.unwrap_or_default());
        }
    }

    let episode = repo
        .get_podcast_episode_by_id(&episode_id)
        .await?
        .ok_or_else(|| PlethoraError::NotFound(format!("Podcast episode {}", episode_id)))?;

    update_job_status(
        &repo,
        &app_handle,
        &episode_id,
        PodcastAdDetectionStatus::InspectingMetadata,
        20,
        15,
        None,
        None,
    )
    .await;

    let local_audio_path = find_existing_download(&app_handle, &episode_id);
    let mut chapters = repo
        .get_podcast_chapters(&episode_id)
        .await
        .unwrap_or_default();

    let should_resolve_chapters = chapters.is_empty()
        || (local_audio_path.is_some()
            && !matches!(
                episode.chapters_source.as_deref(),
                Some("id3_chap") | Some("podcast20_json")
            ));

    if should_resolve_chapters {
        let resolved = resolve_and_persist_episode_chapters(
            &repo,
            ChapterResolutionInput {
                episode_id: episode_id.clone(),
                chapters_url: episode.chapters_url.clone(),
                chapters_type: episode.chapters_type.clone(),
                local_audio_path: local_audio_path.clone(),
                inline_chapters: Vec::new(),
                description: episode.description.clone(),
                duration_secs: episode.duration,
            },
        )
        .await
        .unwrap_or_default();
        if !resolved.is_empty() {
            chapters = resolved;
        }
    }

    update_job_status(
        &repo,
        &app_handle,
        &episode_id,
        PodcastAdDetectionStatus::Classifying,
        50,
        50,
        None,
        None,
    )
    .await;

    let transcript_res = repo.resolve_podcast_transcript(&episode_id).await.ok();
    let transcript_segments: Vec<TranscriptSegment> = transcript_res
        .as_ref()
        .map(|res| {
            res.segments
                .iter()
                .filter(|s| s.end_ms > s.start_ms && !s.text.trim().is_empty())
                .map(|s| TranscriptSegment {
                    start_ms: s.start_ms,
                    end_ms: s.end_ms,
                    text: s.text.clone(),
                    confidence: 0.9,
                    words_json: s.word_timings_json.clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    update_job_status(
        &repo,
        &app_handle,
        &episode_id,
        PodcastAdDetectionStatus::RefiningBoundaries,
        80,
        80,
        None,
        None,
    )
    .await;

    let media_revision = episode
        .guid
        .clone()
        .unwrap_or_else(|| episode_id.clone());
    let episode_duration_ms = episode.duration.unwrap_or(0).max(0) * 1000;
    let min_ad_duration_ms = (settings.min_ad_duration_seconds.max(3) as i64) * 1000;
    let boundary_snap_window_ms =
        ((settings.boundary_snap_window_seconds.max(0.0) * 1000.0).round() as i64).min(10_000);

    let silence_gaps = if !transcript_segments.is_empty() {
        if let Some(audio_path) = local_audio_path.clone() {
            let candidate_spans = detect_cue_spans(&transcript_segments);
            if candidate_spans.is_empty() || boundary_snap_window_ms <= 0 {
                Vec::new()
            } else {
                let points: Vec<i64> = candidate_spans
                    .iter()
                    .flat_map(|s| [s.start_ms, s.end_ms])
                    .collect();
                tokio::task::spawn_blocking(move || {
                    detect_silence_gaps_around_points(&audio_path, &points, boundary_snap_window_ms)
                })
                .await
                .unwrap_or_default()
            }
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let detected = detect_ad_intervals_from_sources_with_silence(
        &episode_id,
        &media_revision,
        &chapters,
        &transcript_segments,
        episode_duration_ms,
        min_ad_duration_ms,
        &silence_gaps,
        boundary_snap_window_ms,
    );

    if let Err(e) = repo.upsert_ad_intervals(&episode_id, &detected).await {
        update_job_status(
            &repo,
            &app_handle,
            &episode_id,
            PodcastAdDetectionStatus::Failed,
            0,
            0,
            Some(e.to_string()),
            None,
        )
        .await;
        return Err(e);
    }

    let all_intervals = repo.get_ad_intervals(&episode_id).await.unwrap_or(detected);

    // If no timestamped transcript segments exist yet, optionally kick off background
    // transcription with the user's configured local STT model so cue detection can run.
    let transcript_in_progress = transcript_res.as_ref().is_some_and(|r| {
        matches!(
            r.status.as_str(),
            "pending" | "downloading" | "transcribing" | "processing"
        )
    });

    if transcript_segments.is_empty()
        && trigger_transcription_if_missing
        && !transcript_in_progress
    {
        let config = read_transcription_config(&repo).await;
        let configured_local_model = config.as_ref().and_then(|c| {
            if c.provider == "local" {
                c.preferred_model_id.clone()
            } else {
                None
            }
        });
        let fallback_installed_model = if configured_local_model.is_none() {
            ModelManager::new(&app_handle).ok().and_then(|mgr| {
                mgr.list_profiles()
                    .into_iter()
                    .find(|p| mgr.is_model_installed(&p.id))
                    .map(|p| p.id)
            })
        } else {
            None
        };

        if let Some(model_id) = configured_local_model.or(fallback_installed_model) {
            let bg_lang = config.map(|c| c.language);
            update_job_status(
                &repo,
                &app_handle,
                &episode_id,
                PodcastAdDetectionStatus::Transcribing,
                10,
                35,
                None,
                None,
            )
            .await;

            let bg_ep_id = episode_id.clone();
            let bg_app = app_handle.clone();
            let bg_repo = repo.clone();
            let bg_tokens = tokens.clone();

            tokio::spawn(async move {
                if let Err(e) = Box::pin(run_transcription_job(
                    bg_ep_id.clone(),
                    Some(model_id),
                    bg_lang,
                    None,
                    bg_app.clone(),
                    bg_repo.clone(),
                    bg_tokens,
                ))
                .await
                {
                    eprintln!(
                        "[podcast-ad] Background transcription for ad detection failed on {}: {}",
                        bg_ep_id, e
                    );
                    let _ = bg_repo
                        .update_episode_ad_status(&bg_ep_id, "ready")
                        .await;
                }
            });

            let _ = app_handle.emit(
                "podcast://ad-detection-complete",
                serde_json::json!({
                    "episodeId": &episode_id,
                    "intervalCount": all_intervals.len(),
                    "status": "transcribing",
                }),
            );
            return Ok(all_intervals);
        }
    }

    update_job_status(
        &repo,
        &app_handle,
        &episode_id,
        PodcastAdDetectionStatus::Ready,
        100,
        100,
        None,
        None,
    )
    .await;

    let _ = app_handle.emit(
        "podcast://ad-detection-complete",
        serde_json::json!({
            "episodeId": &episode_id,
            "intervalCount": all_intervals.len(),
            "status": "ready",
        }),
    );

    Ok(all_intervals)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::podcast_ad::ChapterSource;

    #[test]
    fn detects_combined_chapter_and_preroll_transcript_ads() {
        let chapters = vec![PodcastChapter {
            id: "ch-1".into(),
            episode_id: "ep-1".into(),
            chapter_index: 0,
            title: "Sponsor: BetterHelp".into(),
            start_ms: 300_000,
            end_ms: 360_000,
            image_url: None,
            link_url: None,
            source: ChapterSource::DescriptionTimestamp.as_str().to_string(),
            is_advertisement: false,
        }];

        let segments = vec![
            TranscriptSegment {
                start_ms: 0,
                end_ms: 15_000,
                text: "This episode is brought to you by ExpressVPN.".into(),
                confidence: 0.95,
                words_json: None,
            },
            TranscriptSegment {
                start_ms: 15_000,
                end_ms: 35_000,
                text: "Go to expressvpn.com/tucker and use promo code TUCKER for 3 months free.".into(),
                confidence: 0.95,
                words_json: None,
            },
            TranscriptSegment {
                start_ms: 35_000,
                end_ms: 50_000,
                text: "Welcome back to the show. Today we are discussing...".into(),
                confidence: 0.95,
                words_json: None,
            },
        ];

        let intervals = detect_ad_intervals_from_sources(
            "ep-1",
            "rev-1",
            &chapters,
            &segments,
            3_600_000,
            10_000,
        );

        assert_eq!(intervals.len(), 2);
        assert_eq!(intervals[0].start_ms, 0);
        assert!(intervals[0].end_ms >= 35_000);
        assert_eq!(intervals[1].start_ms, 300_000);
        assert_eq!(intervals[1].end_ms, 360_000);
    }
}
