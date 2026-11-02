//! FFprobe-backed media inspection.
//!
//! FFprobe is the authoritative metadata source. Extension/MIME inference is
//! never used to decide codecs. If FFprobe is missing or fails, the inspection
//! records that explicitly and native playback can still be attempted.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt};
use tokio::process::Command;

use crate::utils::ffmpeg;
use super::types::{
    is_bitmap_subtitle, AudioStreamInfo, ChapterInfo, DolbyVisionInfo, HdrInfo, HdrKind,
    MediaCompatError, MediaFailureCode, MediaInspection, MediaSourceInfo, MediaToolReport,
    ProbeStatus, SubtitleKind, SubtitleStreamInfo, VideoStreamInfo,
};

const MAX_STDOUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const MAX_STREAMS: usize = 64;
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const FINGERPRINT_SAMPLE_BYTES: u64 = 64 * 1024;

#[derive(Debug, Deserialize, Default)]
struct ProbeOutput {
    #[serde(default)]
    format: Option<ProbeFormat>,
    #[serde(default)]
    streams: Vec<ProbeStream>,
    #[serde(default)]
    chapters: Vec<ProbeChapter>,
    #[serde(default)]
    error: Option<ProbeError>,
}

#[derive(Debug, Deserialize, Default)]
struct ProbeError {
    #[serde(default)]
    string: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct ProbeFormat {
    #[serde(default)]
    format_name: Option<String>,
    #[serde(default)]
    duration: Option<String>,
    #[serde(default)]
    size: Option<String>,
    #[serde(default)]
    bit_rate: Option<String>,
    #[serde(default)]
    start_time: Option<String>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Default)]
struct ProbeStream {
    #[serde(default)]
    index: i32,
    #[serde(default)]
    codec_name: Option<String>,
    #[serde(default)]
    codec_long_name: Option<String>,
    #[serde(default)]
    profile: Option<String>,
    #[serde(default)]
    level: Option<i32>,
    #[serde(default)]
    codec_type: Option<String>,
    #[serde(default)]
    codec_tag_string: Option<String>,
    #[serde(default)]
    width: Option<u32>,
    #[serde(default)]
    height: Option<u32>,
    #[serde(default)]
    coded_width: Option<u32>,
    #[serde(default)]
    coded_height: Option<u32>,
    #[serde(default)]
    pix_fmt: Option<String>,
    #[serde(default)]
    bits_per_raw_sample: Option<String>,
    #[serde(default)]
    r_frame_rate: Option<String>,
    #[serde(default)]
    avg_frame_rate: Option<String>,
    #[serde(default)]
    channels: Option<u32>,
    #[serde(default)]
    channel_layout: Option<String>,
    #[serde(default)]
    sample_rate: Option<String>,
    #[serde(default)]
    bit_rate: Option<String>,
    #[serde(default)]
    start_time: Option<String>,
    #[serde(default)]
    duration: Option<String>,
    #[serde(default)]
    color_space: Option<String>,
    #[serde(default)]
    color_transfer: Option<String>,
    #[serde(default)]
    color_primaries: Option<String>,
    #[serde(default)]
    color_range: Option<String>,
    #[serde(default)]
    disposition: HashMap<String, i32>,
    #[serde(default)]
    tags: HashMap<String, String>,
    #[serde(default)]
    side_data_list: Vec<ProbeSideData>,
}

#[derive(Debug, Deserialize, Default)]
struct ProbeSideData {
    #[serde(default)]
    side_data_type: Option<String>,
    #[serde(default)]
    dv_profile: Option<u8>,
    #[serde(default)]
    dv_level: Option<u8>,
    #[serde(default)]
    rpu_present_flag: Option<i32>,
    #[serde(default)]
    el_present_flag: Option<i32>,
    #[serde(default)]
    bl_present_flag: Option<i32>,
    #[serde(default)]
    dv_bl_signal_compatibility_id: Option<u8>,
}

#[derive(Debug, Deserialize, Default)]
struct ProbeChapter {
    #[serde(default)]
    start_time: Option<String>,
    #[serde(default)]
    end_time: Option<String>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

fn parse_f64(value: Option<&String>) -> Option<f64> {
    value.and_then(|value| value.trim().parse::<f64>().ok())
}

fn parse_u64(value: Option<&String>) -> Option<u64> {
    value.and_then(|value| value.trim().parse::<u64>().ok())
}

fn parse_u32(value: Option<&String>) -> Option<u32> {
    value.and_then(|value| value.trim().parse::<u32>().ok())
}

fn parse_rate(value: Option<&String>) -> Option<f64> {
    let value = value?.trim();
    let (num, den) = value.split_once('/')?;
    let num = num.parse::<f64>().ok()?;
    let den = den.parse::<f64>().ok()?;
    if den > 0.0 && num.is_finite() && num > 0.0 {
        Some(num / den)
    } else {
        None
    }
}

fn get_tag<'a>(tags: &'a HashMap<String, String>, key: &str) -> Option<&'a String> {
    tags.iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(key))
        .map(|(_, value)| value)
}

fn normalize_container(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("matroska") {
        "matroska".to_string()
    } else if lower.contains("webm") && !lower.contains("matroska") {
        "webm".to_string()
    } else if lower.contains("mp4") || lower.contains("mov") || lower.contains("m4a") {
        "mp4".to_string()
    } else if lower.contains("ogg") {
        "ogg".to_string()
    } else if lower.contains("avi") {
        "avi".to_string()
    } else if lower.contains("mpegts") {
        "mpegts".to_string()
    } else if lower.is_empty() {
        "unknown".to_string()
    } else {
        lower.split(',').next().unwrap_or("unknown").trim().to_string()
    }
}

fn bit_depth(stream: &ProbeStream) -> Option<u32> {
    if let Some(bits) = parse_u32(stream.bits_per_raw_sample.as_ref()) {
        return Some(bits);
    }
    let pix = stream.pix_fmt.as_deref().unwrap_or_default();
    for bits in [16, 14, 12, 10, 9] {
        if pix.contains(&format!("{bits}le")) || pix.contains(&format!("{bits}be")) {
            return Some(bits);
        }
    }
    Some(8)
}

fn subtitle_kind(codec: &str) -> SubtitleKind {
    if is_bitmap_subtitle(codec) {
        SubtitleKind::Bitmap
    } else if matches!(
        codec,
        "subrip" | "ass" | "ssa" | "webvtt" | "mov_text" | "text"
    ) {
        SubtitleKind::Text
    } else {
        SubtitleKind::Unknown
    }
}

fn parse_dv(stream: &ProbeStream) -> Option<DolbyVisionInfo> {
    let side = stream.side_data_list.iter().find(|side| {
        side.side_data_type
            .as_deref()
            .map(|kind| kind.to_ascii_lowercase().contains("dovi"))
            .unwrap_or(false)
    })?;
    let profile = side.dv_profile.unwrap_or(0);
    Some(DolbyVisionInfo {
        profile,
        level: side.dv_level.unwrap_or(0),
        rpu_present: side.rpu_present_flag.unwrap_or(0) != 0,
        el_present: side.el_present_flag.unwrap_or(0) != 0,
        bl_present: side.bl_present_flag.unwrap_or(0) != 0,
        compatibility_id: side.dv_bl_signal_compatibility_id,
        hdr10_compatible: profile == 8
            || side.dv_bl_signal_compatibility_id.unwrap_or(0) != 0,
    })
}

fn hdr_info(stream: &ProbeStream) -> HdrInfo {
    let dv = parse_dv(stream);
    let transfer = stream.color_transfer.as_deref().unwrap_or_default();
    let primaries = stream.color_primaries.as_deref().unwrap_or_default();
    let hdr10_plus = stream.side_data_list.iter().any(|side| {
        side.side_data_type
            .as_deref()
            .map(|kind| kind.to_ascii_lowercase().contains("hdr10+"))
            .unwrap_or(false)
    });
    let kind = if dv.is_some() {
        HdrKind::DolbyVision
    } else if transfer.eq_ignore_ascii_case("smpte2084") {
        HdrKind::Hdr10
    } else if transfer.eq_ignore_ascii_case("arib-std-b67") {
        HdrKind::Hlg
    } else if primaries.eq_ignore_ascii_case("bt709") || transfer.eq_ignore_ascii_case("bt709") {
        HdrKind::Sdr
    } else {
        HdrKind::Unknown
    };
    HdrInfo {
        kind,
        bt2020: primaries.eq_ignore_ascii_case("bt2020"),
        dolby_vision: dv,
        hdr10_plus,
    }
}

fn is_protected(out: &ProbeOutput) -> bool {
    let format_drm = out
        .format
        .as_ref()
        .map(|format| {
            format
                .format_name
                .as_deref()
                .map(|name| name.to_ascii_lowercase().contains("drm"))
                .unwrap_or(false)
        })
        .unwrap_or(false);
    if format_drm {
        return true;
    }
    out.streams.iter().any(|stream| {
        stream
            .codec_tag_string
            .as_deref()
            .map(|tag| tag.eq_ignore_ascii_case("encv") || tag.eq_ignore_ascii_case("enca"))
            .unwrap_or(false)
            || stream.side_data_list.iter().any(|side| {
                side.side_data_type
                    .as_deref()
                    .map(|kind| kind.to_ascii_lowercase().contains("encryption"))
                    .unwrap_or(false)
            })
    })
}

async fn read_capped<R: AsyncRead + Unpin>(reader: R, cap: usize) -> Vec<u8> {
    let mut buffer = Vec::with_capacity(cap.min(64 * 1024));
    let mut reader = reader.take(cap as u64);
    let _ = reader.read_to_end(&mut buffer).await;
    buffer
}

fn parse_media_inspection(
    document_id: Option<String>,
    source: MediaSourceInfo,
    out: ProbeOutput,
    tool: MediaToolReport,
) -> MediaInspection {
    let container_raw = out
        .format
        .as_ref()
        .and_then(|format| format.format_name.clone());
    let container = container_raw.as_deref().map(normalize_container);
    let size_bytes = source.size_bytes;
    let start_time_seconds = out
        .format
        .as_ref()
        .and_then(|format| parse_f64(format.start_time.as_ref()));
    let duration_seconds = out
        .format
        .as_ref()
        .and_then(|format| parse_f64(format.duration.as_ref()));
    let bit_rate = out
        .format
        .as_ref()
        .and_then(|format| parse_u64(format.bit_rate.as_ref()));

    let mut warnings = Vec::new();
    if out.streams.len() > MAX_STREAMS {
        warnings.push("stream_count_truncated".to_string());
    }
    let protected = is_protected(&out);

    let mut video_streams = Vec::new();
    let mut audio_streams = Vec::new();
    let mut subtitle_streams = Vec::new();
    for stream in out.streams.into_iter().take(MAX_STREAMS) {
        let codec = stream.codec_name.clone().unwrap_or_default();
        let disposition_default = stream.disposition.get("default").copied().unwrap_or(0) != 0;
        let language = get_tag(&stream.tags, "language").cloned();
        let title = get_tag(&stream.tags, "title").cloned();
        match stream.codec_type.as_deref() {
            Some("video") => video_streams.push(VideoStreamInfo {
                index: stream.index,
                codec,
                codec_long_name: stream.codec_long_name.clone(),
                profile: stream.profile.clone(),
                level: stream.level,
                width: stream.width,
                height: stream.height,
                coded_width: stream.coded_width,
                coded_height: stream.coded_height,
                pixel_format: stream.pix_fmt.clone(),
                bit_depth: bit_depth(&stream),
                frame_rate: parse_rate(stream.r_frame_rate.as_ref()),
                avg_frame_rate: parse_rate(stream.avg_frame_rate.as_ref()),
                codec_tag: stream.codec_tag_string.clone(),
                is_attached_pic: stream.disposition.get("attached_pic").copied().unwrap_or(0) != 0,
                is_default: disposition_default,
                language,
                title,
                color_space: stream.color_space.clone(),
                color_transfer: stream.color_transfer.clone(),
                color_primaries: stream.color_primaries.clone(),
                color_range: stream.color_range.clone(),
                hdr: hdr_info(&stream),
                start_time_seconds: parse_f64(stream.start_time.as_ref()),
                duration_seconds: parse_f64(stream.duration.as_ref()),
                bit_rate: parse_u64(stream.bit_rate.as_ref()),
            }),
            Some("audio") => audio_streams.push(AudioStreamInfo {
                index: stream.index,
                codec,
                profile: stream.profile.clone(),
                channels: stream.channels,
                channel_layout: stream.channel_layout.clone(),
                sample_rate: parse_u32(stream.sample_rate.as_ref()),
                bit_depth: parse_u32(stream.bits_per_raw_sample.as_ref()),
                bit_rate: parse_u64(stream.bit_rate.as_ref()),
                language,
                title,
                is_default: disposition_default,
                is_commentary: stream.disposition.get("commentary").copied().unwrap_or(0) != 0,
            }),
            Some("subtitle") => subtitle_streams.push(SubtitleStreamInfo {
                index: stream.index,
                kind: subtitle_kind(&codec),
                codec,
                language,
                title,
                is_default: disposition_default,
                is_forced: stream.disposition.get("forced").copied().unwrap_or(0) != 0,
            }),
            _ => {}
        }
    }

    let chapters = out
        .chapters
        .into_iter()
        .filter_map(|chapter| {
            let start = parse_f64(chapter.start_time.as_ref())?;
            Some(ChapterInfo {
                start_seconds: start,
                end_seconds: parse_f64(chapter.end_time.as_ref()),
                title: get_tag(&chapter.tags, "title").cloned(),
            })
        })
        .collect();

    MediaInspection {
        schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
        document_id,
        source,
        probe_status: ProbeStatus::Ok,
        probe_error: None,
        container,
        container_raw,
        duration_seconds,
        start_time_seconds,
        bit_rate,
        size_bytes,
        video_streams,
        audio_streams,
        subtitle_streams,
        chapters,
        is_protected: protected,
        warnings,
        tool,
    }
}

pub async fn tool_report() -> MediaToolReport {
    let ffmpeg_path = ffmpeg::resolve_tool_path("ffmpeg");
    let ffprobe_path = ffmpeg::resolve_ffprobe_path();
    let ffmpeg_version = match ffmpeg_path.as_deref() {
        Some(path) => ffmpeg::tool_version(path).await,
        None => None,
    };
    let ffprobe_version = match ffprobe_path.as_deref() {
        Some(path) => ffmpeg::tool_version(path).await,
        None => None,
    };
    MediaToolReport {
        ffprobe_available: ffprobe_path.is_some(),
        ffmpeg_available: ffmpeg_path.is_some(),
        ffprobe_version,
        ffmpeg_version,
    }
}

async fn file_metadata(path: &Path) -> Option<(u64, Option<i64>)> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);
    Some((metadata.len(), modified))
}

async fn file_sample(path: &Path, size: u64) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut file = tokio::fs::File::open(path).await.ok()?;
    let sample = FINGERPRINT_SAMPLE_BYTES.min(size);
    let mut head = vec![0u8; sample as usize];
    file.read_exact(&mut head).await.ok()?;
    let tail = if size > sample {
        let start = size.saturating_sub(sample);
        file.seek(std::io::SeekFrom::Start(start)).await.ok()?;
        let mut tail = vec![0u8; sample as usize];
        file.read_exact(&mut tail).await.ok()?;
        tail
    } else {
        head.clone()
    };
    Some((head, tail))
}

/// Cheap source version fingerprint: size + mtime + sampled head/tail bytes.
pub async fn source_fingerprint(path: &Path) -> Result<(String, Option<u64>, Option<i64>), MediaCompatError> {
    let (size, modified) = file_metadata(path).await.ok_or_else(|| {
        MediaCompatError::new(
            MediaFailureCode::SourceNotFound,
            "The media file could not be read.",
        )
    })?;
    let (head, tail) = file_sample(path, size).await.ok_or_else(|| {
        MediaCompatError::new(
            MediaFailureCode::SourcePermissionDenied,
            "The media file could not be sampled.",
        )
    })?;
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());
    hasher.update(modified.unwrap_or(0).to_le_bytes());
    hasher.update((head.len() as u64).to_le_bytes());
    hasher.update(&head);
    hasher.update(&tail);
    let fingerprint = hex::encode(hasher.finalize());
    Ok((fingerprint, Some(size), modified))
}

fn path_label(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("<unnamed>")
        .to_string()
}

fn path_hash(path: &Path) -> String {
    hex::encode(Sha256::digest(path.to_string_lossy().as_bytes()))[..12].to_string()
}

async fn source_info(path: &Path, fingerprint: String, size: Option<u64>, modified: Option<i64>) -> MediaSourceInfo {
    MediaSourceInfo {
        path_label: path_label(path),
        path_hash: path_hash(path),
        size_bytes: size,
        modified_unix_ms: modified,
        fingerprint,
    }
}

async fn run_ffprobe(path: &Path) -> Result<ProbeOutput, MediaCompatError> {
    let ffprobe = ffmpeg::resolve_ffprobe_path().ok_or_else(|| {
        MediaCompatError::new(
            MediaFailureCode::MediaInspectionUnavailable,
            "FFprobe is not installed.",
        )
        .with_detail("ffprobe_missing")
    })?;

    let mut child = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-show_chapters",
            "-show_error",
            "-i",
        ])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            MediaCompatError::new(
                MediaFailureCode::MediaInspectionUnavailable,
                "FFprobe could not be started.",
            )
            .with_detail(error.to_string())
        })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        MediaCompatError::new(
            MediaFailureCode::MediaInspectionUnavailable,
            "FFprobe stdout was unavailable.",
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        MediaCompatError::new(
            MediaFailureCode::MediaInspectionUnavailable,
            "FFprobe stderr was unavailable.",
        )
    })?;
    let stdout_task = tokio::spawn(read_capped(stdout, MAX_STDOUT_BYTES));
    let stderr_task = tokio::spawn(read_capped(stderr, MAX_STDERR_BYTES));

    let status = match tokio::time::timeout(PROBE_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => {
            let _ = child.start_kill();
            return Err(MediaCompatError::new(
                MediaFailureCode::MediaInspectionUnavailable,
                "FFprobe failed while reading the file.",
            )
            .with_detail(error.to_string()));
        }
        Err(_) => {
            let _ = child.start_kill();
            return Err(MediaCompatError::new(
                MediaFailureCode::MediaInspectionUnavailable,
                "FFprobe timed out while reading the file.",
            )
            .with_detail("probe_timeout"));
        }
    };

    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr);
        return Err(MediaCompatError::new(
            MediaFailureCode::MediaInspectionUnavailable,
            "FFprobe could not inspect this media file.",
        )
        .with_detail(redact_detail(&detail)));
    }
    if stdout.len() >= MAX_STDOUT_BYTES {
        return Err(MediaCompatError::new(
            MediaFailureCode::MediaInspectionUnavailable,
            "FFprobe output was too large.",
        )
        .with_detail("probe_output_too_large"));
    }
    let output: ProbeOutput = serde_json::from_slice(&stdout).map_err(|error| {
        MediaCompatError::new(
            MediaFailureCode::MediaInspectionUnavailable,
            "FFprobe returned invalid metadata.",
        )
        .with_detail(error.to_string())
    })?;
    if let Some(error) = output.error.as_ref().and_then(|error| error.string.clone()) {
        if !error.trim().is_empty() {
            return Err(MediaCompatError::new(
                MediaFailureCode::MediaCorrupt,
                "FFprobe reported an invalid media file.",
            )
            .with_detail(redact_detail(&error)));
        }
    }
    Ok(output)
}

fn redact_detail(value: &str) -> String {
    // Keep the tail bounded and collapse path-like prefixes. FFprobe errors
    // normally name the file; the UI/diagnostics only need the reason.
    value
        .lines()
        .last()
        .unwrap_or(value)
        .chars()
        .take(512)
        .collect()
}

/// Inspect a canonical, already-authorized local file.
pub async fn inspect_path(
    path: &Path,
    document_id: Option<String>,
) -> Result<MediaInspection, MediaCompatError> {
    let tool = tool_report().await;
    let (fingerprint, size, modified) = source_fingerprint(path).await?;
    let source = source_info(path, fingerprint, size, modified).await;

    if !tool.ffprobe_available {
        return Ok(MediaInspection {
            schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
            document_id,
            source,
            probe_status: ProbeStatus::Unavailable,
            probe_error: Some("ffprobe_missing".to_string()),
            tool,
            ..Default::default()
        });
    }

    match run_ffprobe(path).await {
        Ok(output) => Ok(parse_media_inspection(document_id, source, output, tool)),
        Err(error) => Ok(MediaInspection {
            schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
            document_id,
            source,
            probe_status: ProbeStatus::Failed,
            probe_error: Some(error.detail.unwrap_or(error.message)),
            tool,
            ..Default::default()
        }),
    }
}
