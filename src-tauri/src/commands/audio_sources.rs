//! Resolve persisted library identities into short-lived native decoder capabilities.
use crate::database::{audio_edition_repository::AudioEditionRepository, Repository};
use crate::models::{document::FileType, recording_session::MediaAssetState};
use crate::services::audio_playback::{self, AudioSourceKey, AudioSourceKind};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioResumeHint {
    part_index: usize,
    time_in_part: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePart {
    part_id: String,
    source_revision: String,
    native_uri: String,
    duration_sec: Option<f64>,
    title: Option<String>,
}

fn duration(seconds: f64) -> Option<f64> {
    (seconds.is_finite() && seconds > 0.0).then_some(seconds)
}

async fn promoted_podcast_document_id(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    episode_id: &str,
) -> Result<Option<String>, String> {
    sqlx::query_scalar(
        "SELECT id FROM documents WHERE file_type = 'audio' AND json_valid(metadata) AND json_extract(metadata, '$.source') = ?1 LIMIT 1",
    )
    .bind(format!("podcast:{episode_id}"))
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())
}

fn legacy_seconds(position: Option<&str>) -> f64 {
    position
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .filter(|value| value["type"] == "time")
        .and_then(|value| value["seconds"].as_f64())
        .filter(|value| value.is_finite() && *value >= 0.0)
        .unwrap_or(0.0)
}

fn locate(parts: &[NativePart], mut seconds: f64) -> Option<AudioResumeHint> {
    for (index, part) in parts.iter().enumerate() {
        match part.duration_sec {
            Some(length) if seconds >= length && index + 1 < parts.len() => seconds -= length,
            Some(length) => {
                return Some(AudioResumeHint {
                    part_index: index,
                    time_in_part: seconds.min(length),
                })
            }
            None if index + 1 == parts.len() || seconds == 0.0 => {
                return Some(AudioResumeHint {
                    part_index: index,
                    time_in_part: seconds,
                })
            }
            None => return None,
        }
    }
    None
}

async fn native_uri(
    path: &str,
    app: &tauri::AppHandle,
    repo: &Repository,
) -> Result<String, String> {
    if path.starts_with("content://") {
        // Only called for a persisted catalog path; the service independently verifies its grant.
        return Ok(path.to_owned());
    }
    if let Ok(url) = url::Url::parse(path) {
        if matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
        {
            return Ok(url.to_string());
        }
        if url.scheme() != "file" {
            return Err("Unsupported audio source URI".into());
        }
    }
    let file_path = if path.starts_with("file:") {
        url::Url::parse(path)
            .map_err(|_| "Invalid audio file URI")?
            .to_file_path()
            .map_err(|_| "Invalid audio file URI")?
            .to_string_lossy()
            .into_owned()
    } else {
        path.to_owned()
    };
    let (canonical, _) = crate::media_server::authorize_media_file(app, &file_path, repo).await?;
    url::Url::from_file_path(canonical)
        .map(|url| url.to_string())
        .map_err(|_| "Invalid audio file path".into())
}

/// URI arguments are never accepted from the caller. The token is one use, profile bound, and expires.
#[tauri::command]
pub async fn resolve_native_audio_source(
    source_key: AudioSourceKey,
    resume_hint: Option<AudioResumeHint>,
    queue_keys: Option<Vec<AudioSourceKey>>,
    study_config: Option<serde_json::Value>,
    window: tauri::WebviewWindow,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Audio sources belong to the main window".into());
    }
    let queue = queue_keys.unwrap_or_default();
    validate_queue(&queue, &source_key)?;
    let mut manifest = resolve_manifest(
        source_key.clone(),
        resume_hint,
        app_handle.clone(),
        repo.clone(),
    )
    .await?;
    let mut prepared = Vec::new();
    let mut prepared_bytes = serde_json::to_vec(&manifest)
        .map_err(|error| error.to_string())?
        .len();
    for key in &queue {
        if key.kind == source_key.kind && key.source_id == source_key.source_id {
            continue;
        }
        // A failed/unprepared member is retained by identity as a stop boundary;
        // later entries must never be substituted for it.
        if let Ok(item) =
            resolve_manifest(key.clone(), None, app_handle.clone(), repo.clone()).await
        {
            prepared_bytes += serde_json::to_vec(&item)
                .map_err(|error| error.to_string())?
                .len();
            if prepared_bytes > 4 * 1024 * 1024 {
                return Err("Prepared audio queue exceeds the native manifest limit".into());
            }
            prepared.push(item);
        }
    }
    manifest["queueKeys"] = serde_json::to_value(&queue).map_err(|error| error.to_string())?;
    manifest["queueEntries"] = serde_json::Value::Array(prepared);
    if let Some(config) = study_config {
        let serialized = serde_json::to_vec(&config).map_err(|error| error.to_string())?.len();
        if serialized > 32 * 1024 {
            return Err("Study configuration exceeds the native manifest limit".into());
        }
        manifest["studyConfig"] = config;
    }
    let token = uuid::Uuid::new_v4().to_string();
    plethora_android_tts::authorize_audio_manifest(token.clone(), manifest.clone())?;
    let item = presentation_item(manifest);
    Ok(
        serde_json::json!({ "schemaVersion": 1, "authorizationId": token, "mediaRevision": item["mediaRevision"], "item": item }),
    )
}

fn presentation_item(mut item: serde_json::Value) -> serde_json::Value {
    item.as_object_mut().unwrap().remove("schemaVersion");
    item.as_object_mut().unwrap().remove("queueEntries");
    for part in item["parts"].as_array_mut().unwrap() {
        part.as_object_mut().unwrap().remove("nativeUri");
    }
    item
}

fn validate_queue(queue: &[AudioSourceKey], current: &AudioSourceKey) -> Result<(), String> {
    if queue.len() > 128 {
        return Err("Audio queue is too large".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut contains_current = queue.is_empty();
    for key in queue {
        key.validate().map_err(|error| error.to_string())?;
        if key.profile_key != current.profile_key {
            return Err("Audio queue belongs to another profile".into());
        }
        let identity = serde_json::to_string(key).map_err(|error| error.to_string())?;
        if !seen.insert(identity) {
            return Err("Audio queue contains duplicate identities".into());
        }
        contains_current |= key.kind == current.kind && key.source_id == current.source_id;
    }
    if !contains_current {
        return Err("Audio queue does not contain the current source".into());
    }
    Ok(())
}

async fn resolve_manifest(
    source_key: AudioSourceKey,
    resume_hint: Option<AudioResumeHint>,
    app_handle: tauri::AppHandle,
    repo: State<'_, Repository>,
) -> Result<serde_json::Value, String> {
    source_key.validate().map_err(|error| error.to_string())?;
    if resume_hint.as_ref().is_some_and(|hint| {
        !hint.time_in_part.is_finite() || hint.time_in_part < 0.0 || hint.part_index > 4095
    }) {
        return Err("Invalid audio resume hint".into());
    }
    let mut parts = Vec::new();
    let title;
    let artwork;
    let mut document_id: Option<String> = None;
    let mut edition_id: Option<String> = None;
    let mut complete = true;
    let mut legacy = 0.0;
    match source_key.kind {
        AudioSourceKind::Audiobook => {
            let document = repo
                .get_document(&source_key.source_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Audiobook unavailable")?;
            if !matches!(document.file_type, FileType::Audio) {
                return Err("Document has no audiobook media".into());
            }
            title = document.title;
            artwork = document.cover_image_url;
            document_id = Some(document.id.clone());
            legacy = legacy_seconds(document.position_json.as_deref());
            // Imported multipart books use their persisted edition manifest, never caller paths.
            let editions = AudioEditionRepository::new(repo.pool().clone());
            if let Some(mut edition) = editions
                .get_audio_edition_by_document(&document.id)
                .await
                .map_err(|error| error.to_string())?
            {
                edition
                    .sections
                    .sort_by_key(|section| section.section_index);
                if edition.edition.provider == "imported" {
                    for section in edition.sections {
                        if section.generation_status != "ready" || section.audio_file_path.is_none()
                        {
                            return Err("Imported audiobook parts are unavailable".into());
                        }
                        parts.push(NativePart {
                            part_id: section.id,
                            source_revision: section.cache_key,
                            native_uri: native_uri(
                                section.audio_file_path.as_deref().unwrap(),
                                &app_handle,
                                &repo,
                            )
                            .await?,
                            duration_sec: duration(section.duration_sec),
                            title: Some(section.title),
                        });
                    }
                }
            }
            if parts.is_empty() {
                parts.push(NativePart {
                    part_id: document.id,
                    source_revision: document.content_hash.unwrap_or_default(),
                    native_uri: native_uri(&document.file_path, &app_handle, &repo).await?,
                    duration_sec: None,
                    title: None,
                });
            }
        }
        AudioSourceKind::Podcast => {
            let episode = repo
                .get_podcast_episode_by_id(&source_key.source_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Podcast episode unavailable")?;
            title = episode.title;
            artwork = episode.image_url;
            document_id = promoted_podcast_document_id(repo.pool(), &episode.id).await?;
            legacy = episode.playback_position.max(0.0);
            let local =
                super::podcast::get_downloaded_episode_path(episode.id.clone(), app_handle.clone())
                    .await
                    .map_err(|error| error.to_string())?;
            let uri = match local {
                Some(path) => match native_uri(&path, &app_handle, &repo).await {
                    Ok(uri) => uri,
                    Err(_) => native_uri(&episode.audio_url, &app_handle, &repo).await?,
                },
                None => native_uri(&episode.audio_url, &app_handle, &repo).await?,
            };
            parts.push(NativePart {
                part_id: episode.id.clone(),
                source_revision: episode.guid.unwrap_or(episode.id),
                native_uri: uri,
                duration_sec: episode.duration.and_then(|value| duration(value as f64)),
                title: None,
            });
        }
        AudioSourceKind::AudioEdition => {
            let repository = AudioEditionRepository::new(repo.pool().clone());
            let mut edition = repository
                .get_audio_edition(&source_key.source_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Audio Edition unavailable")?;
            if edition.edition.provider == "transcript" {
                return Err("Transcript-only edition has no playable media".into());
            }
            let document = repo
                .get_document(&edition.edition.source_document_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Audio Edition source unavailable")?;
            title = document.title;
            artwork = document.cover_image_url;
            document_id = Some(document.id);
            edition_id = Some(edition.edition.id);
            edition
                .sections
                .sort_by_key(|section| section.section_index);
            complete = edition.edition.status == "ready";
            for section in edition.sections {
                if section.generation_status != "ready" || section.audio_file_path.is_none() {
                    complete = false;
                    break;
                }
                parts.push(NativePart {
                    part_id: section.id,
                    source_revision: section.cache_key,
                    native_uri: native_uri(
                        section.audio_file_path.as_deref().unwrap(),
                        &app_handle,
                        &repo,
                    )
                    .await?,
                    duration_sec: duration(section.duration_sec),
                    title: Some(section.title),
                });
            }
        }
        AudioSourceKind::Recording => {
            let session = repo
                .get_recording_session(&source_key.source_id)
                .await
                .map_err(|error| error.to_string())?;
            let asset_id = session
                .media_asset_id
                .as_ref()
                .ok_or("Transcript-only session has no recording")?;
            let asset = repo
                .get_recording_asset(&source_key.source_id, asset_id)
                .await
                .map_err(|error| error.to_string())?;
            if asset.state != MediaAssetState::Ready {
                return Err("Recording media is missing or unfinished".into());
            }
            let path = super::recording_sessions::get_recording_media_path(
                source_key.source_id.clone(),
                app_handle.clone(),
                repo.clone(),
            )
            .await
            .map_err(|error| error.to_string())?;
            let document = repo
                .get_document(&session.document_id)
                .await
                .map_err(|error| error.to_string())?
                .ok_or("Recording document unavailable")?;
            title = document.title;
            artwork = document.cover_image_url;
            document_id = Some(document.id);
            parts.push(NativePart {
                part_id: asset.id.clone(),
                source_revision: asset.sha256.unwrap_or(asset.id),
                native_uri: native_uri(&path, &app_handle, &repo).await?,
                duration_sec: asset
                    .duration_ms
                    .and_then(|value| duration(value as f64 / 1000.0)),
                title: None,
            });
        }
    }
    if parts.is_empty() || parts.len() > 4096 {
        return Err("No bounded ready audio manifest available".into());
    }
    let revision = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&parts).map_err(|error| error.to_string())?)
    );
    let mut resume = if matches!(source_key.kind, AudioSourceKind::AudioEdition) {
        resume_hint
    } else {
        locate(&parts, legacy)
    };
    if let Some(checkpoint) = audio_playback::get_checkpoint(repo.pool(), &source_key)
        .await
        .map_err(|error| error.to_string())?
    {
        // A newer remote legacy position may legitimately be a rewind. Never merge using max().
        let legacy_matches = checkpoint
            .position_sec
            .is_some_and(|value| (value - legacy).abs() < 1.0);
        if checkpoint.media_revision == revision
            && (matches!(
                source_key.kind,
                AudioSourceKind::Recording | AudioSourceKind::AudioEdition
            ) || legacy_matches)
        {
            resume = Some(AudioResumeHint {
                part_index: checkpoint.part_index as usize,
                time_in_part: checkpoint.time_in_part,
            });
        }
    }
    let resume = resume.filter(|hint| {
        parts.get(hint.part_index).is_some_and(|part| {
            part.duration_sec
                .is_none_or(|length| hint.time_in_part <= length)
        })
    });
    let manifest = serde_json::json!({ "schemaVersion": 1, "sourceKey": source_key, "title": title, "artworkUrl": artwork, "documentId": document_id, "editionId": edition_id, "mediaRevision": revision, "parts": parts, "complete": complete, "resume": resume });
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn key(id: &str) -> AudioSourceKey {
        AudioSourceKey {
            profile_key: "test".into(),
            kind: AudioSourceKind::Audiobook,
            source_id: id.into(),
        }
    }
    #[test]
    fn native_queue_rejects_foreign_duplicates_and_unbound_current() {
        let current = key("first");
        let foreign = AudioSourceKey {
            profile_key: "other".into(),
            ..key("second")
        };
        assert!(validate_queue(&[current.clone(), key("second")], &current).is_ok());
        assert!(validate_queue(&[current.clone(), foreign], &current).is_err());
        assert!(validate_queue(&[current.clone(), current.clone()], &current).is_err());
        assert!(validate_queue(&[key("second")], &current).is_err());
    }
    #[test]
    fn frontend_metadata_never_contains_prepared_queue_decoder_locations() {
        let item = presentation_item(serde_json::json!({
            "schemaVersion": 1, "queueKeys": [key("first"), key("second")],
            "parts": [{"partId": "one", "nativeUri": "file:///private/one.wav"}],
            "queueEntries": [{"parts": [{"nativeUri": "https://private.test/signed?secret=token"}]}]
        }));
        let serialized = item.to_string();
        assert!(!serialized.contains("nativeUri"));
        assert!(!serialized.contains("private"));
        assert!(!serialized.contains("secret"));
        assert_eq!(item["queueKeys"].as_array().unwrap().len(), 2);
    }
    fn part(length: Option<f64>) -> NativePart {
        NativePart {
            part_id: "p".into(),
            source_revision: "r".into(),
            native_uri: "file:///audio.wav".into(),
            duration_sec: length,
            title: None,
        }
    }
    #[test]
    fn native_audio_coordinates_keep_unknown_boundaries_and_long_positions() {
        assert!(locate(&[part(None), part(Some(100.0))], 10.0).is_none());
        let at_boundary = locate(&[part(Some(100_000.0)), part(Some(20.0))], 100_000.0).unwrap();
        assert_eq!(at_boundary.part_index, 1);
        assert_eq!(at_boundary.time_in_part, 0.0);
        assert_eq!(
            legacy_seconds(Some(r#"{"type":"scroll","seconds":40}"#)),
            0.0
        );
        assert_eq!(
            legacy_seconds(Some(r#"{"type":"time","seconds":100001}"#)),
            100001.0
        );
    }
    #[tokio::test]
    async fn promoted_podcast_lookup_requires_verified_audio_document_source() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::database::migrations::run_migrations(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO documents(id,title,file_path,file_type,date_added,date_modified,metadata) VALUES ('doc-promoted','Episode','ep.mp3','audio','2026-10-23','2026-10-23','{\"source\":\"podcast:ep-1\"}'), ('ep-standalone','Not A Podcast','book.epub','epub','2026-10-23','2026-10-23','{\"source\":\"podcast:ep-standalone\"}')").execute(&pool).await.unwrap();
        assert_eq!(
            promoted_podcast_document_id(&pool, "ep-1").await.unwrap(),
            Some("doc-promoted".to_string())
        );
        assert_eq!(
            promoted_podcast_document_id(&pool, "ep-standalone").await.unwrap(),
            None
        );
        assert_eq!(
            promoted_podcast_document_id(&pool, "missing").await.unwrap(),
            None
        );
    }
}
