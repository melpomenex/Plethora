//! Tauri IPC commands for podcast ad removal, chapters, and detection settings.

use tauri::{AppHandle, State};

use crate::database::Repository;
use crate::error::Result;
use crate::models::{
    PodcastAdCorrection, PodcastAdInterval, PodcastAdSettings, PodcastChapter,
    PodcastProcessingJob,
};

#[tauri::command]
pub async fn get_episode_chapters(
    episode_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<PodcastChapter>> {
    repo.get_podcast_chapters(&episode_id).await
}

#[tauri::command]
pub async fn get_episode_ad_intervals(
    episode_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<PodcastAdInterval>> {
    repo.get_ad_intervals(&episode_id).await
}

#[tauri::command]
pub async fn save_manual_ad_interval(
    episode_id: String,
    interval: PodcastAdInterval,
    repo: State<'_, Repository>,
) -> Result<()> {
    repo.save_manual_ad_interval(&episode_id, &interval).await
}

#[tauri::command]
pub async fn delete_ad_interval(
    interval_id: String,
    repo: State<'_, Repository>,
) -> Result<()> {
    repo.delete_ad_interval(&interval_id).await
}

#[tauri::command]
pub async fn get_podcast_ad_settings(
    repo: State<'_, Repository>,
) -> Result<PodcastAdSettings> {
    repo.get_podcast_ad_settings().await
}

#[tauri::command]
pub async fn update_podcast_ad_settings(
    settings: PodcastAdSettings,
    repo: State<'_, Repository>,
) -> Result<()> {
    repo.update_podcast_ad_settings(&settings).await
}

#[tauri::command]
pub async fn detect_episode_ads(
    episode_id: String,
    repo: State<'_, Repository>,
    _app: AppHandle,
) -> Result<String> {
    let job_id = uuid::Uuid::new_v4().to_string();
    let job = PodcastProcessingJob {
        id: job_id.clone(),
        episode_id: episode_id.clone(),
        status: "queued".to_string(),
        stage_progress: 0,
        overall_progress: 0,
        error_message: None,
        deferral_reason: None,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    repo.upsert_podcast_processing_job(&job).await?;
    repo.update_episode_ad_status(&episode_id, "queued").await?;
    Ok(job_id)
}

#[tauri::command]
pub async fn cancel_ad_detection(
    episode_id: String,
    repo: State<'_, Repository>,
) -> Result<()> {
    if let Some(mut job) = repo.get_podcast_processing_job(&episode_id).await? {
        job.status = "cancelled".to_string();
        job.updated_at = chrono::Utc::now().to_rfc3339();
        repo.upsert_podcast_processing_job(&job).await?;
    }
    repo.update_episode_ad_status(&episode_id, "none").await?;
    Ok(())
}
