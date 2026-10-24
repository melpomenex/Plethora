import type { AudioPlaybackError, AudioPlaybackErrorCode } from "../../types/audioEdition";

const VALID_ERROR_CODES = new Set<AudioPlaybackErrorCode>([
  "source_missing",
  "permission_denied",
  "unsupported_codec",
  "network",
  "expired_url",
  "corrupt_media",
  "focus_denied",
  "persistence",
  "unsupported_command",
]);

const AUDIO_EXTENSION_MIMES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/opus",
  weba: "audio/webm",
  webm: "audio/webm",
  wma: "audio/x-ms-wma",
  aiff: "audio/aiff",
};

export class AudioPlaybackException extends Error {
  readonly code: AudioPlaybackErrorCode;

  constructor(code: AudioPlaybackErrorCode, message: string) {
    super(message);
    this.name = "AudioPlaybackException";
    this.code = code;
  }
}

export function inferAudioMimeFromUrl(url: string): string | undefined {
  const clean = url.split(/[?#]/, 1)[0] ?? "";
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSION_MIMES[ext];
}

export function isLoopbackStreamUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::|\/)/i.test(url);
}

export function isRemoteStreamUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !isLoopbackStreamUrl(url);
}

export function classifyMediaElementError(
  url: string,
  mediaError: { code?: number; message?: string } | null | undefined,
  canPlayType?: (mime: string) => string,
): AudioPlaybackException {
  const code = mediaError?.code;
  const detail = mediaError?.message?.trim();

  if (code === 2) {
    return new AudioPlaybackException("network", detail || "Network error while loading audio");
  }
  if (code === 3) {
    return new AudioPlaybackException("corrupt_media", detail || "Audio source could not be decoded");
  }
  if (code === 4) {
    const mime = inferAudioMimeFromUrl(url);
    const support = mime && canPlayType ? canPlayType(mime) : undefined;
    if (isRemoteStreamUrl(url) && support && support !== "") {
      return new AudioPlaybackException(
        "expired_url",
        detail || "Remote audio stream expired or rejected playback",
      );
    }
    if (isLoopbackStreamUrl(url) && support && support !== "") {
      return new AudioPlaybackException(
        "source_missing",
        detail || "Local audio source is missing or unreadable",
      );
    }
    return new AudioPlaybackException(
      "unsupported_codec",
      detail || "Audio format or codec is not supported",
    );
  }
  return new AudioPlaybackException("corrupt_media", detail || "Audio source could not be decoded");
}

export function classifyAudioPlaybackError(error: unknown): AudioPlaybackError {
  if (error && typeof error === "object") {
    const candidateCode = (error as { code?: unknown }).code;
    if (typeof candidateCode === "string" && VALID_ERROR_CODES.has(candidateCode as AudioPlaybackErrorCode)) {
      const message = error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? error);
      return { code: candidateCode as AudioPlaybackErrorCode, message };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/permission|not authorized|unauthorized|outside allowed|belong to the main window/i.test(message)) {
    return { code: "permission_denied", message };
  }
  if (/unavailable|missing|not found|no ready|transcript-only|unfinished|file handle/i.test(message)) {
    return { code: "source_missing", message };
  }
  if (/expired|401|403|410/i.test(message)) {
    return { code: "expired_url", message };
  }
  if (/unsupported|codec|format|transcode|ffmpeg/i.test(message)) {
    return { code: "unsupported_codec", message };
  }
  if (/network|offline|timed out|fetch/i.test(message)) {
    return { code: "network", message };
  }
  return { code: "corrupt_media", message };
}
