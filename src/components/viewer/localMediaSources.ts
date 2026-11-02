import { classifyPlaybackFailure } from "../../lib/media/errorClassification";
import type { MediaFailureCode } from "../../lib/media/types";

export type LocalMediaType = "video" | "audio";

export type LocalMediaFailureKind =
  | "source-access"
  | "unsupported-format"
  | "decode"
  | "aborted"
  | "unknown";

export interface LocalMediaSourceCandidate {
  src: string;
  mimeType?: string;
  strategy?: string;
  label?: string;
  alreadyPlayable?: boolean;
}

export interface LocalMediaSourceDescriptor {
  sources: LocalMediaSourceCandidate[];
}

export type LocalMediaSourceInput =
  | string
  | LocalMediaSourceCandidate
  | LocalMediaSourceDescriptor;

export interface LocalMediaProbeFailure {
  kind: LocalMediaFailureKind;
  message: string;
  mediaErrorCode?: number;
  mimeTypeSupport?: CanPlayTypeResult;
  /** Evidence-backed code when available; legacy consumers can ignore it. */
  code?: MediaFailureCode;
  indeterminate?: boolean;
}

export interface LocalMediaProbeResult {
  ok: boolean;
  candidate: LocalMediaSourceCandidate;
  failure?: LocalMediaProbeFailure;
}

/**
 * Browsers can temporarily report 0, NaN, or Infinity while indexing media
 * metadata (notably downloaded MP4 files). Only publish a usable runtime.
 */
export function getFiniteMediaDuration(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeCandidate(
  candidate: LocalMediaSourceCandidate,
  index: number,
): LocalMediaSourceCandidate {
  return {
    ...candidate,
    strategy: candidate.strategy || candidate.label || `source-${index + 1}`,
  };
}

export function normalizeLocalMediaSources(
  input: LocalMediaSourceInput,
): LocalMediaSourceCandidate[] {
  if (typeof input === "string") {
    return [{ src: input, strategy: "direct-url" }];
  }

  if ("sources" in input) {
    return input.sources
      .filter((candidate) => Boolean(candidate?.src))
      .map(normalizeCandidate);
  }

  if ("src" in input && input.src) {
    return [normalizeCandidate(input, 0)];
  }

  return [];
}

export function getLocalMediaSourceKey(
  sources: LocalMediaSourceCandidate[],
): string {
  return sources
    .map((candidate) => [
      candidate.src,
      candidate.mimeType || "",
      candidate.strategy || "",
      candidate.alreadyPlayable ? "1" : "0",
    ].join("|"))
    .join("||");
}

export function getMimeTypeSupport(
  mediaType: LocalMediaType,
  mimeType?: string,
): CanPlayTypeResult {
  if (typeof document === "undefined" || !mimeType) {
    return "";
  }

  const media = document.createElement(mediaType);
  return media.canPlayType(mimeType);
}

/**
 * Legacy wrapper over the evidence-based classifier.
 *
 * This function cannot prove source access on its own: callers that have a
 * transport probe must use `classifyPlaybackFailure` directly. Code 4 with no
 * probe/inspection/capability evidence is indeterminate, never source-access.
 *
 * @deprecated Use `classifyPlaybackFailure` with transport/inspection evidence.
 */
export function classifyLocalMediaError(
  candidate: LocalMediaSourceCandidate,
  mediaType: LocalMediaType,
  errorCode?: number,
): LocalMediaProbeFailure {
  const mimeTypeSupport = getMimeTypeSupport(mediaType, candidate.mimeType);
  const classified = classifyPlaybackFailure({
    mediaErrorCode: errorCode,
    strategy: candidate.strategy,
  });

  if (classified.code === "source_not_found") {
    return {
      kind: "source-access",
      message: "The media source could not be found.",
      mediaErrorCode: errorCode,
      mimeTypeSupport,
      code: classified.code,
    };
  }
  if (
    classified.code === "source_permission_denied" ||
    classified.code === "source_transport_failed" ||
    classified.code === "source_server_unavailable" ||
    classified.code === "source_range_invalid" ||
    classified.code === "source_empty"
  ) {
    return {
      kind: "source-access",
      message: "The media source could not be opened or read by the current app runtime.",
      mediaErrorCode: errorCode,
      mimeTypeSupport,
      code: classified.code,
    };
  }
  if (classified.code === "playback_interrupted") {
    return {
      kind: "aborted",
      message: "Playback was interrupted before the media finished loading.",
      mediaErrorCode: errorCode,
      mimeTypeSupport,
      code: classified.code,
    };
  }
  if (
    classified.code === "container_unsupported" ||
    classified.code === "video_decoder_unavailable" ||
    classified.code === "audio_decoder_unavailable" ||
    classified.code === "bitmap_subtitle_unsupported" ||
    classified.code === "dolby_vision_unsupported"
  ) {
    return {
      kind: "unsupported-format",
      message: mediaType === "audio"
        ? "This audio format is not supported by the embedded browser."
        : "This video's container, video, audio, or subtitle format is not supported by the embedded browser.",
      mediaErrorCode: errorCode,
      mimeTypeSupport,
      code: classified.code,
    };
  }
  if (classified.code === "decoder_initialization_failed") {
    return {
      kind: "decode",
      message: "The file was opened, but the embedded browser could not initialize its media decoder.",
      mediaErrorCode: errorCode,
      mimeTypeSupport,
      code: classified.code,
    };
  }

  return {
    kind: "unknown",
    message: "The media source could not be classified from the available evidence.",
    mediaErrorCode: errorCode,
    mimeTypeSupport,
    code: classified.code,
    indeterminate: true,
  };
}

export async function probeLocalMediaSource(
  candidate: LocalMediaSourceCandidate,
  mediaType: LocalMediaType,
  timeoutMs = 8000,
): Promise<LocalMediaProbeResult> {
  if (candidate.alreadyPlayable || typeof document === "undefined") {
    return { ok: true, candidate };
  }

  return new Promise<LocalMediaProbeResult>((resolve) => {
    const media = document.createElement(mediaType);
    let settled = false;

    const cleanup = () => {
      media.pause();
      media.removeAttribute("src");
      media.load();
      media.onerror = null;
      media.onloadedmetadata = null;
      media.oncanplay = null;
      media.onplaying = null;
    };

    const finish = (result: LocalMediaProbeResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(result);
    };

    const timeoutId = window.setTimeout(() => {
      finish({
        ok: false,
        candidate,
        failure: {
          kind: "unknown",
          message:
            "Timed out while waiting for the media source to become playable. Metadata alone is not proof that the codecs can be decoded.",
          mimeTypeSupport: getMimeTypeSupport(mediaType, candidate.mimeType),
          code: "media_compatibility_indeterminate",
          indeterminate: true,
        },
      });
    }, timeoutMs);

    media.preload = "metadata";
    media.muted = true;
    if (mediaType === "video") {
      (media as HTMLVideoElement).playsInline = true;
    }

    // A metadata event proves the container was parsed, not that the video,
    // audio, or bitmap subtitle streams can be decoded. Keep waiting for
    // canplay/playing; a timeout is indeterminate, not a fabricated cause.
    media.onloadedmetadata = () => {
      /* metadata loaded; still wait for canplay/playing */
    };
    media.oncanplay = () => finish({ ok: true, candidate });
    media.onplaying = () => finish({ ok: true, candidate });
    media.onerror = () => {
      finish({
        ok: false,
        candidate,
        failure: classifyLocalMediaError(candidate, mediaType, media.error?.code),
      });
    };

    media.src = candidate.src;
    media.load();
  });
}
