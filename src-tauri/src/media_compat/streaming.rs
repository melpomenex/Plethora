//! On-demand seekable HLS (fMP4) streaming for local media compatibility.
//!
//! Instead of writing a full-file remux/transcode copy to disk before playback
//! can start, this module serves a virtual VOD HLS playlist over the loopback
//! `media_server` and spawns windowed `ffmpeg` workers on demand for the active
//! playback/seek position.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use axum::{
    extract::Path as AxumPath,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::types::{MediaCompatError, MediaFailureCode, MediaInspection, MediaPlaybackPlan};
use crate::utils::ffmpeg;

pub const SEGMENT_DURATION_SECONDS: f64 = 6.0;
pub const WINDOW_SEGMENT_COUNT: usize = 30;
const SEGMENT_WAIT_TIMEOUT: Duration = Duration::from_secs(20);
const SEGMENT_POLL_INTERVAL: Duration = Duration::from_millis(25);
const SESSION_IDLE_TTL: Duration = Duration::from_secs(30 * 60);

static STREAM_MANAGER: OnceLock<Arc<StreamingSessionManager>> = OnceLock::new();
static WORKER_COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn global_manager() -> Arc<StreamingSessionManager> {
    STREAM_MANAGER
        .get_or_init(|| Arc::new(StreamingSessionManager::new()))
        .clone()
}

pub fn router() -> Router<crate::media_server::MediaServerState> {
    Router::new()
        .route("/media-stream/:session_id/playlist.m3u8", get(playlist_handler))
        .route("/media-stream/:session_id/init.mp4", get(init_handler))
        .route("/media-stream/:session_id/seg/:segment", get(segment_handler))
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStreamSessionInfo {
    pub session_id: String,
    pub playlist_url: String,
    pub duration_seconds: f64,
    pub segment_duration_seconds: f64,
}

struct ActiveWorker {
    window_id: u64,
    start_segment: usize,
    segment_count: usize,
    dir: PathBuf,
    child: Option<Child>,
    exited: bool,
}

impl ActiveWorker {
    fn contains_segment(&self, index: usize) -> bool {
        index >= self.start_segment && index < self.start_segment + self.segment_count
    }

    fn local_index(&self, index: usize) -> usize {
        index.saturating_sub(self.start_segment)
    }

    fn segment_path(&self, local_idx: usize) -> PathBuf {
        self.dir.join(format!("seg_{local_idx:05}.m4s"))
    }

    fn init_path(&self) -> PathBuf {
        self.dir.join("init.mp4")
    }

    fn poll_exited(&mut self) -> bool {
        if self.exited {
            return true;
        }
        if let Some(child) = self.child.as_mut() {
            if let Ok(Some(_)) = child.try_wait() {
                self.exited = true;
            }
        } else {
            self.exited = true;
        }
        self.exited
    }

    fn kill_and_cleanup(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }
        self.exited = true;
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Drop for ActiveWorker {
    fn drop(&mut self) {
        self.kill_and_cleanup();
    }
}

struct StreamSession {
    session_id: String,
    document_id: String,
    source_path: PathBuf,
    inspection: MediaInspection,
    plan: MediaPlaybackPlan,
    duration_seconds: f64,
    total_segments: usize,
    root_dir: PathBuf,
    last_accessed: Instant,
    worker: Option<ActiveWorker>,
}

impl StreamSession {
    fn cleanup(&mut self) {
        if let Some(mut worker) = self.worker.take() {
            worker.kill_and_cleanup();
        }
        let _ = std::fs::remove_dir_all(&self.root_dir);
    }
}

pub struct StreamingSessionManager {
    sessions: Mutex<HashMap<String, Arc<Mutex<StreamSession>>>>,
}

impl Default for StreamingSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamingSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn start_session(
        &self,
        document_id: String,
        source_path: PathBuf,
        inspection: MediaInspection,
        plan: MediaPlaybackPlan,
    ) -> Result<MediaStreamSessionInfo, MediaCompatError> {
        let port = crate::media_server::port();
        if port == 0 {
            return Err(MediaCompatError::new(
                MediaFailureCode::SourceServerUnavailable,
                "The local media server is not running.",
            ));
        }

        self.prune_expired().await;

        let duration_seconds = inspection
            .duration_seconds
            .filter(|d| d.is_finite() && *d > 0.0)
            .unwrap_or(60.0);
        let total_segments = segment_count_for_duration(duration_seconds);
        let session_id = Uuid::new_v4().to_string();
        let root_dir = std::env::temp_dir()
            .join("plethora-media-stream")
            .join(&session_id);
        std::fs::create_dir_all(&root_dir).map_err(|error| {
            MediaCompatError::new(
                MediaFailureCode::InsufficientStorage,
                "Could not create streaming buffer directory.",
            )
            .with_detail(error.to_string())
        })?;

        let session = Arc::new(Mutex::new(StreamSession {
            session_id: session_id.clone(),
            document_id,
            source_path,
            inspection,
            plan,
            duration_seconds,
            total_segments,
            root_dir,
            last_accessed: Instant::now(),
            worker: None,
        }));

        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), session);

        Ok(MediaStreamSessionInfo {
            playlist_url: format!("http://127.0.0.1:{port}/media-stream/{session_id}/playlist.m3u8"),
            session_id,
            duration_seconds,
            segment_duration_seconds: SEGMENT_DURATION_SECONDS,
        })
    }

    pub async fn stop_session(&self, session_id: &str) {
        let removed = self.sessions.lock().await.remove(session_id);
        if let Some(session) = removed {
            session.lock().await.cleanup();
        }
    }

    pub async fn stop_all(&self) {
        let drained: Vec<Arc<Mutex<StreamSession>>> = {
            let mut guard = self.sessions.lock().await;
            guard.drain().map(|(_, v)| v).collect()
        };
        for session in drained {
            session.lock().await.cleanup();
        }
    }

    async fn prune_expired(&self) {
        let now = Instant::now();
        let candidates: Vec<(String, Arc<Mutex<StreamSession>>)> = {
            let guard = self.sessions.lock().await;
            guard
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        };
        let mut expired = Vec::new();
        for (id, session) in candidates {
            let guard = session.lock().await;
            if now.duration_since(guard.last_accessed) > SESSION_IDLE_TTL {
                expired.push(id);
            }
        }
        for id in expired {
            self.stop_session(&id).await;
        }
    }

    async fn get_session(&self, session_id: &str) -> Option<Arc<Mutex<StreamSession>>> {
        self.sessions.lock().await.get(session_id).cloned()
    }
}

pub fn segment_count_for_duration(duration_seconds: f64) -> usize {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return 1;
    }
    ((duration_seconds / SEGMENT_DURATION_SECONDS).ceil() as usize).max(1)
}

pub fn segment_duration(total_duration: f64, index: usize) -> f64 {
    let start = index as f64 * SEGMENT_DURATION_SECONDS;
    (total_duration - start).clamp(0.1, SEGMENT_DURATION_SECONDS)
}

pub fn build_vod_playlist(duration_seconds: f64) -> String {
    let count = segment_count_for_duration(duration_seconds);
    let mut out = String::with_capacity(128 + count * 32);
    out.push_str("#EXTM3U\n");
    out.push_str("#EXT-X-VERSION:7\n");
    out.push_str(&format!(
        "#EXT-X-TARGETDURATION:{}\n",
        SEGMENT_DURATION_SECONDS.ceil() as u64
    ));
    out.push_str("#EXT-X-MEDIA-SEQUENCE:0\n");
    out.push_str("#EXT-X-PLAYLIST-TYPE:VOD\n");
    out.push_str("#EXT-X-MAP:URI=\"init.mp4\"\n");
    for i in 0..count {
        let dur = segment_duration(duration_seconds, i);
        out.push_str(&format!("#EXTINF:{dur:.3},\nseg/{i}.m4s\n"));
    }
    out.push_str("#EXT-X-ENDLIST\n");
    out
}

fn push(args: &mut Vec<OsString>, value: impl Into<OsString>) {
    args.push(value.into());
}

fn is_hevc(inspection: &MediaInspection, plan: &MediaPlaybackPlan) -> bool {
    plan.selected_video_index
        .and_then(|index| inspection.video_streams.iter().find(|s| s.index == index))
        .map(|s| s.codec.eq_ignore_ascii_case("hevc"))
        .unwrap_or(false)
}

pub fn build_hls_ffmpeg_args(
    plan: &MediaPlaybackPlan,
    inspection: &MediaInspection,
    input: &Path,
    window_dir: &Path,
    start_seconds: f64,
    window_duration: f64,
) -> Vec<OsString> {
    let mut args = Vec::new();
    for value in ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"] {
        push(&mut args, value);
    }
    if start_seconds > 0.0 {
        push(&mut args, "-ss");
        push(&mut args, format!("{start_seconds:.3}"));
    }
    push(&mut args, "-t");
    push(&mut args, format!("{window_duration:.3}"));
    push(&mut args, "-i");
    push(&mut args, input.as_os_str().to_owned());

    if let Some(index) = plan.selected_video_index {
        push(&mut args, "-map");
        push(&mut args, format!("0:{index}"));
    } else {
        push(&mut args, "-map");
        push(&mut args, "0:v:0?");
    }
    if let Some(index) = plan.selected_audio_index {
        push(&mut args, "-map");
        push(&mut args, format!("0:{index}"));
    } else {
        push(&mut args, "-map");
        push(&mut args, "0:a:0?");
    }
    for value in ["-sn", "-dn", "-map_chapters", "-1"] {
        push(&mut args, value);
    }

    let profile = plan.output.as_ref();
    let video = profile.map(|p| p.video.as_str()).unwrap_or("copy");
    let audio = profile.map(|p| p.audio.as_str()).unwrap_or("copy");

    if video == "copy" {
        push(&mut args, "-c:v");
        push(&mut args, "copy");
        if is_hevc(inspection, plan) {
            push(&mut args, "-tag:v");
            push(&mut args, "hvc1");
        }
    } else {
        push(&mut args, "-c:v");
        push(&mut args, "libx264");
        push(&mut args, "-preset");
        push(
            &mut args,
            profile
                .and_then(|p| p.video_preset.as_deref())
                .unwrap_or("veryfast"),
        );
        push(&mut args, "-crf");
        push(
            &mut args,
            profile
                .and_then(|p| p.video_crf)
                .unwrap_or(20)
                .to_string(),
        );
        push(&mut args, "-threads");
        let cores = std::thread::available_parallelism()
            .map(|v| v.get())
            .unwrap_or(4);
        push(&mut args, cores.saturating_sub(2).clamp(1, 4).to_string());
        push(&mut args, "-pix_fmt");
        push(&mut args, "yuv420p");
        push(&mut args, "-g");
        push(&mut args, "48");
        push(&mut args, "-keyint_min");
        push(&mut args, "48");

        let mut filters = Vec::new();
        if profile.and_then(|p| p.tone_map.as_deref()) == Some("hdr10_to_sdr_bt709") {
            filters.push(
                "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p".to_string(),
            );
        }
        if profile.and_then(|p| p.scale.as_deref()) == Some("max_1080p") {
            filters.push("scale=-2:1080".to_string());
        }
        if !filters.is_empty() {
            push(&mut args, "-vf");
            push(&mut args, filters.join(","));
        }
    }

    let selected_audio_codec = plan
        .selected_audio_index
        .and_then(|idx| inspection.audio_streams.iter().find(|s| s.index == idx))
        .or_else(|| inspection.audio_streams.first())
        .map(|s| s.codec.to_ascii_lowercase())
        .unwrap_or_default();
    let audio_mse_compatible = matches!(selected_audio_codec.as_str(), "aac" | "mp3");

    match audio {
        "copy" if audio_mse_compatible => {
            push(&mut args, "-c:a");
            push(&mut args, "copy");
        }
        _ => {
            push(&mut args, "-c:a");
            push(&mut args, "aac");
            push(&mut args, "-b:a");
            push(
                &mut args,
                format!(
                    "{}k",
                    profile
                        .and_then(|p| p.audio_bitrate_kbps)
                        .unwrap_or(192)
                ),
            );
            let channels = profile
                .and_then(|p| p.audio_channels)
                .unwrap_or(2)
                .min(2);
            push(&mut args, "-ac");
            push(&mut args, channels.to_string());
            push(&mut args, "-ar");
            push(&mut args, "48000");
        }
    }

    if start_seconds > 0.0 {
        push(&mut args, "-output_ts_offset");
        push(&mut args, format!("{start_seconds:.3}"));
    }

    let seg_pattern = window_dir.join("seg_%05d.m4s");
    let playlist_path = window_dir.join("index.m3u8");
    for value in [
        "-f",
        "hls",
        "-hls_time",
        "6",
        "-hls_playlist_type",
        "vod",
        "-hls_segment_type",
        "fmp4",
        "-hls_fmp4_init_filename",
        "init.mp4",
        "-hls_segment_filename",
    ] {
        push(&mut args, value);
    }
    push(&mut args, seg_pattern.as_os_str().to_owned());
    push(&mut args, playlist_path.as_os_str().to_owned());
    args
}

fn spawn_window_worker(
    session: &mut StreamSession,
    start_segment: usize,
) -> Result<(), MediaCompatError> {
    if let Some(mut old) = session.worker.take() {
        old.kill_and_cleanup();
    }
    let ffmpeg_path = ffmpeg::resolve_tool_path("ffmpeg").ok_or_else(|| {
        MediaCompatError::new(
            MediaFailureCode::ConversionDependencyMissing,
            "FFmpeg is required to stream this video.",
        )
    })?;

    let window_id = WORKER_COUNTER.fetch_add(1, Ordering::Relaxed);
    let window_dir = session.root_dir.join(format!("w_{window_id}"));
    std::fs::create_dir_all(&window_dir).map_err(|error| {
        MediaCompatError::new(
            MediaFailureCode::InsufficientStorage,
            "Could not create streaming window directory.",
        )
        .with_detail(error.to_string())
    })?;

    let start_seconds = start_segment as f64 * SEGMENT_DURATION_SECONDS;
    let remaining_segments = session.total_segments.saturating_sub(start_segment);
    let window_segments = remaining_segments.min(WINDOW_SEGMENT_COUNT).max(1);
    let window_duration = (window_segments as f64 * SEGMENT_DURATION_SECONDS)
        .min((session.duration_seconds - start_seconds).max(0.5));

    let args = build_hls_ffmpeg_args(
        &session.plan,
        &session.inspection,
        &session.source_path,
        &window_dir,
        start_seconds,
        window_duration,
    );

    let mut command = Command::new(ffmpeg_path);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let child = command.spawn().map_err(|error| {
        MediaCompatError::new(
            MediaFailureCode::ConversionFailed,
            "Could not start FFmpeg streaming worker.",
        )
        .with_detail(error.to_string())
    })?;

    session.worker = Some(ActiveWorker {
        window_id,
        start_segment,
        segment_count: window_segments,
        dir: window_dir,
        child: Some(child),
        exited: false,
    });
    Ok(())
}

async fn ensure_init_bytes(session_arc: &Arc<Mutex<StreamSession>>) -> Result<Vec<u8>, StatusCode> {
    let init_path = {
        let mut session = session_arc.lock().await;
        session.last_accessed = Instant::now();
        if session.worker.is_none() {
            if spawn_window_worker(&mut session, 0).is_err() {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
        session
            .worker
            .as_ref()
            .map(|w| w.init_path())
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?
    };

    let deadline = Instant::now() + SEGMENT_WAIT_TIMEOUT;
    loop {
        if let Ok(bytes) = tokio::fs::read(&init_path).await {
            if !bytes.is_empty() {
                return Ok(bytes);
            }
        }
        {
            let mut session = session_arc.lock().await;
            if let Some(worker) = session.worker.as_mut() {
                if worker.poll_exited() {
                    if let Ok(bytes) = tokio::fs::read(&init_path).await {
                        if !bytes.is_empty() {
                            return Ok(bytes);
                        }
                    }
                    return Err(StatusCode::BAD_GATEWAY);
                }
            }
        }
        if Instant::now() >= deadline {
            return Err(StatusCode::GATEWAY_TIMEOUT);
        }
        tokio::time::sleep(SEGMENT_POLL_INTERVAL).await;
    }
}

async fn ensure_segment_bytes(
    session_arc: &Arc<Mutex<StreamSession>>,
    index: usize,
) -> Result<Vec<u8>, StatusCode> {
    let (seg_path, next_seg_path, prev_cleanup_path, expected_window_id) = {
        let mut session = session_arc.lock().await;
        session.last_accessed = Instant::now();
        if index >= session.total_segments {
            return Err(StatusCode::NOT_FOUND);
        }
        let needs_respawn = match session.worker.as_ref() {
            Some(worker) => !worker.contains_segment(index),
            None => true,
        };
        if needs_respawn {
            if spawn_window_worker(&mut session, index).is_err() {
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
        let worker = session
            .worker
            .as_ref()
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;
        let local_idx = worker.local_index(index);
        let seg_path = worker.segment_path(local_idx);
        let next_seg_path = if local_idx + 1 < worker.segment_count {
            Some(worker.segment_path(local_idx + 1))
        } else {
            None
        };
        let prev_cleanup_path = (local_idx >= 3).then(|| worker.segment_path(local_idx - 3));
        (seg_path, next_seg_path, prev_cleanup_path, worker.window_id)
    };

    let deadline = Instant::now() + SEGMENT_WAIT_TIMEOUT;
    loop {
        let (worker_exited, window_changed) = {
            let mut session = session_arc.lock().await;
            match session.worker.as_mut() {
                Some(worker) if worker.window_id == expected_window_id => {
                    (worker.poll_exited(), false)
                }
                _ => (true, true),
            }
        };
        if window_changed {
            return Err(StatusCode::CONFLICT);
        }

        let next_ready = match next_seg_path.as_ref() {
            Some(next) => tokio::fs::try_exists(next).await.unwrap_or(false),
            None => false,
        };

        if next_ready || worker_exited {
            if let Ok(bytes) = tokio::fs::read(&seg_path).await {
                if !bytes.is_empty() {
                    if let Some(old_path) = prev_cleanup_path {
                        let _ = tokio::fs::remove_file(old_path).await;
                    }
                    return Ok(bytes);
                }
            }
            if worker_exited {
                return Err(StatusCode::BAD_GATEWAY);
            }
        }

        if Instant::now() >= deadline {
            return Err(StatusCode::GATEWAY_TIMEOUT);
        }
        tokio::time::sleep(SEGMENT_POLL_INTERVAL).await;
    }
}

async fn playlist_handler(AxumPath(session_id): AxumPath<String>) -> Response {
    let Some(session_arc) = global_manager().get_session(&session_id).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let duration = {
        let mut guard = session_arc.lock().await;
        guard.last_accessed = Instant::now();
        guard.duration_seconds
    };
    let body = build_vod_playlist(duration);
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/vnd.apple.mpegurl"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

async fn init_handler(AxumPath(session_id): AxumPath<String>) -> Response {
    let Some(session_arc) = global_manager().get_session(&session_id).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match ensure_init_bytes(&session_arc).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "video/mp4"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(status) => status.into_response(),
    }
}

async fn segment_handler(
    AxumPath((session_id, segment)): AxumPath<(String, String)>,
) -> Response {
    let Some(index_str) = segment.strip_suffix(".m4s") else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(index) = index_str.parse::<usize>() else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(session_arc) = global_manager().get_session(&session_id).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match ensure_segment_bytes(&session_arc, index).await {
        Ok(bytes) => (
            StatusCode::OK,
            [
                (header::CONTENT_TYPE, "video/iso.segment"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(status) => status.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vod_playlist_maps_duration_to_six_second_segments() {
        let playlist = build_vod_playlist(15.5);
        assert!(playlist.contains("#EXTM3U"));
        assert!(playlist.contains("#EXT-X-VERSION:7"));
        assert!(playlist.contains("#EXT-X-PLAYLIST-TYPE:VOD"));
        assert!(playlist.contains("#EXT-X-MAP:URI=\"init.mp4\""));
        assert!(playlist.contains("#EXTINF:6.000,\nseg/0.m4s\n"));
        assert!(playlist.contains("#EXTINF:6.000,\nseg/1.m4s\n"));
        assert!(playlist.contains("#EXTINF:3.500,\nseg/2.m4s\n"));
        assert!(playlist.contains("#EXT-X-ENDLIST"));
        assert_eq!(segment_count_for_duration(15.5), 3);
    }

    #[test]
    fn hls_ffmpeg_args_include_seek_and_hevc_tag() {
        let mut inspection = MediaInspection::default();
        inspection.video_streams.push(super::super::types::VideoStreamInfo {
            index: 0,
            codec: "hevc".to_string(),
            ..Default::default()
        });
        let mut plan = MediaPlaybackPlan::default();
        plan.selected_video_index = Some(0);
        plan.selected_audio_index = Some(1);
        plan.output = Some(super::super::types::OutputProfile {
            container: "mp4".to_string(),
            video: "copy".to_string(),
            audio: "copy".to_string(),
            ..Default::default()
        });
        let args = build_hls_ffmpeg_args(
            &plan,
            &inspection,
            Path::new("/movies/test.mkv"),
            Path::new("/tmp/w_1"),
            120.0,
            180.0,
        );
        let joined: Vec<String> = args
            .iter()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(joined.windows(2).any(|w| w == ["-ss", "120.000"]));
        assert!(joined.windows(2).any(|w| w == ["-output_ts_offset", "120.000"]));
        assert!(joined.windows(2).any(|w| w == ["-tag:v", "hvc1"]));
        assert!(joined.windows(2).any(|w| w == ["-hls_segment_type", "fmp4"]));
    }
}
