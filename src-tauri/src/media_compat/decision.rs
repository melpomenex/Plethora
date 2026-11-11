//! Pure compatibility planning.
//!
//! The planner is deterministic: given inspection, runtime/declared capability,
//! policy, and optional failure evidence, it chooses the least expensive
//! reliable strategy. It never re-encodes video for a subtitle-only problem.

use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::types::{
    AudioStreamInfo, CachedArtifact, CapabilityLevel, CompatibilityMode, ConversionEstimate,
    ConversionQuality, DeclaredCodecSupport, HdrInfo, HdrKind, MediaFailureCode, MediaInspection,
    MediaPlaybackPlan, MediaProcessingPolicy, OutputProfile, PlanConfidence, PlatformKind,
    PlaybackRecoveryContext, PlaybackStrategy, SubtitlePolicy, VideoStreamInfo,
};

fn merge_level(a: CapabilityLevel, b: CapabilityLevel) -> CapabilityLevel {
    if a == CapabilityLevel::Supported || b == CapabilityLevel::Supported {
        CapabilityLevel::Supported
    } else if a == CapabilityLevel::Unsupported || b == CapabilityLevel::Unsupported {
        CapabilityLevel::Unsupported
    } else {
        CapabilityLevel::Unknown
    }
}

fn codec_support(
    capabilities: &super::types::MediaRuntimeCapabilities,
    declared: &DeclaredCodecSupport,
    codec: &str,
    audio: bool,
) -> CapabilityLevel {
    let runtime = if audio {
        capabilities
            .decoders
            .get(codec)
            .copied()
            .unwrap_or(CapabilityLevel::Unknown)
    } else {
        capabilities
            .decoders
            .get(codec)
            .copied()
            .unwrap_or(CapabilityLevel::Unknown)
    };
    let declared_level = match codec {
        "h264" => declared.h264,
        "hevc" => declared.hevc,
        "av1" => declared.av1,
        "vp9" => declared.vp9,
        "aac" => declared.aac,
        "ac3" => declared.ac3,
        "eac3" => declared.eac3,
        "dts" => declared.dts,
        "truehd" => declared.truehd,
        "opus" => declared.opus,
        "flac" => declared.flac,
        "mp3" => declared.mp3,
        "vorbis" => declared.vorbis,
        _ => CapabilityLevel::Unknown,
    };
    // The Linux GStreamer registry is a strong negative: a declared
    // `canPlayType("probably")` cannot make a missing decoder factory appear.
    if capabilities.platform == PlatformKind::Linux
        && capabilities
            .gstreamer
            .as_ref()
            .map(|report| report.inspect_available)
            .unwrap_or(false)
    {
        match runtime {
            CapabilityLevel::Supported => return CapabilityLevel::Supported,
            CapabilityLevel::Unsupported => return CapabilityLevel::Unsupported,
            CapabilityLevel::Unknown => {}
        }
    }
    merge_level(runtime, declared_level)
}

fn is_matroska(container: &str) -> bool {
    container.eq_ignore_ascii_case("matroska") || container.eq_ignore_ascii_case("mkv")
}

fn container_support(
    capabilities: &super::types::MediaRuntimeCapabilities,
    declared: &DeclaredCodecSupport,
    container: Option<&str>,
) -> CapabilityLevel {
    let Some(container) = container else {
        return CapabilityLevel::Unknown;
    };
    let runtime = capabilities
        .demuxers
        .get(container)
        .copied()
        .unwrap_or(CapabilityLevel::Unknown);
    let declared_level = declared
        .containers
        .get(container)
        .copied()
        .unwrap_or(CapabilityLevel::Unknown);
    if capabilities.platform == PlatformKind::Linux
        && capabilities
            .gstreamer
            .as_ref()
            .map(|report| report.inspect_available)
            .unwrap_or(false)
    {
        match runtime {
            CapabilityLevel::Supported => return CapabilityLevel::Supported,
            CapabilityLevel::Unsupported => return CapabilityLevel::Unsupported,
            CapabilityLevel::Unknown => {}
        }
    }
    merge_level(runtime, declared_level)
}

pub fn select_video(inspection: &MediaInspection) -> Option<&VideoStreamInfo> {
    inspection
        .video_streams
        .iter()
        .find(|stream| !stream.is_attached_pic && stream.is_default)
        .or_else(|| {
            inspection
                .video_streams
                .iter()
                .find(|stream| !stream.is_attached_pic)
        })
}

pub fn select_audio(inspection: &MediaInspection) -> Option<&AudioStreamInfo> {
    inspection
        .audio_streams
        .iter()
        .find(|stream| stream.is_default)
        .or_else(|| inspection.audio_streams.first())
}

fn has_bitmap_subtitles(inspection: &MediaInspection) -> bool {
    inspection
        .subtitle_streams
        .iter()
        .any(|stream| stream.kind == super::types::SubtitleKind::Bitmap)
}

fn hdr_of(video: &VideoStreamInfo) -> HdrInfo {
    video.hdr.clone()
}

fn is_hdr(hdr: &HdrInfo) -> bool {
    matches!(
        hdr.kind,
        HdrKind::Hdr10 | HdrKind::Hlg | HdrKind::DolbyVision
    )
}

fn container_can_hold(container: &str, video: &str, audio: &str) -> bool {
    let video_ok = match container {
        "mp4" => matches!(video, "h264" | "hevc" | "av1"),
        "webm" => matches!(video, "vp8" | "vp9" | "av1"),
        "mkv" | "matroska" => matches!(video, "h264" | "hevc" | "av1" | "vp9" | "vp8"),
        _ => false,
    };
    let audio_ok = match audio {
        "none" => true,
        "mp4" => matches!(audio, "aac" | "mp3" | "ac3" | "eac3"),
        _ => false,
    };
    let audio_ok = if container == "mp4" {
        audio_ok
    } else if container == "webm" {
        matches!(audio, "opus" | "vorbis" | "none")
    } else if container == "mkv" || container == "matroska" {
        matches!(
            audio,
            "aac" | "ac3" | "eac3" | "dts" | "truehd" | "flac" | "opus" | "vorbis" | "mp3" | "none"
        )
    } else {
        false
    };
    video_ok && audio_ok
}

fn choose_container(
    source_container: Option<&str>,
    source_supported: bool,
    video: &str,
    audio: &str,
) -> Option<String> {
    if let Some(source) = source_container {
        if source_supported && container_can_hold(source, video, audio) {
            return Some(if is_matroska(source) {
                "mkv".to_string()
            } else {
                source.to_string()
            });
        }
    }
    if video == "copy" {
        return None;
    }
    if container_can_hold("mp4", video, audio) {
        return Some("mp4".to_string());
    }
    if container_can_hold("webm", video, audio) {
        return Some("webm".to_string());
    }
    if source_supported {
        if let Some(source) = source_container {
            if container_can_hold(source, video, audio) {
                return Some(if is_matroska(source) {
                    "mkv".to_string()
                } else {
                    source.to_string()
                });
            }
        }
    }
    None
}

fn audio_target_for_container(container: &str, _source_codec: &str) -> String {
    if container == "webm" {
        "opus".to_string()
    } else {
        "aac".to_string()
    }
}

fn target_bitrate(height: u32, quality: ConversionQuality) -> u64 {
    match (height > 1080, quality) {
        (false, ConversionQuality::Balanced) => 6_000_000,
        (false, ConversionQuality::Quality) => 10_000_000,
        (true, ConversionQuality::Balanced) => 20_000_000,
        (true, ConversionQuality::Quality) => 35_000_000,
    }
}

fn estimate_output_floor(
    inspection: &MediaInspection,
    strategy: PlaybackStrategy,
    quality: ConversionQuality,
    selected_video: Option<&VideoStreamInfo>,
) -> u64 {
    let source_bytes = inspection.size_bytes.unwrap_or(0);
    match strategy {
        PlaybackStrategy::Remux | PlaybackStrategy::AudioTranscode => source_bytes.max(1),
        PlaybackStrategy::VideoTranscode => {
            let duration = inspection.duration_seconds.unwrap_or(0.0).max(1.0);
            let height = selected_video
                .and_then(|video| video.height)
                .unwrap_or(1080);
            ((duration * target_bitrate(height, quality) as f64 / 8.0) * 1.15) as u64
                + 256 * 1024 * 1024
        }
        PlaybackStrategy::Native | PlaybackStrategy::Unavailable => 0,
    }
}

fn plan_limitations(
    inspection: &MediaInspection,
    strategy: PlaybackStrategy,
    hdr: &HdrInfo,
    output: Option<&OutputProfile>,
) -> Vec<String> {
    let mut limitations = Vec::new();
    if !inspection.subtitle_streams.is_empty() && strategy != PlaybackStrategy::Native {
        limitations.push("subtitles_not_rendered".to_string());
    }
    if strategy == PlaybackStrategy::VideoTranscode && is_hdr(hdr) {
        limitations.push("hdr_converted_to_sdr".to_string());
        if hdr.hdr10_plus {
            limitations.push("hdr10_plus_metadata_not_preserved".to_string());
        }
    }
    if hdr.dolby_vision.is_some() && strategy != PlaybackStrategy::Native {
        limitations.push("dolby_vision_signalling_not_preserved".to_string());
    }
    if matches!(
        strategy,
        PlaybackStrategy::VideoTranscode | PlaybackStrategy::AudioTranscode
    ) && inspection
        .audio_streams
        .iter()
        .find(|stream| stream.is_default)
        .or_else(|| inspection.audio_streams.first())
        .and_then(|stream| stream.channels)
        .map(|channels| channels > 6)
        .unwrap_or(false)
    {
        limitations.push("audio_downmixed_to_5_1".to_string());
    }
    if output
        .map(|profile| profile.scale.as_deref() == Some("max_1080p"))
        .unwrap_or(false)
    {
        limitations.push("resolution_reduced".to_string());
    }
    limitations
}

fn base_confidence(
    capabilities: &super::types::MediaRuntimeCapabilities,
    container: CapabilityLevel,
    video: CapabilityLevel,
    audio: CapabilityLevel,
) -> PlanConfidence {
    if capabilities.platform == PlatformKind::Linux && capabilities.gstreamer.is_some() {
        if container == CapabilityLevel::Unknown
            || video == CapabilityLevel::Unknown
            || audio == CapabilityLevel::Unknown
        {
            PlanConfidence::Indeterminate
        } else {
            PlanConfidence::Certain
        }
    } else if video == CapabilityLevel::Unknown || audio == CapabilityLevel::Unknown {
        PlanConfidence::Indeterminate
    } else {
        PlanConfidence::Probable
    }
}

pub fn inspection_hash(inspection: &MediaInspection) -> String {
    let mut clone = inspection.clone();
    clone.source.path_hash.clear();
    clone.source.path_label.clear();
    clone.source.modified_unix_ms = None;
    clone.tool = Default::default();
    clone.document_id = None;
    let bytes = serde_json::to_vec(&clone).unwrap_or_default();
    hex::encode(Sha256::digest(bytes))
}

#[allow(clippy::too_many_arguments)]
pub fn plan(
    document_id: &str,
    inspection: &MediaInspection,
    capabilities: &super::types::MediaRuntimeCapabilities,
    declared: &DeclaredCodecSupport,
    policy: MediaProcessingPolicy,
    recovery: Option<&PlaybackRecoveryContext>,
    cached_artifact: Option<CachedArtifact>,
) -> MediaPlaybackPlan {
    let selected_video = select_video(inspection);
    let selected_audio = select_audio(inspection);
    let hdr = selected_video.map(hdr_of).unwrap_or_default();
    let source_container = inspection.container.as_deref();
    let container_level = container_support(capabilities, declared, source_container);
    let video_codec = selected_video
        .map(|video| video.codec.as_str())
        .unwrap_or("");
    let audio_codec = selected_audio
        .map(|audio| audio.codec.as_str())
        .unwrap_or("");
    let video_level = selected_video
        .map(|video| codec_support(capabilities, declared, &video.codec, false))
        .unwrap_or(CapabilityLevel::Unknown);
    let audio_level = selected_audio
        .map(|audio| codec_support(capabilities, declared, &audio.codec, true))
        .unwrap_or(CapabilityLevel::Supported);

    let mut reasons = Vec::new();
    let mut limitations = Vec::new();
    let mut consent_reasons = Vec::new();
    let mut unavailable_reason = None;

    if inspection.is_protected {
        return unavailable_plan(
            document_id,
            inspection,
            policy,
            vec!["protected_media".to_string()],
            "unsupported_protected_media",
            None,
            None,
            None,
        );
    }
    if inspection.probe_status == super::types::ProbeStatus::Failed {
        return unavailable_plan(
            document_id,
            inspection,
            policy,
            vec!["media_corrupt".to_string()],
            "media_corrupt",
            None,
            None,
            None,
        );
    }

    let linux_bitmap =
        capabilities.platform == PlatformKind::Linux && has_bitmap_subtitles(inspection);
    if linux_bitmap {
        reasons.push("bitmap_subtitles_present".to_string());
    }
    if inspection
        .video_streams
        .iter()
        .any(|stream| stream.is_attached_pic)
    {
        reasons.push("attached_picture_ignored".to_string());
    }
    if selected_audio
        .map(|audio| audio.is_default)
        .unwrap_or(false)
    {
        reasons.push("multi_audio_default_selected".to_string());
    }
    if selected_audio.is_none() {
        reasons.push("no_audio_stream".to_string());
    }
    if selected_video.is_none() {
        reasons.push("no_video_stream".to_string());
    }

    let container_ok = container_level != CapabilityLevel::Unsupported;
    let video_ok = video_level != CapabilityLevel::Unsupported;
    let audio_ok = audio_level != CapabilityLevel::Unsupported;
    let subtitle_ok = !linux_bitmap;

    let mut strategy = if video_ok && audio_ok && container_ok && subtitle_ok {
        PlaybackStrategy::Native
    } else if video_ok && audio_ok && (!container_ok || !subtitle_ok) {
        PlaybackStrategy::Remux
    } else if video_ok && !audio_ok {
        PlaybackStrategy::AudioTranscode
    } else if !video_ok && selected_video.is_some() {
        PlaybackStrategy::VideoTranscode
    } else {
        PlaybackStrategy::Unavailable
    };

    if let Some(recovery) = recovery {
        reasons.push("native_failed".to_string());
        match recovery.failure_code {
            Some(MediaFailureCode::BitmapSubtitleUnsupported) => {
                strategy = PlaybackStrategy::Remux;
            }
            Some(MediaFailureCode::AudioDecoderUnavailable) => {
                strategy = PlaybackStrategy::AudioTranscode;
            }
            Some(MediaFailureCode::VideoDecoderUnavailable)
            | Some(MediaFailureCode::DecoderInitializationFailed) => {
                strategy = PlaybackStrategy::VideoTranscode;
            }
            Some(MediaFailureCode::ContainerUnsupported) => {
                strategy = PlaybackStrategy::Remux;
            }
            Some(MediaFailureCode::MediaCompatibilityIndeterminate) => {
                strategy = if source_container == Some("mkv") {
                    PlaybackStrategy::Remux
                } else {
                    PlaybackStrategy::VideoTranscode
                };
            }
            Some(MediaFailureCode::MediaCorrupt)
            | Some(MediaFailureCode::UnsupportedProtectedMedia) => {
                return unavailable_plan(
                    document_id,
                    inspection,
                    policy,
                    reasons,
                    if recovery.failure_code == Some(MediaFailureCode::MediaCorrupt) {
                        "media_corrupt"
                    } else {
                        "unsupported_protected_media"
                    },
                    None,
                    None,
                    None,
                );
            }
            _ => {}
        }
    }

    if strategy == PlaybackStrategy::VideoTranscode
        && hdr
            .dolby_vision
            .as_ref()
            .map(|dv| dv.profile == 5)
            .unwrap_or(false)
    {
        return unavailable_plan(
            document_id,
            inspection,
            policy,
            reasons,
            "dolby_vision_profile5",
            selected_video,
            selected_audio,
            None,
        );
    }

    if strategy == PlaybackStrategy::Unavailable && selected_video.is_none() {
        return unavailable_plan(
            document_id,
            inspection,
            policy,
            reasons,
            "no_video_stream",
            None,
            None,
            None,
        );
    }

    let mut output: Option<OutputProfile> = None;
    let mut can_convert =
        strategy != PlaybackStrategy::Native && strategy != PlaybackStrategy::Unavailable;

    if can_convert {
        let (target_audio, target_container) = match strategy {
            PlaybackStrategy::Remux => ("copy", source_container.unwrap_or("mkv")),
            PlaybackStrategy::AudioTranscode => ("aac", source_container.unwrap_or("mp4")),
            PlaybackStrategy::VideoTranscode => ("aac", "mp4"),
            _ => ("copy", source_container.unwrap_or("mkv")),
        };
        let source_supported = container_level == CapabilityLevel::Supported;
        let mut audio = if strategy == PlaybackStrategy::AudioTranscode {
            audio_target_for_container(target_container, audio_codec)
        } else {
            target_audio.to_string()
        };
        let mut container = if strategy == PlaybackStrategy::VideoTranscode {
            if source_supported
                && source_container
                    .map(|source| container_can_hold(source, "h264", audio_codec))
                    .unwrap_or(false)
            {
                source_container
                    .map(|source| {
                        if is_matroska(source) {
                            "mkv".to_string()
                        } else {
                            source.to_string()
                        }
                    })
                    .unwrap_or_else(|| "mp4".to_string())
            } else {
                "mp4".to_string()
            }
        } else if strategy == PlaybackStrategy::AudioTranscode {
            choose_container(source_container, source_supported, video_codec, &audio)
                .unwrap_or_else(|| target_container.to_string())
        } else {
            choose_container(source_container, source_supported, video_codec, audio_codec)
                .unwrap_or_else(|| target_container.to_string())
        };
        if strategy == PlaybackStrategy::VideoTranscode {
            if audio_level == CapabilityLevel::Supported
                && container_can_hold(&container, "h264", audio_codec)
            {
                audio = "copy".to_string();
            } else if !container_can_hold(&container, "h264", &audio) {
                // Fall back to MP4/AAC if the chosen container cannot hold the
                // copied audio or the requested audio target.
                container = "mp4".to_string();
                audio = "aac".to_string();
            }
        }
        if strategy == PlaybackStrategy::AudioTranscode
            && !container_can_hold(&container, video_codec, &audio)
        {
            // No valid container can hold copied video + converted audio;
            // promote to a full video transcode.
            strategy = PlaybackStrategy::VideoTranscode;
            container = "mp4".to_string();
            audio = "aac".to_string();
        }
        if strategy == PlaybackStrategy::Remux
            && !container_can_hold(&container, video_codec, audio_codec)
        {
            strategy = PlaybackStrategy::VideoTranscode;
            container = "mp4".to_string();
            audio = "aac".to_string();
        }
        let target_container_level = if Some(container.as_str()) == source_container
            || (source_container.map(is_matroska).unwrap_or(false) && container == "mkv")
        {
            container_level
        } else {
            container_support(capabilities, declared, Some(container.as_str()))
        };
        if target_container_level == CapabilityLevel::Unsupported {
            strategy = PlaybackStrategy::VideoTranscode;
            container = "mp4".to_string();
            audio = "aac".to_string();
        }

        let tone_map = if strategy == PlaybackStrategy::VideoTranscode && is_hdr(&hdr) {
            if !capabilities.ffmpeg.has_zscale || !capabilities.ffmpeg.has_tonemap {
                return unavailable_plan(
                    document_id,
                    inspection,
                    policy,
                    reasons,
                    "conversion_filter_missing",
                    selected_video,
                    selected_audio,
                    None,
                );
            }
            consent_reasons.push("hdr_tone_mapping".to_string());
            limitations.push("hdr_converted_to_sdr".to_string());
            Some("hdr10_to_sdr_bt709".to_string())
        } else {
            None
        };

        let height = selected_video
            .and_then(|video| video.height)
            .unwrap_or(1080);
        let scale = if strategy == PlaybackStrategy::VideoTranscode
            && policy.quality == ConversionQuality::Balanced
            && height > 1080
        {
            limitations.push("resolution_reduced".to_string());
            Some("max_1080p".to_string())
        } else {
            None
        };
        let channels = selected_audio
            .and_then(|audio| audio.channels)
            .map(|channels| channels.min(6));
        output = Some(OutputProfile {
            container: container.clone(),
            video: if strategy == PlaybackStrategy::VideoTranscode {
                "h264".to_string()
            } else {
                "copy".to_string()
            },
            audio,
            scale,
            tone_map,
            video_crf: (strategy == PlaybackStrategy::VideoTranscode).then(|| {
                if policy.quality == ConversionQuality::Quality {
                    18
                } else {
                    20
                }
            }),
            video_preset: (strategy == PlaybackStrategy::VideoTranscode).then(|| {
                if policy.quality == ConversionQuality::Quality {
                    "medium".to_string()
                } else {
                    "veryfast".to_string()
                }
            }),
            audio_bitrate_kbps: Some(match channels.unwrap_or(2) {
                1 => 128,
                2 => 192,
                _ => 384,
            }),
            audio_channels: channels,
            hardware: Some(
                if policy.hardware_acceleration == super::types::HardwareAcceleration::Off {
                    "software".to_string()
                } else {
                    "auto".to_string()
                },
            ),
        });

        let required_tool = capabilities.ffmpeg.available && capabilities.ffmpeg.ffprobe_available;
        if !required_tool {
            can_convert = false;
            unavailable_reason = Some(if !capabilities.ffmpeg.ffprobe_available {
                "ffprobe_missing".to_string()
            } else {
                "ffmpeg_missing".to_string()
            });
        } else if strategy == PlaybackStrategy::VideoTranscode
            && !capabilities.ffmpeg.has_libx264
            && capabilities.ffmpeg.hardware_encoders.is_empty()
        {
            can_convert = false;
            unavailable_reason = Some("encoder_missing".to_string());
        }

        let floor = estimate_output_floor(inspection, strategy, policy.quality, selected_video);
        let cache_limit = u64::from(policy.cache_limit_gb) * 1024 * 1024 * 1024;
        if can_convert && floor > cache_limit {
            can_convert = false;
            unavailable_reason = Some("cache_limit_too_small".to_string());
        }

        if can_convert {
            if policy.mode == CompatibilityMode::Never {
                can_convert = false;
                unavailable_reason = Some("policy_never".to_string());
            }
            let expensive_video = strategy == PlaybackStrategy::VideoTranscode
                && (inspection.duration_seconds.unwrap_or(0.0) > 600.0
                    || height > 1080
                    || is_hdr(&hdr));
            if policy.mode == CompatibilityMode::Ask
                || (policy.mode == CompatibilityMode::AutomaticInexpensive && expensive_video)
            {
                if strategy == PlaybackStrategy::VideoTranscode {
                    consent_reasons.push("video_transcode".to_string());
                }
            }
        }

        let estimate = ConversionEstimate {
            source_bytes: inspection.size_bytes,
            duration_seconds: inspection.duration_seconds,
            output_bytes_floor: Some(floor),
            free_space_required_bytes: Some(floor.saturating_add(1024 * 1024 * 1024)),
            cache_fits: Some(floor <= cache_limit),
        };
        limitations.extend(plan_limitations(
            inspection,
            strategy,
            &hdr,
            output.as_ref(),
        ));
        limitations.sort();
        limitations.dedup();
        consent_reasons.sort();
        consent_reasons.dedup();

        return MediaPlaybackPlan {
            schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
            plan_id: Uuid::new_v4().to_string(),
            document_id: document_id.to_string(),
            source_fingerprint: inspection.source.fingerprint.clone(),
            inspection_hash: inspection_hash(inspection),
            strategy,
            confidence: base_confidence(capabilities, container_level, video_level, audio_level),
            reasons,
            selected_video_index: selected_video.map(|video| video.index),
            selected_audio_index: selected_audio.map(|audio| audio.index),
            subtitle_policy: if strategy == PlaybackStrategy::Native {
                SubtitlePolicy::Keep
            } else {
                SubtitlePolicy::StripAll
            },
            output,
            requires_consent: !consent_reasons.is_empty(),
            consent_reasons,
            limitations,
            cached_artifact,
            can_convert,
            unavailable_reason,
            estimated: estimate,
        };
    }

    if strategy == PlaybackStrategy::Native {
        if inspection
            .subtitle_streams
            .iter()
            .all(|stream| stream.kind != super::types::SubtitleKind::Bitmap)
        {
            limitations.extend(plan_limitations(inspection, strategy, &hdr, None));
        }
        return MediaPlaybackPlan {
            schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
            plan_id: Uuid::new_v4().to_string(),
            document_id: document_id.to_string(),
            source_fingerprint: inspection.source.fingerprint.clone(),
            inspection_hash: inspection_hash(inspection),
            strategy,
            confidence: base_confidence(capabilities, container_level, video_level, audio_level),
            reasons,
            selected_video_index: selected_video.map(|video| video.index),
            selected_audio_index: selected_audio.map(|audio| audio.index),
            subtitle_policy: SubtitlePolicy::Keep,
            output: None,
            requires_consent: false,
            consent_reasons: Vec::new(),
            limitations,
            cached_artifact,
            can_convert: false,
            unavailable_reason: None,
            estimated: ConversionEstimate::default(),
        };
    }

    unavailable_plan(
        document_id,
        inspection,
        policy,
        reasons,
        unavailable_reason
            .as_deref()
            .unwrap_or("platform_unsupported"),
        selected_video,
        selected_audio,
        cached_artifact,
    )
}

#[allow(clippy::too_many_arguments)]
fn unavailable_plan(
    document_id: &str,
    inspection: &MediaInspection,
    policy: MediaProcessingPolicy,
    reasons: Vec<String>,
    unavailable_reason: &str,
    selected_video: Option<&VideoStreamInfo>,
    selected_audio: Option<&AudioStreamInfo>,
    cached_artifact: Option<CachedArtifact>,
) -> MediaPlaybackPlan {
    MediaPlaybackPlan {
        schema_version: super::types::MEDIA_COMPAT_SCHEMA_VERSION,
        plan_id: Uuid::new_v4().to_string(),
        document_id: document_id.to_string(),
        source_fingerprint: inspection.source.fingerprint.clone(),
        inspection_hash: inspection_hash(inspection),
        strategy: PlaybackStrategy::Unavailable,
        confidence: PlanConfidence::Indeterminate,
        reasons,
        selected_video_index: selected_video.map(|video| video.index),
        selected_audio_index: selected_audio.map(|audio| audio.index),
        subtitle_policy: SubtitlePolicy::StripAll,
        output: None,
        requires_consent: false,
        consent_reasons: Vec::new(),
        limitations: Vec::new(),
        cached_artifact,
        can_convert: false,
        unavailable_reason: Some(unavailable_reason.to_string()),
        estimated: ConversionEstimate {
            source_bytes: inspection.size_bytes,
            duration_seconds: inspection.duration_seconds,
            output_bytes_floor: Some(estimate_output_floor(
                inspection,
                PlaybackStrategy::Remux,
                policy.quality,
                selected_video,
            )),
            free_space_required_bytes: inspection
                .size_bytes
                .map(|bytes| bytes.saturating_add(1024 * 1024 * 1024)),
            cache_fits: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media_compat::types::{
        CapabilityLevel, EngineKind, FfmpegCapabilities, GStreamerReport, HdrInfo, HdrKind,
        MediaRuntimeCapabilities, MediaSourceInfo, MediaToolReport, PlatformKind, ProbeStatus,
        SubtitleStreamInfo,
    };

    fn inspection(video_codec: &str, audio_codec: &str, bitmap_subs: bool) -> MediaInspection {
        MediaInspection {
            schema_version: 1,
            source: MediaSourceInfo {
                path_label: "movie.mkv".into(),
                path_hash: "hash".into(),
                size_bytes: Some(1000),
                modified_unix_ms: Some(0),
                fingerprint: "fp".into(),
            },
            probe_status: ProbeStatus::Ok,
            container: Some("matroska".into()),
            duration_seconds: Some(100.0),
            video_streams: vec![VideoStreamInfo {
                index: 0,
                codec: video_codec.into(),
                is_attached_pic: false,
                is_default: true,
                hdr: HdrInfo {
                    kind: HdrKind::Sdr,
                    ..Default::default()
                },
                ..Default::default()
            }],
            audio_streams: vec![AudioStreamInfo {
                index: 1,
                codec: audio_codec.into(),
                channels: Some(6),
                is_default: false,
                ..Default::default()
            }],
            subtitle_streams: if bitmap_subs {
                vec![SubtitleStreamInfo {
                    index: 2,
                    codec: "hdmv_pgs_subtitle".into(),
                    kind: crate::media_compat::types::SubtitleKind::Bitmap,
                    is_default: true,
                    ..Default::default()
                }]
            } else {
                Vec::new()
            },
            tool: MediaToolReport {
                ffprobe_available: true,
                ffmpeg_available: true,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn capabilities(platform: PlatformKind) -> MediaRuntimeCapabilities {
        MediaRuntimeCapabilities {
            schema_version: 1,
            platform,
            engine: if platform == PlatformKind::Linux {
                EngineKind::Webkitgtk
            } else {
                EngineKind::AndroidWebview
            },
            evidence: vec!["gstreamer_registry".into()],
            runtime_fingerprint: "rt".into(),
            checked_at: "now".into(),
            decoders: [
                ("hevc".to_string(), CapabilityLevel::Supported),
                ("h264".to_string(), CapabilityLevel::Supported),
                ("dts".to_string(), CapabilityLevel::Supported),
                ("aac".to_string(), CapabilityLevel::Supported),
            ]
            .into_iter()
            .collect(),
            demuxers: [
                ("matroska".to_string(), CapabilityLevel::Supported),
                ("mp4".to_string(), CapabilityLevel::Supported),
            ]
            .into_iter()
            .collect(),
            ffmpeg: FfmpegCapabilities {
                available: true,
                ffprobe_available: true,
                has_libx264: true,
                has_aac: true,
                has_zscale: true,
                has_tonemap: true,
                ..Default::default()
            },
            gstreamer: Some(GStreamerReport {
                inspect_available: true,
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn declared() -> DeclaredCodecSupport {
        DeclaredCodecSupport {
            h264: CapabilityLevel::Supported,
            hevc: CapabilityLevel::Supported,
            aac: CapabilityLevel::Supported,
            dts: CapabilityLevel::Supported,
            containers: [
                ("matroska".to_string(), CapabilityLevel::Supported),
                ("mp4".to_string(), CapabilityLevel::Supported),
            ]
            .into_iter()
            .collect(),
            ..Default::default()
        }
    }

    fn policy() -> MediaProcessingPolicy {
        MediaProcessingPolicy {
            mode: CompatibilityMode::AutomaticInexpensive,
            quality: ConversionQuality::Balanced,
            hardware_acceleration: super::super::types::HardwareAcceleration::Off,
            cache_limit_gb: 25,
        }
    }

    #[test]
    fn reported_shape_selects_lossless_subtitle_strip_remux() {
        let plan = plan(
            "doc",
            &inspection("hevc", "dts", true),
            &capabilities(PlatformKind::Linux),
            &declared(),
            policy(),
            None,
            None,
        );
        assert_eq!(plan.strategy, PlaybackStrategy::Remux);
        assert_eq!(plan.subtitle_policy, SubtitlePolicy::StripAll);
        assert!(plan.can_convert);
        assert_eq!(plan.output.as_ref().unwrap().video, "copy");
        assert_eq!(plan.output.as_ref().unwrap().audio, "copy");
        assert!(!plan.requires_consent);
    }

    #[test]
    fn unsupported_audio_preserves_video() {
        let mut caps = capabilities(PlatformKind::Linux);
        caps.decoders
            .insert("dts".into(), CapabilityLevel::Unsupported);
        let plan = plan(
            "doc",
            &inspection("hevc", "dts", false),
            &caps,
            &declared(),
            policy(),
            None,
            None,
        );
        assert_eq!(plan.strategy, PlaybackStrategy::AudioTranscode);
        assert_eq!(plan.output.as_ref().unwrap().video, "copy");
        assert_eq!(plan.output.as_ref().unwrap().audio, "aac");
    }

    #[test]
    fn unsupported_video_selects_full_transcode() {
        let mut caps = capabilities(PlatformKind::Linux);
        caps.decoders
            .insert("hevc".into(), CapabilityLevel::Unsupported);
        let plan = plan(
            "doc",
            &inspection("hevc", "aac", false),
            &caps,
            &declared(),
            policy(),
            None,
            None,
        );
        assert_eq!(plan.strategy, PlaybackStrategy::VideoTranscode);
        assert_eq!(plan.output.as_ref().unwrap().video, "h264");
    }

    #[test]
    fn bitmap_on_android_does_not_preempt_native() {
        let mut caps = capabilities(PlatformKind::Android);
        caps.decoders
            .insert("hevc".into(), CapabilityLevel::Unknown);
        caps.decoders.insert("dts".into(), CapabilityLevel::Unknown);
        let plan = plan(
            "doc",
            &inspection("hevc", "dts", true),
            &caps,
            &declared(),
            policy(),
            None,
            None,
        );
        assert_eq!(plan.strategy, PlaybackStrategy::Native);
    }
}
