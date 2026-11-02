//! FFmpeg command construction, execution, and output verification.

use std::ffi::OsString;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};
use tokio::sync::mpsc;
use tokio::sync::watch;

use crate::utils::ffmpeg;
use super::probe;
use super::types::{
    JobProgress, MediaCompatError, MediaFailureCode, MediaInspection, MediaPlaybackPlan,
    PlaybackStrategy,
};

#[derive(Debug)]
pub struct FfmpegRunResult {
    pub exit_code: Option<i32>,
    pub stderr_tail: String,
    pub cancelled: bool,
}

fn push(args: &mut Vec<OsString>, value: impl Into<OsString>) {
    args.push(value.into());
}

fn ffmpeg_supports_fps_mode(version: Option<&str>) -> bool {
    let Some(version) = version else { return false };
    let token = version
        .split_whitespace()
        .find(|token| token.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
            || token.starts_with('n'))
        .unwrap_or(version);
    let token = token.trim_start_matches('n');
    let mut parts = token.split('.');
    let major = parts.next().and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    major > 5 || (major == 5 && minor >= 1)
}

fn ffmpeg_format(container: &str) -> &'static str {
    match container {
        "mp4" => "mp4",
        "webm" => "webm",
        "m4a" => "ipod",
        _ => "matroska",
    }
}

fn is_hevc(inspection: &MediaInspection, plan: &MediaPlaybackPlan) -> bool {
    plan.selected_video_index
        .and_then(|index| inspection.video_streams.iter().find(|stream| stream.index == index))
        .map(|stream| stream.codec.eq_ignore_ascii_case("hevc"))
        .unwrap_or(false)
}

fn is_dolby_vision(inspection: &MediaInspection, plan: &MediaPlaybackPlan) -> bool {
    plan.selected_video_index
        .and_then(|index| inspection.video_streams.iter().find(|stream| stream.index == index))
        .map(|stream| stream.hdr.dolby_vision.is_some())
        .unwrap_or(false)
}

/// Build the exact FFmpeg argument vector for a plan. No shell interpolation.
pub fn build_args(
    plan: &MediaPlaybackPlan,
    inspection: &MediaInspection,
    input: &Path,
    output: &Path,
) -> Vec<OsString> {
    let mut args = Vec::new();
    for value in [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-progress",
        "pipe:1",
        "-nostats",
        "-i",
    ] {
        push(&mut args, value);
    }
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
    for value in ["-sn", "-dn", "-map_chapters", "-1", "-map_metadata", "0"] {
        push(&mut args, value);
    }

    let profile = plan.output.as_ref();
    let container = profile.map(|profile| profile.container.as_str()).unwrap_or("mkv");
    let video = profile.map(|profile| profile.video.as_str()).unwrap_or("copy");
    let audio = profile.map(|profile| profile.audio.as_str()).unwrap_or("copy");

    if video == "copy" {
        push(&mut args, "-c:v");
        push(&mut args, "copy");
    } else {
        push(&mut args, "-c:v");
        push(&mut args, "libx264");
        push(&mut args, "-preset");
        push(&mut args, profile.and_then(|profile| profile.video_preset.as_deref()).unwrap_or("veryfast"));
        push(&mut args, "-crf");
        push(&mut args, profile.and_then(|profile| profile.video_crf).unwrap_or(20).to_string());
        push(&mut args, "-threads");
        let cores = std::thread::available_parallelism().map(|value| value.get()).unwrap_or(4);
        push(&mut args, cores.saturating_sub(2).clamp(1, 4).to_string());
        push(&mut args, "-pix_fmt");
        push(&mut args, "yuv420p");
        let mut filters = Vec::new();
        if profile
            .and_then(|profile| profile.tone_map.as_deref())
            == Some("hdr10_to_sdr_bt709")
        {
            filters.push(
                "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p".to_string(),
            );
        }
        if profile.and_then(|profile| profile.scale.as_deref()) == Some("max_1080p") {
            filters.push("scale=-2:1080".to_string());
        }
        if !filters.is_empty() {
            push(&mut args, "-vf");
            push(&mut args, filters.join(","));
        }
    }

    match audio {
        "copy" => {
            push(&mut args, "-c:a");
            push(&mut args, "copy");
        }
        "opus" => {
            push(&mut args, "-c:a");
            push(&mut args, "libopus");
            push(&mut args, "-b:a");
            push(&mut args, "160k");
        }
        _ => {
            push(&mut args, "-c:a");
            push(&mut args, "aac");
            push(&mut args, "-b:a");
            push(
                &mut args,
                format!("{}k", profile.and_then(|profile| profile.audio_bitrate_kbps).unwrap_or(192)),
            );
            if let Some(channels) = profile.and_then(|profile| profile.audio_channels) {
                push(&mut args, "-ac");
                push(&mut args, channels.to_string());
            }
            push(&mut args, "-ar");
            push(&mut args, "48000");
        }
    }

    push(&mut args, "-copyts");
    push(&mut args, "-start_at_zero");
    if ffmpeg_supports_fps_mode(inspection.tool.ffmpeg_version.as_deref()) {
        push(&mut args, "-fps_mode");
        push(&mut args, "passthrough");
    } else {
        push(&mut args, "-vsync");
        push(&mut args, "0");
    }

    if container == "mp4" {
        push(&mut args, "-movflags");
        push(&mut args, "+faststart");
        if video == "copy" && is_hevc(inspection, plan) {
            push(&mut args, "-tag:v");
            push(&mut args, if is_dolby_vision(inspection, plan) { "dvh1" } else { "hvc1" });
        }
    }
    push(&mut args, "-f");
    push(&mut args, ffmpeg_format(container));
    push(&mut args, output.as_os_str().to_owned());
    args
}

fn parse_progress_line(line: &str) -> Option<(String, String)> {
    let (key, value) = line.trim().split_once('=')?;
    Some((key.to_string(), value.to_string()))
}

fn progress_from(
    processed: Option<f64>,
    duration: Option<f64>,
    speed: Option<f64>,
    output_bytes: Option<u64>,
) -> JobProgress {
    let percent = match (processed, duration) {
        (Some(processed), Some(duration)) if duration > 0.0 => {
            Some(((processed / duration) * 100.0).clamp(0.0, 99.0))
        }
        _ => None,
    };
    JobProgress {
        percent,
        processed_seconds: processed,
        duration_seconds: duration,
        speed,
        output_bytes,
    }
}

async fn read_capped<R: AsyncRead + Unpin>(mut reader: R, cap: usize) -> Vec<u8> {
    let mut out = Vec::new();
    let mut reader = reader.take(cap as u64);
    let _ = reader.read_to_end(&mut out).await;
    out
}

/// Run FFmpeg, forwarding `-progress` lines and supporting cancellation.
pub async fn run(
    args: Vec<OsString>,
    duration_seconds: Option<f64>,
    mut cancel: watch::Receiver<bool>,
    progress_out: Option<mpsc::Sender<JobProgress>>,
) -> Result<FfmpegRunResult, MediaCompatError> {
    let ffmpeg_path = ffmpeg::resolve_tool_path("ffmpeg").ok_or_else(|| {
        MediaCompatError::new(
            MediaFailureCode::ConversionDependencyMissing,
            "FFmpeg is not installed.",
        )
    })?;
    let mut child = tokio::process::Command::new(ffmpeg_path)
        .args(args)
        .env("PATH", ffmpeg::enhanced_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            MediaCompatError::new(
                MediaFailureCode::ConversionDependencyMissing,
                "FFmpeg could not be started.",
            )
            .with_detail(error.to_string())
        })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        MediaCompatError::new(MediaFailureCode::ConversionFailed, "FFmpeg stdout unavailable.")
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        MediaCompatError::new(MediaFailureCode::ConversionFailed, "FFmpeg stderr unavailable.")
    })?;
    let stderr_task = tokio::spawn(read_capped(stderr, 64 * 1024));
    let (progress_tx, mut progress_rx) = mpsc::channel::<JobProgress>(32);
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut processed = None;
        let mut speed = None;
        let mut output_bytes = None;
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some((key, value)) = parse_progress_line(&line) {
                match key.as_str() {
                    "out_time_us" | "out_time_ms" => {
                        processed = value.parse::<f64>().ok().map(|value| value / 1_000_000.0);
                    }
                    "out_time" => {
                        let parts: Vec<_> = value.split(':').collect();
                        if parts.len() == 3 {
                            processed = Some(
                                parts[0].parse::<f64>().unwrap_or(0.0) * 3600.0
                                    + parts[1].parse::<f64>().unwrap_or(0.0) * 60.0
                                    + parts[2].parse::<f64>().unwrap_or(0.0),
                            );
                        }
                    }
                    "speed" => speed = value.trim_end_matches('x').parse::<f64>().ok(),
                    "total_size" => output_bytes = value.parse::<u64>().ok(),
                    _ => {}
                }
                let progress = progress_from(processed, duration_seconds, speed, output_bytes);
                if let Some(sender) = progress_out.as_ref() {
                    let _ = sender.try_send(progress.clone());
                }
                let _ = progress_tx.try_send(progress);
            }
        }
    });

    let mut cancelled = false;
    let exit = loop {
        tokio::select! {
            status = child.wait() => break status.ok(),
            changed = cancel.changed() => {
                if changed.is_ok() && *cancel.borrow() {
                    cancelled = true;
                    let _ = child.start_kill();
                }
            }
            Some(progress) = progress_rx.recv() => {
                let _ = progress;
            }
        }
    };
    let stderr = stderr_task.await.unwrap_or_default();
    let stderr_tail = String::from_utf8_lossy(&stderr)
        .lines()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    Ok(FfmpegRunResult {
        exit_code: exit.and_then(|status| status.code()),
        stderr_tail,
        cancelled,
    })
}

/// Verify the produced artifact before publication.
pub async fn verify(
    output: &Path,
    inspection: &MediaInspection,
    plan: &MediaPlaybackPlan,
) -> Result<Vec<String>, MediaCompatError> {
    let output_inspection = probe::inspect_path(output, None).await?;
    if output_inspection.probe_status != super::types::ProbeStatus::Ok {
        return Err(MediaCompatError::new(
            MediaFailureCode::ConversionVerificationFailed,
            "The prepared copy could not be inspected.",
        ));
    }
    let expected_video = plan.selected_video_index.is_some() as usize;
    let expected_audio = plan.selected_audio_index.is_some() as usize;
    if output_inspection.video_streams.len() != expected_video {
        return Err(MediaCompatError::new(
            MediaFailureCode::ConversionVerificationFailed,
            "The prepared copy has an unexpected video stream count.",
        ));
    }
    if output_inspection.audio_streams.len() != expected_audio {
        return Err(MediaCompatError::new(
            MediaFailureCode::ConversionVerificationFailed,
            "The prepared copy has an unexpected audio stream count.",
        ));
    }
    if !output_inspection.subtitle_streams.is_empty() {
        return Err(MediaCompatError::new(
            MediaFailureCode::ConversionVerificationFailed,
            "The prepared copy unexpectedly contains subtitle streams.",
        ));
    }
    if let (Some(expected), Some(actual)) = (inspection.duration_seconds, output_inspection.duration_seconds) {
        if (expected - actual).abs() > 0.75 {
            return Err(MediaCompatError::new(
                MediaFailureCode::ConversionVerificationFailed,
                "The prepared copy's duration differs from the source.",
            )
            .with_detail(format!("expected={expected:.3}s actual={actual:.3}s")));
        }
    }
    if let Some(start) = output_inspection.start_time_seconds {
        if start.abs() > 0.05 {
            return Err(MediaCompatError::new(
                MediaFailureCode::ConversionVerificationFailed,
                "The prepared copy's timeline does not start at zero.",
            )
            .with_detail(format!("start={start:.3}s")));
        }
    }

    let ffmpeg_path = ffmpeg::resolve_tool_path("ffmpeg").ok_or_else(|| {
        MediaCompatError::new(
            MediaFailureCode::ConversionDependencyMissing,
            "FFmpeg is required to verify the prepared copy.",
        )
    })?;
    let decode = tokio::time::timeout(
        Duration::from_secs(60),
        tokio::process::Command::new(ffmpeg_path)
            .args(["-v", "error", "-xerror", "-ss", "0", "-t", "2", "-i"])
            .arg(output)
            .args(["-map", "0:v:0?", "-map", "0:a:0?", "-f", "null", "-"])
            .output(),
    )
    .await;
    match decode {
        Ok(Ok(result)) if result.status.success() => {}
        _ => {
            return Err(MediaCompatError::new(
                MediaFailureCode::ConversionVerificationFailed,
                "The prepared copy could not be decoded.",
            ))
        }
    }

    Ok(vec![
        "stream_count_ok".to_string(),
        "duration_ok".to_string(),
        "zero_start_ok".to_string(),
        "decode_2s_ok".to_string(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media_compat::types::{
        MediaPlaybackPlan, OutputProfile, PlaybackStrategy, SubtitlePolicy,
    };
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/media/generated")
            .join(name)
    }

    #[tokio::test]
    async fn remux_fixture_produces_verified_output() {
        let input = fixture("mkv-h264-aac.mkv");
        if !input.exists() {
            eprintln!("skipping: generated fixture missing; run scripts/media-fixtures/generate.sh");
            return;
        }
        let inspection = probe::inspect_path(&input, None).await.expect("inspect");
        let plan = MediaPlaybackPlan {
            schema_version: 1,
            plan_id: "test".into(),
            document_id: "doc".into(),
            source_fingerprint: inspection.source.fingerprint.clone(),
            inspection_hash: "hash".into(),
            strategy: PlaybackStrategy::Remux,
            selected_video_index: Some(0),
            selected_audio_index: Some(1),
            subtitle_policy: SubtitlePolicy::StripAll,
            output: Some(OutputProfile {
                container: "mkv".into(),
                video: "copy".into(),
                audio: "copy".into(),
                ..Default::default()
            }),
            can_convert: true,
            ..Default::default()
        };
        let output_dir = std::env::temp_dir().join(format!(
            "plethora-compat-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&output_dir).expect("temp dir");
        let output = output_dir.join("output.mkv");
        let args = build_args(&plan, &inspection, &input, &output);
        let (_tx, rx) = watch::channel(false);
        let result = run(args, inspection.duration_seconds, rx, None)
            .await
            .expect("run");
        assert_eq!(result.exit_code, Some(0), "ffmpeg stderr: {}", result.stderr_tail);
        assert!(output.exists());
        let verification = verify(&output, &inspection, &plan).await.expect("verify");
        assert!(verification.contains(&"decode_2s_ok".to_string()));
        let _ = std::fs::remove_dir_all(output_dir);
    }

    #[test]
    fn remux_args_use_explicit_maps_and_strip_subtitles() {
        let plan = MediaPlaybackPlan {
            selected_video_index: Some(0),
            selected_audio_index: Some(1),
            strategy: PlaybackStrategy::Remux,
            output: Some(OutputProfile {
                container: "mkv".into(),
                video: "copy".into(),
                audio: "copy".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let args: Vec<String> = build_args(
            &plan,
            &MediaInspection::default(),
            Path::new("/tmp/in.mkv"),
            Path::new("/tmp/out.mkv"),
        )
        .into_iter()
        .map(|value| value.to_string_lossy().into_owned())
        .collect();
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:0"]));
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:1"]));
        assert!(args.contains(&"-sn".to_string()));
        assert!(args.windows(2).any(|pair| pair[0] == "-i"));
    }
}
