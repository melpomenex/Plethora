//! Runtime playback capability detection.
//!
//! Linux/WebKitGTK delegates demux/decode to GStreamer, so the element registry
//! is the strongest available evidence. Windows/macOS do not expose a stable
//! decoder registry to the app in P1; the frontend supplies exact-codec
//! `canPlayType()` declarations and real playback evidence. Unknown is never
//! collapsed into unsupported.

use std::collections::HashMap;
use std::process::Stdio;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tokio::process::Command;
use tokio::sync::{Mutex, OnceCell};

use crate::utils::ffmpeg;
use super::types::{
    CapabilityLevel, EncoderCapability, EngineKind, FfmpegCapabilities, GStreamerReport,
    MediaRuntimeCapabilities, PlatformKind,
};

const CAPABILITY_TTL: Duration = Duration::from_secs(10 * 60);
static CAP_CACHE: OnceCell<Mutex<Option<(Instant, MediaRuntimeCapabilities)>>> = OnceCell::const_new();

fn platform() -> PlatformKind {
    if cfg!(target_os = "linux") {
        PlatformKind::Linux
    } else if cfg!(target_os = "macos") {
        PlatformKind::Macos
    } else if cfg!(target_os = "windows") {
        PlatformKind::Windows
    } else if cfg!(target_os = "android") {
        PlatformKind::Android
    } else if cfg!(target_os = "ios") {
        PlatformKind::Ios
    } else {
        PlatformKind::Unknown
    }
}

fn engine() -> EngineKind {
    match platform() {
        PlatformKind::Linux => EngineKind::Webkitgtk,
        PlatformKind::Macos | PlatformKind::Ios => EngineKind::Wkwebview,
        PlatformKind::Windows => EngineKind::Webview2,
        PlatformKind::Android => EngineKind::AndroidWebview,
        PlatformKind::Web => EngineKind::Browser,
        PlatformKind::Unknown => EngineKind::Unknown,
    }
}

fn has_element(elements: &[String], names: &[&str]) -> bool {
    elements
        .iter()
        .any(|element| names.iter().any(|name| element == name))
}

#[cfg(target_os = "linux")]
async fn detect_gstreamer() -> (Option<GStreamerReport>, Vec<String>) {
    let mut warnings = Vec::new();
    let Some(path) = ffmpeg::resolve_tool_path("gst-inspect-1.0") else {
        warnings.push("gst_inspect_unavailable".to_string());
        return (None, warnings);
    };

    let output = tokio::time::timeout(
        Duration::from_secs(10),
        Command::new(path)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;
    // `--version` is only a cheap availability check; the element listing is
    // the actual detection pass.
    if !matches!(output, Ok(Ok(result)) if result.status.success()) {
        warnings.push("gst_inspect_failed".to_string());
        return (None, warnings);
    }

    let Some(path) = ffmpeg::resolve_tool_path("gst-inspect-1.0") else {
        return (None, warnings);
    };
    let listing = tokio::time::timeout(
        Duration::from_secs(10),
        Command::new(path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;
    let listing = match listing {
        Ok(Ok(result)) if result.status.success() => result.stdout,
        _ => {
            warnings.push("gst_inspect_listing_failed".to_string());
            return (None, warnings);
        }
    };
    let text = String::from_utf8_lossy(&listing);
    let mut found_elements = Vec::new();
    for line in text.lines() {
        // `matroska:  matroskademux: Matroska demuxer`
        let mut parts = line.split_whitespace();
        let _plugin = parts.next();
        let Some(element) = parts.next() else { continue };
        let element = element.trim_end_matches(':');
        if !element.is_empty() && !element.contains(':') {
            found_elements.push(element.to_string());
        }
    }
    found_elements.sort();
    found_elements.dedup();

    let mut plugin_dirs = Vec::new();
    for key in ["GST_PLUGIN_PATH", "GST_PLUGIN_SYSTEM_PATH_1_0", "GST_PLUGIN_SYSTEM_PATH"] {
        if let Some(value) = std::env::var_os(key) {
            for path in std::env::split_paths(&value) {
                if !path.as_os_str().is_empty() {
                    plugin_dirs.push(path.to_string_lossy().to_string());
                }
            }
        }
    }
    plugin_dirs.sort();
    plugin_dirs.dedup();
    let registry = std::env::var("GST_REGISTRY").ok();

    (
        Some(GStreamerReport {
            inspect_available: true,
            plugin_dirs,
            registry,
            plugin_set_id: None,
            found_elements,
        }),
        warnings,
    )
}

#[cfg(not(target_os = "linux"))]
async fn detect_gstreamer() -> (Option<GStreamerReport>, Vec<String>) {
    (None, Vec::new())
}

fn cap(elements: &[String], names: &[&str], registry_available: bool) -> CapabilityLevel {
    if !registry_available {
        return CapabilityLevel::Unknown;
    }
    if has_element(elements, names) {
        CapabilityLevel::Supported
    } else {
        CapabilityLevel::Unsupported
    }
}

fn collect_gstreamer_capabilities(
    report: &Option<GStreamerReport>,
    decoders: &mut HashMap<String, CapabilityLevel>,
    demuxers: &mut HashMap<String, CapabilityLevel>,
    subtitle_support: &mut HashMap<String, CapabilityLevel>,
) {
    let Some(report) = report else {
        for key in [
            "h264", "hevc", "av1", "vp9", "mpeg2video", "vc1", "wmv3", "mpeg4",
            "aac", "ac3", "eac3", "dts", "truehd", "opus", "flac", "mp3", "mp2", "vorbis",
        ] {
            decoders.insert(key.to_string(), CapabilityLevel::Unknown);
        }
        for key in ["matroska", "mp4", "webm", "ogg", "avi", "mpegts"] {
            demuxers.insert(key.to_string(), CapabilityLevel::Unknown);
        }
        return;
    };
    let elements = &report.found_elements;
    let available = report.inspect_available;
    for (key, names) in [
        ("h264", vec!["avdec_h264", "openh264dec", "vah264dec", "vaapih264dec", "vulkanh264dec", "nvh264dec"]),
        ("hevc", vec!["avdec_h265", "libde265dec", "vah265dec", "vaapih265dec", "vulkanh265dec", "nvh265dec"]),
        ("av1", vec!["avdec_av1", "dav1ddec", "vaav1dec", "vulkanav1dec", "nvav1dec"]),
        ("vp9", vec!["avdec_vp9", "vp9dec", "vavp9dec", "vaapivp9dec"]),
        ("mpeg2video", vec!["avdec_mpeg2video", "mpeg2dec"]),
        ("vc1", vec!["avdec_vc1"]),
        ("wmv3", vec!["avdec_wmv3"]),
        ("mpeg4", vec!["avdec_mpeg4"]),
        ("aac", vec!["avdec_aac", "faad", "fdkaacdec"]),
        ("ac3", vec!["avdec_ac3", "a52dec"]),
        ("eac3", vec!["avdec_eac3"]),
        ("dts", vec!["avdec_dca", "dtsdec"]),
        ("truehd", vec!["avdec_truehd", "avdec_mlp"]),
        ("opus", vec!["opusdec", "avdec_opus"]),
        ("flac", vec!["flacdec", "avdec_flac"]),
        ("mp3", vec!["mpg123audiodec", "avdec_mp3", "mad"]),
        ("mp2", vec!["avdec_mp2", "mpg123audiodec"]),
        ("vorbis", vec!["vorbisdec", "avdec_vorbis"]),
    ] {
        decoders.insert(key.to_string(), cap(elements, &names, available));
    }
    for (key, names) in [
        ("matroska", vec!["matroskademux"]),
        ("mp4", vec!["qtdemux"]),
        ("webm", vec!["matroskademux"]),
        ("ogg", vec!["oggdemux"]),
        ("avi", vec!["avidemux"]),
        ("mpegts", vec!["tsdemux"]),
    ] {
        demuxers.insert(key.to_string(), cap(elements, &names, available));
    }
    subtitle_support.insert("text".to_string(), CapabilityLevel::Supported);
    // Bitmap subtitle caps are not a playback support signal on WebKitGTK; the
    // HTML media pipeline rejected subpicture/x-pgs even with decoders present.
    subtitle_support.insert("bitmap".to_string(), CapabilityLevel::Unsupported);
    subtitle_support.insert("hdmv_pgs_subtitle".to_string(), CapabilityLevel::Unsupported);
    subtitle_support.insert("dvd_subtitle".to_string(), CapabilityLevel::Unsupported);
    subtitle_support.insert("dvb_subtitle".to_string(), CapabilityLevel::Unsupported);
}

async fn tool_output(path: &std::path::Path, args: &[&str]) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(10),
        Command::new(path).args(args).output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

async fn detect_ffmpeg() -> (FfmpegCapabilities, HashMap<String, EncoderCapability>, Vec<String>) {
    let mut warnings = Vec::new();
    let ffmpeg_path = ffmpeg::resolve_tool_path("ffmpeg");
    let ffprobe_path = ffmpeg::resolve_ffprobe_path();
    let version = match ffmpeg_path.as_deref() {
        Some(path) => ffmpeg::tool_version(path).await,
        None => None,
    };
    let mut capabilities = FfmpegCapabilities {
        available: ffmpeg_path.is_some(),
        ffprobe_available: ffprobe_path.is_some(),
        version,
        ..Default::default()
    };
    let mut encoders = HashMap::new();
    if let Some(path) = ffmpeg_path.as_deref() {
        let encoder_text = tool_output(path, &["-hide_banner", "-encoders"]).await.unwrap_or_default();
        let filter_text = tool_output(path, &["-hide_banner", "-filters"]).await.unwrap_or_default();
        capabilities.has_libx264 = encoder_text.contains("libx264");
        capabilities.has_aac = encoder_text.contains(" aac ");
        capabilities.has_zscale = filter_text.contains("zscale");
        capabilities.has_tonemap = filter_text.contains("tonemap");
        for candidate in [
            "h264_videotoolbox",
            "h264_nvenc",
            "h264_qsv",
            "h264_amf",
        ] {
            let present = encoder_text.contains(candidate);
            if present {
                capabilities.hardware_encoders.push(candidate.to_string());
            }
            encoders.insert(
                candidate.to_string(),
                EncoderCapability {
                    level: if present { CapabilityLevel::Supported } else { CapabilityLevel::Unknown },
                    factory: present.then(|| candidate.to_string()),
                    hardware: true,
                    canary: None,
                },
            );
        }
        encoders.insert(
            "libx264".to_string(),
            EncoderCapability {
                level: if capabilities.has_libx264 { CapabilityLevel::Supported } else { CapabilityLevel::Unsupported },
                factory: capabilities.has_libx264.then(|| "libx264".to_string()),
                hardware: false,
                canary: Some(capabilities.has_libx264),
            },
        );
        encoders.insert(
            "aac".to_string(),
            EncoderCapability {
                level: if capabilities.has_aac { CapabilityLevel::Supported } else { CapabilityLevel::Unsupported },
                factory: capabilities.has_aac.then(|| "aac".to_string()),
                hardware: false,
                canary: Some(capabilities.has_aac),
            },
        );
    } else {
        warnings.push("ffmpeg_unavailable".to_string());
    }
    (capabilities, encoders, warnings)
}

fn runtime_fingerprint(
    platform: PlatformKind,
    engine: EngineKind,
    capabilities: &MediaRuntimeCapabilities,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{platform:?}|{engine:?}"));
    hasher.update(capabilities.ffmpeg.version.as_deref().unwrap_or(""));
    hasher.update(
        capabilities
            .gstreamer
            .as_ref()
            .and_then(|report| report.plugin_set_id.as_deref())
            .unwrap_or(""),
    );
    if let Some(gstreamer) = capabilities.gstreamer.as_ref() {
        for path in &gstreamer.plugin_dirs {
            hasher.update(path);
        }
        hasher.update(gstreamer.found_elements.join(","));
    }
    hex::encode(hasher.finalize())
}

async fn detect_uncached() -> MediaRuntimeCapabilities {
    let platform = platform();
    let engine = engine();
    let mut warnings = Vec::new();
    let (gstreamer, gst_warnings) = detect_gstreamer().await;
    warnings.extend(gst_warnings);
    let mut decoders = HashMap::new();
    let mut demuxers = HashMap::new();
    let mut subtitle_support = HashMap::new();
    collect_gstreamer_capabilities(&gstreamer, &mut decoders, &mut demuxers, &mut subtitle_support);
    let (ffmpeg_caps, encoders, ff_warnings) = detect_ffmpeg().await;
    warnings.extend(ff_warnings);

    let mut capabilities = MediaRuntimeCapabilities {
        schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
        platform,
        engine,
        engine_version: None,
        evidence: Vec::new(),
        runtime_fingerprint: String::new(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        decoders,
        demuxers,
        subtitle_support,
        encoders,
        ffmpeg: ffmpeg_caps,
        gstreamer,
        warnings,
    };
    capabilities.evidence = if capabilities
        .gstreamer
        .as_ref()
        .map(|report| report.inspect_available)
        .unwrap_or(false)
    {
        vec!["gstreamer_registry".to_string()]
    } else {
        vec!["none".to_string()]
    };
    if capabilities.ffmpeg.available || capabilities.ffmpeg.ffprobe_available {
        capabilities.evidence.push("ffmpeg_tools".to_string());
    }
    capabilities.runtime_fingerprint = runtime_fingerprint(platform, engine, &capabilities);
    capabilities
}

pub async fn detect(refresh: bool) -> MediaRuntimeCapabilities {
    let cache = CAP_CACHE
        .get_or_init(|| async { Mutex::new(None) })
        .await;
    let mut guard = cache.lock().await;
    if !refresh {
        if let Some((checked, capabilities)) = guard.as_ref() {
            if checked.elapsed() < CAPABILITY_TTL {
                return capabilities.clone();
            }
        }
    }
    let capabilities = detect_uncached().await;
    *guard = Some((Instant::now(), capabilities.clone()));
    capabilities
}
