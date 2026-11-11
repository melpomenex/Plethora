//! Content-addressed compatibility cache.
//!
//! The manifest is the durable truth; the SQLite rows are an index for listing
//! and LRU. Original media is never stored or modified here.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::decision::inspection_hash;
use super::types::{
    CachedArtifact, MediaCacheArtifactSummary, MediaCacheUsage, MediaCompatError, MediaFailureCode,
    MediaInspection, MediaPlaybackPlan,
};

pub const CACHE_KEY_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheManifest {
    pub schema_version: u32,
    pub cache_key: String,
    pub document_id: String,
    pub source_fingerprint: String,
    pub inspection_hash: String,
    pub plan: MediaPlaybackPlan,
    pub output_file: String,
    pub output_container: String,
    pub size_bytes: u64,
    pub duration_seconds: Option<f64>,
    pub timeline_offset_seconds: f64,
    pub created_at: String,
    pub ffmpeg_version: Option<String>,
    pub ffprobe_version: Option<String>,
    pub verification: Vec<String>,
}

pub fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, MediaCompatError> {
    use tauri::Manager;
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| {
            MediaCompatError::new(
                MediaFailureCode::InsufficientStorage,
                "The app cache directory is unavailable.",
            )
            .with_detail(error.to_string())
        })?
        .join("media_compat");
    std::fs::create_dir_all(&root).map_err(|error| {
        MediaCompatError::new(
            MediaFailureCode::InsufficientStorage,
            "The compatibility cache could not be created.",
        )
        .with_detail(error.to_string())
    })?;
    Ok(root)
}

pub fn output_extension(container: &str) -> &'static str {
    match container {
        "mp4" => "mp4",
        "webm" => "webm",
        "m4a" => "m4a",
        _ => "mkv",
    }
}

pub fn cache_key(
    document_id: &str,
    canonical_source_path: &Path,
    inspection: &MediaInspection,
    plan: &MediaPlaybackPlan,
) -> String {
    let input = serde_json::json!({
        "keyVersion": CACHE_KEY_VERSION,
        "pipelineVersion": super::types::COMPAT_PIPELINE_VERSION,
        "documentId": document_id,
        "sourcePath": canonical_source_path.to_string_lossy(),
        "sourceFingerprint": inspection.source.fingerprint,
        "inspectionHash": inspection_hash(inspection),
        "strategy": plan.strategy,
        "selectedVideoIndex": plan.selected_video_index,
        "selectedAudioIndex": plan.selected_audio_index,
        "subtitlePolicy": plan.subtitle_policy,
        "output": plan.output,
        "ffmpegVersion": inspection.tool.ffmpeg_version,
        "ffprobeVersion": inspection.tool.ffprobe_version,
    });
    let bytes = serde_json::to_vec(&input).unwrap_or_default();
    hex::encode(Sha256::digest(bytes))
}

pub fn artifact_dir(root: &Path, cache_key: &str) -> PathBuf {
    root.join(cache_key)
}

pub fn staging_dir(root: &Path, job_id: &str) -> PathBuf {
    root.join(".staging").join(job_id)
}

fn manifest_path(dir: &Path) -> PathBuf {
    dir.join("manifest.json")
}

pub fn read_manifest(root: &Path, cache_key: &str) -> Option<CacheManifest> {
    let bytes = std::fs::read(manifest_path(&artifact_dir(root, cache_key))).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn validate(
    root: &Path,
    cache_key: &str,
    source_fingerprint: &str,
    inspection_hash: &str,
) -> Option<CachedArtifact> {
    let manifest = read_manifest(root, cache_key)?;
    if manifest.schema_version != super::types::MEDIA_COMPAT_SCHEMA_VERSION
        || manifest.cache_key != cache_key
        || manifest.source_fingerprint != source_fingerprint
        || manifest.inspection_hash != inspection_hash
    {
        return None;
    }
    let output = artifact_dir(root, cache_key).join(&manifest.output_file);
    let metadata = std::fs::metadata(&output).ok()?;
    if !metadata.is_file() || metadata.len() != manifest.size_bytes {
        return None;
    }
    Some(CachedArtifact {
        cache_key: cache_key.to_string(),
        output_container: manifest.output_container,
        duration_seconds: manifest.duration_seconds,
        size_bytes: manifest.size_bytes,
        timeline_offset_seconds: manifest.timeline_offset_seconds,
    })
}

/// Publish a completed staging directory atomically under its cache key.
pub fn publish(
    root: &Path,
    staging: &Path,
    cache_key: &str,
    manifest: &CacheManifest,
) -> Result<PathBuf, MediaCompatError> {
    let final_dir = artifact_dir(root, cache_key);
    std::fs::create_dir_all(root).map_err(cache_error)?;

    let manifest_bytes = serde_json::to_vec(manifest).map_err(|error| {
        MediaCompatError::new(
            MediaFailureCode::ConversionFailed,
            "The compatibility manifest could not be serialized.",
        )
        .with_detail(error.to_string())
    })?;
    std::fs::write(manifest_path(staging), manifest_bytes).map_err(cache_error)?;

    if final_dir.exists() {
        if validate(
            root,
            cache_key,
            &manifest.source_fingerprint,
            &manifest.inspection_hash,
        )
        .is_some()
        {
            let _ = std::fs::remove_dir_all(staging);
            return Ok(final_dir);
        }
        let trash = root.join(".trash").join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(trash.parent().unwrap_or(root)).ok();
        std::fs::rename(&final_dir, &trash).map_err(cache_error)?;
    }

    if let Err(error) = std::fs::rename(staging, &final_dir) {
        return Err(cache_error(error));
    }
    let output = final_dir.join(&manifest.output_file);
    if !output.is_file() {
        let _ = std::fs::remove_dir_all(&final_dir);
        return Err(MediaCompatError::new(
            MediaFailureCode::ConversionVerificationFailed,
            "The published cache artifact is missing its output.",
        ));
    }
    Ok(final_dir)
}

fn cache_error(error: std::io::Error) -> MediaCompatError {
    MediaCompatError::new(
        MediaFailureCode::ConversionFailed,
        "The compatibility cache could not be updated.",
    )
    .with_detail(error.to_string())
}

pub fn usage(root: &Path) -> MediaCacheUsage {
    let mut artifacts = Vec::new();
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir()
                || path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with('.'))
                    .unwrap_or(true)
            {
                continue;
            }
            let Some(key) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let Some(manifest) = read_manifest(root, key) else {
                continue;
            };
            let output = path.join(&manifest.output_file);
            let size = std::fs::metadata(&output)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            if size == 0 {
                continue;
            }
            total = total.saturating_add(size);
            artifacts.push(MediaCacheArtifactSummary {
                cache_key: key.to_string(),
                document_id: manifest.document_id,
                size_bytes: size,
                output_container: manifest.output_container,
                last_accessed_at: manifest.created_at,
            });
        }
    }
    artifacts.sort_by(|a, b| b.last_accessed_at.cmp(&a.last_accessed_at));
    MediaCacheUsage {
        artifact_count: artifacts.len(),
        total_bytes: total,
        cache_root_label: "app cache/media_compat".to_string(),
        artifacts,
    }
}

pub fn clear(root: &Path, document_id: Option<&str>) -> Result<MediaCacheUsage, MediaCompatError> {
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(key) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if key.starts_with('.') || !path.is_dir() {
                continue;
            }
            let Some(manifest) = read_manifest(root, key) else {
                continue;
            };
            if document_id
                .map(|id| id != manifest.document_id)
                .unwrap_or(false)
            {
                continue;
            }
            let _ = std::fs::remove_dir_all(&path);
        }
    }
    Ok(usage(root))
}

/// Evict least-recently-used artifacts until usage is at most 90% of `limit_bytes`.
pub fn prune(root: &Path, limit_bytes: u64) -> Result<MediaCacheUsage, MediaCompatError> {
    let current = usage(root);
    if current.total_bytes <= limit_bytes {
        return Ok(current);
    }
    let target = limit_bytes.saturating_mul(9) / 10;
    let mut remaining = current.total_bytes;
    for artifact in current.artifacts.iter().rev() {
        if remaining <= target {
            break;
        }
        let path = artifact_dir(root, &artifact.cache_key);
        if std::fs::remove_dir_all(&path).is_ok() {
            remaining = remaining.saturating_sub(artifact.size_bytes);
        }
    }
    Ok(usage(root))
}
