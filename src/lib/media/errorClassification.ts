import type {
  CapabilityLevel,
  DeclaredCodecSupport,
  MediaFailureAction,
  MediaFailureCode,
  MediaInspection,
  MediaPlaybackFailure,
  MediaPlaybackPlan,
  MediaRuntimeCapabilities,
  MediaTransportProbe,
} from "./types";

export interface PlaybackFailureInput {
  mediaErrorCode?: number;
  playErrorName?: string;
  playErrorMessage?: string;
  transport?: MediaTransportProbe | null;
  inspection?: MediaInspection | null;
  capabilities?: MediaRuntimeCapabilities | null;
  declared?: DeclaredCodecSupport | null;
  plan?: MediaPlaybackPlan | null;
  strategy?: string;
  aborted?: boolean;
  timedOut?: boolean;
  jobErrorCode?: MediaFailureCode | null;
}

const MESSAGE_KEY = (code: MediaFailureCode) => `mediaCompatibility.failure.${code}`;

function actionsFor(code: MediaFailureCode, canConvert: boolean): MediaFailureAction[] {
  switch (code) {
    case "source_not_found":
      return ["reimport", "show_details"];
    case "source_permission_denied":
      return ["retry", "show_details"];
    case "source_server_unavailable":
    case "source_transport_failed":
      return ["retry", "show_details"];
    case "source_range_invalid":
      return ["retry", "show_details"];
    case "source_empty":
      return ["reimport", "show_details"];
    case "container_unsupported":
    case "video_decoder_unavailable":
    case "audio_decoder_unavailable":
    case "bitmap_subtitle_unsupported":
    case "decoder_initialization_failed":
      return canConvert ? ["convert", "try_original", "show_details"] : ["try_original", "show_details"];
    case "media_corrupt":
    case "unsupported_protected_media":
      return ["show_details"];
    case "media_inspection_unavailable":
      return ["try_original", "show_details"];
    case "media_compatibility_indeterminate":
      return canConvert ? ["try_original", "convert", "show_details"] : ["try_original", "show_details"];
    case "conversion_dependency_missing":
      return ["install_help", "retry", "show_details"];
    case "conversion_encoder_missing":
    case "conversion_filter_missing":
      return ["retry", "show_details"];
    case "conversion_failed":
    case "conversion_verification_failed":
    case "conversion_cancelled":
      return ["retry", "show_details"];
    case "conversion_requires_consent":
      return ["convert", "show_details"];
    case "conversion_in_progress":
      return ["show_details"];
    case "conversion_queue_full":
      return ["retry", "show_details"];
    case "insufficient_storage":
      return ["manage_cache", "retry", "show_details"];
    case "dolby_vision_unsupported":
      return ["show_details"];
    case "conversion_platform_unsupported":
      return ["show_details"];
    case "playback_interrupted":
      return ["resume", "retry", "show_details"];
    default:
      return ["retry", "show_details"];
  }
}

function failure(
  code: MediaFailureCode,
  input: PlaybackFailureInput,
  detail?: string,
  retryable = true,
): MediaPlaybackFailure {
  const canConvert = Boolean(input.plan?.canConvert);
  return {
    code,
    messageKey: MESSAGE_KEY(code),
    detail,
    retryable,
    actions: actionsFor(code, canConvert),
    evidence: {
      mediaErrorCode: input.mediaErrorCode,
      playErrorName: input.playErrorName,
      strategy: input.strategy,
      httpStatus: input.transport?.status ?? undefined,
      transportReachable: input.transport?.reachable,
      transportError: input.transport?.error ?? undefined,
      container: input.inspection?.container ?? undefined,
      videoCodec: firstVideoCodec(input.inspection),
      audioCodec: firstAudioCodec(input.inspection),
      subtitleKinds: input.inspection?.subtitleStreams.map((stream) => stream.kind),
      platform: input.capabilities?.platform,
      engine: input.capabilities?.engine,
      planStrategy: input.plan?.strategy,
    },
  };
}

function firstVideoCodec(inspection?: MediaInspection | null): string | undefined {
  return inspection?.videoStreams.find((stream) => !stream.isAttachedPic)?.codec;
}

function firstAudioCodec(inspection?: MediaInspection | null): string | undefined {
  const audio = inspection?.audioStreams;
  if (!audio?.length) return undefined;
  return (audio.find((stream) => stream.isDefault) ?? audio[0]).codec;
}

function declaredLevel(
  input: PlaybackFailureInput,
  key: string,
): CapabilityLevel {
  const declared = input.declared;
  if (!declared) return "unknown";
  switch (key) {
    case "h264": return declared.h264;
    case "hevc": return declared.hevc;
    case "av1": return declared.av1;
    case "vp9": return declared.vp9;
    case "aac": return declared.aac;
    case "ac3": return declared.ac3;
    case "eac3": return declared.eac3;
    case "dts": return declared.dts;
    case "truehd": return declared.truehd;
    case "opus": return declared.opus;
    case "flac": return declared.flac;
    case "mp3": return declared.mp3;
    case "vorbis": return declared.vorbis;
    default: return "unknown";
  }
}

function support(
  input: PlaybackFailureInput,
  kind: "decoders" | "demuxers",
  key: string | undefined | null,
): CapabilityLevel {
  if (!key) return "unknown";
  const declared = declaredLevel(input, key);
  const runtime = input.capabilities?.[kind]?.[key];
  if (declared === "supported" || runtime === "supported") return "supported";
  if (declared === "unsupported" || runtime === "unsupported") return "unsupported";
  return "unknown";
}

function transportFailure(input: PlaybackFailureInput): MediaPlaybackFailure | null {
  const probe = input.transport;
  if (!probe) return null;
  if (!probe.reachable) {
    const error = (probe.error ?? "").toLowerCase();
    const code: MediaFailureCode =
      /refused|connect|unreachable|dns|not running/.test(error)
        ? "source_server_unavailable"
        : "source_transport_failed";
    return failure(code, input, probe.error ?? undefined);
  }
  if (probe.status === 401 || probe.status === 403) {
    return failure("source_permission_denied", input, `HTTP ${probe.status}`);
  }
  if (probe.status === 404 || probe.status === 410) {
    return failure("source_not_found", input, `HTTP ${probe.status}`);
  }
  if (probe.status === 416) {
    return failure("source_range_invalid", input, "HTTP 416");
  }
  if (probe.status && probe.status >= 500) {
    return failure("source_transport_failed", input, `HTTP ${probe.status}`);
  }
  if ((probe.status === 200 || probe.status === 206) && probe.contentLength === 0) {
    return failure("source_empty", input, "empty media response");
  }
  if (probe.error === "probe_empty_body") {
    return failure("source_empty", input, "empty media response");
  }
  return null;
}

function codecEvidenceFailure(input: PlaybackFailureInput): MediaPlaybackFailure | null {
  const inspection = input.inspection;
  if (!inspection) return null;

  if (inspection.isProtected) {
    return failure("unsupported_protected_media", input, "protected_media");
  }
  if (inspection.probeStatus === "failed") {
    return failure("media_corrupt", input, inspection.probeError ?? "probe_failed", false);
  }

  const linux = input.capabilities?.platform === "linux";
  if (linux && inspection.subtitleStreams.some((stream) => stream.kind === "bitmap")) {
    return failure("bitmap_subtitle_unsupported", input, "bitmap_subtitles_present");
  }

  if (support(input, "demuxers", inspection.container) === "unsupported") {
    return failure("container_unsupported", input, inspection.container ?? undefined);
  }

  const video = inspection.videoStreams.find((stream) => !stream.isAttachedPic);
  if (video && support(input, "decoders", video.codec) === "unsupported") {
    return failure("video_decoder_unavailable", input, video.codec);
  }

  const audio = inspection.audioStreams.find((stream) => stream.isDefault) ?? inspection.audioStreams[0];
  if (audio && support(input, "decoders", audio.codec) === "unsupported") {
    return failure("audio_decoder_unavailable", input, audio.codec);
  }

  const anySupported =
    (video && support(input, "decoders", video.codec) === "supported") ||
    (audio && support(input, "decoders", audio.codec) === "supported");
  if (anySupported) {
    return failure("decoder_initialization_failed", input, "engine_refused_supported_streams");
  }

  return null;
}

/**
 * Classify a local-video playback failure from explicit evidence.
 *
 * Source-access codes require transport evidence. MediaError 4 is never
 * sufficient by itself: it may be a bitmap subtitle, container, decoder,
 * corrupt-media, or indeterminate failure.
 */
export function classifyPlaybackFailure(input: PlaybackFailureInput): MediaPlaybackFailure {
  if (input.jobErrorCode) {
    return failure(input.jobErrorCode, input, "conversion_job_error");
  }
  if (input.aborted) {
    return failure("playback_interrupted", input, "aborted", false);
  }

  const transport = transportFailure(input);
  if (transport) return transport;

  if (input.timedOut) {
    return failure("media_compatibility_indeterminate", input, "probe_timeout");
  }

  if (input.mediaErrorCode === 1) {
    return failure("playback_interrupted", input, "media_err_aborted", false);
  }
  if (input.mediaErrorCode === 2) {
    return failure("source_transport_failed", input, "media_err_network");
  }
  if (input.mediaErrorCode === 3) {
    const evidence = codecEvidenceFailure(input);
    if (evidence) return evidence;
    return failure("decoder_initialization_failed", input, "media_err_decode");
  }

  const isUnsupported =
    input.mediaErrorCode === 4 ||
    input.playErrorName === "NotSupportedError" ||
    /not supported/i.test(input.playErrorMessage ?? "");
  if (isUnsupported) {
    const evidence = codecEvidenceFailure(input);
    if (evidence) return evidence;
    if (input.inspection?.probeStatus === "ok") {
      return failure("media_compatibility_indeterminate", input, "engine_refused_inspected_media");
    }
    return failure("media_compatibility_indeterminate", input, "insufficient_evidence");
  }

  if (input.playErrorName === "AbortError") {
    return failure("playback_interrupted", input, "abort_error", false);
  }

  return failure("unknown", input, input.playErrorMessage);
}
