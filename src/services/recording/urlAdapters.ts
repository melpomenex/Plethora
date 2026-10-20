/**
 * URL Adapter Classification & Ingestion Policy Enforcement.
 *
 * Implements Task 1.5 requirements:
 * - Recognizes supported URL adapters: YouTube, Podcasts, Direct Media, Transcripts, Web Articles.
 * - Preserves YouTube compliance: canonical transcript paths and no arbitrary cloud acquisition.
 * - Refuses unknown, private, and DRM sources (e.g. Netflix, Hulu, private IP addresses, loopback).
 * - Never converts article fetcher into an arbitrary media downloader.
 * - Guards against SSRF and private redirects (127.0.0.1, 10.x, 192.168.x, 169.254.x, etc.).
 */

import { isBlockedMediaHost } from "../../utils/articleImport/mediaUrlPolicy";
import { urlDetectorUtils } from "../../hooks/useURLDetector";
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "flac", "ogg"]);
const VIDEO_EXTENSIONS = new Set(["webm", "mp4", "mov"]);
const TRANSCRIPT_EXTENSIONS = new Set(["srt", "vtt"]);

export function isSupportedMediaExtension(path: string): boolean {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) return false;
  const ext = path.slice(lastDot + 1).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
}

export function detectMediaKind(path: string): "audio" | "video" | null {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) return null;
  const ext = path.slice(lastDot + 1).toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return null;
}

export function isTranscriptExtension(path: string): boolean {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) return false;
  const ext = path.slice(lastDot + 1).toLowerCase();
  return TRANSCRIPT_EXTENSIONS.has(ext);
}

export type UrlAdapterKind =
  | "youtube"
  | "podcast"
  | "direct-media"
  | "direct-transcript"
  | "web-article"
  | "unknown";

export type PolicyErrorCode =
  | "private_network"
  | "unsupported_protocol"
  | "drm_protected"
  | "cloud_acquisition_prohibited"
  | "invalid_url"
  | "unsupported_source";

export interface UrlPolicyDecision {
  isAllowed: boolean;
  adapter: UrlAdapterKind;
  normalizedUrl: string;
  reason?: string;
  errorCode?: PolicyErrorCode;
  meta?: {
    youtubeId?: string;
    isAudio?: boolean;
    isVideo?: boolean;
    format?: string;
  };
}

const DRM_DOMAINS = [
  "netflix.com",
  "disneyplus.com",
  "hulu.com",
  "max.com",
  "hbomax.com",
  "primevideo.com",
  "peacocktv.com",
  "paramountplus.com",
  "appletv.apple.com",
  "tv.apple.com",
];

/**
 * Checks if a hostname belongs to a known DRM-protected streaming service.
 */
export function isDrmProtectedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return DRM_DOMAINS.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
}

/**
 * Validates and classifies an input URL according to ingestion policy.
 */
export function classifyUrl(rawUrl: string): UrlPolicyDecision {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      isAllowed: false,
      adapter: "unknown",
      normalizedUrl: rawUrl,
      reason: "URL is empty",
      errorCode: "invalid_url",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      isAllowed: false,
      adapter: "unknown",
      normalizedUrl: trimmed,
      reason: "Malformed URL format",
      errorCode: "invalid_url",
    };
  }

  // Enforce HTTP / HTTPS protocol
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      isAllowed: false,
      adapter: "unknown",
      normalizedUrl: trimmed,
      reason: `Unsupported protocol '${parsed.protocol}'. Only HTTP and HTTPS are permitted.`,
      errorCode: "unsupported_protocol",
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Enforce private network / loopback / SSRF refusal
  if (isBlockedMediaHost(trimmed)) {
    return {
      isAllowed: false,
      adapter: "unknown",
      normalizedUrl: trimmed,
      reason: "Access to private or local network addresses is prohibited.",
      errorCode: "private_network",
    };
  }

  // Enforce DRM source refusal
  if (isDrmProtectedHost(hostname)) {
    return {
      isAllowed: false,
      adapter: "unknown",
      normalizedUrl: trimmed,
      reason: "DRM-protected streaming media cannot be acquired or imported.",
      errorCode: "drm_protected",
    };
  }

  // 1. YouTube Adapter
  if (urlDetectorUtils.isYouTubeURL(trimmed)) {
    const videoId = urlDetectorUtils.extractYouTubeID(trimmed);
    return {
      isAllowed: true,
      adapter: "youtube",
      normalizedUrl: trimmed,
      meta: {
        youtubeId: videoId || undefined,
        isVideo: true,
      },
    };
  }

  // 2. Direct Media Link (Audio / Video)
  const pathname = parsed.pathname;
  if (isSupportedMediaExtension(pathname)) {
    const kind = detectMediaKind(pathname);
    const lastDot = pathname.lastIndexOf(".");
    const ext = lastDot !== -1 ? pathname.slice(lastDot + 1).toLowerCase() : undefined;
    return {
      isAllowed: true,
      adapter: "direct-media",
      normalizedUrl: trimmed,
      meta: {
        isAudio: kind === "audio",
        isVideo: kind === "video",
        format: ext,
      },
    };
  }

  // 3. Direct Transcript Link (SRT / VTT)
  if (isTranscriptExtension(pathname)) {
    const lastDot = pathname.lastIndexOf(".");
    const ext = lastDot !== -1 ? pathname.slice(lastDot + 1).toLowerCase() : undefined;
    return {
      isAllowed: true,
      adapter: "direct-transcript",
      normalizedUrl: trimmed,
      meta: {
        format: ext,
      },
    };
  }

  // 4. Podcast RSS Feed Adapter
  if (
    urlDetectorUtils.isRSSFeedURL(trimmed) ||
    hostname.includes("podcast") ||
    hostname.startsWith("feeds.") ||
    hostname.includes(".feed.") ||
    pathname.includes("/podcast") ||
    pathname.endsWith(".rss") ||
    pathname.endsWith(".xml") ||
    pathname.endsWith("/feed") ||
    pathname.includes("/feed/") ||
    pathname.includes("/feeds/")
  ) {
    return {
      isAllowed: true,
      adapter: "podcast",
      normalizedUrl: trimmed,
      meta: {
        isAudio: true,
      },
    };
  }

  // 5. General Web Article
  // Policy rule: Article fetcher extracts article text/HTML only; it is never converted
  // into an arbitrary binary media downloader.
  return {
    isAllowed: true,
    adapter: "web-article",
    normalizedUrl: trimmed,
  };
}

/**
 * Validates whether a redirect URL from a remote fetch remains policy-compliant.
 */
export function validateRedirectUrl(originalUrl: string, targetUrl: string): UrlPolicyDecision {
  const decision = classifyUrl(targetUrl);
  if (!decision.isAllowed) {
    return {
      ...decision,
      reason: `Redirect from '${originalUrl}' to '${targetUrl}' was refused: ${decision.reason}`,
    };
  }
  return decision;
}

/**
 * Checks whether a shared file path represents a recording audio/video or a transcript.
 */
export function detectSharedFileKind(filePathOrName: string): {
  isRecording: boolean;
  isTranscript: boolean;
  suggestedRoute?: "import-media" | "import-transcript";
} {
  if (isSupportedMediaExtension(filePathOrName)) {
    return {
      isRecording: true,
      isTranscript: false,
      suggestedRoute: "import-media",
    };
  }
  if (isTranscriptExtension(filePathOrName)) {
    return {
      isRecording: false,
      isTranscript: true,
      suggestedRoute: "import-transcript",
    };
  }
  return {
    isRecording: false,
    isTranscript: false,
  };
}
