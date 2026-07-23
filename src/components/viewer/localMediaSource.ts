import { readDocumentFile } from "../../api/documents";
import { getBrowserFile } from "../../lib/browser-file-store";
import { convertFileSrc, isTauri, isNativeMobile, invokeCommand } from "../../lib/tauri";
import { logAudiobookDiagnostic } from "../../lib/audiobookDiagnostics";

export type LocalMediaType = "video" | "audio";
export type LocalMediaSourceStrategy = "tauri-asset" | "local-media-server" | "browser-object-url" | "backend-blob";

export interface LocalMediaResolutionAttempt {
  strategy: LocalMediaSourceStrategy;
  status: "success" | "failed" | "skipped";
  detail: string;
}

export interface ResolvedLocalMediaSource {
  src: string;
  mimeType: string;
  mediaType: LocalMediaType;
  originalPath: string;
  strategy: LocalMediaSourceStrategy;
  revokeSrcOnDispose: boolean;
  attempts: LocalMediaResolutionAttempt[];
}

interface MediaProbeResult {
  ok: boolean;
  detail: string;
}

const VIDEO_MIME_TYPES: Record<string, string> = {
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
  mp4: "video/mp4",
};

const AUDIO_MIME_TYPES: Record<string, string> = {
  wav: "audio/wav",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  opus: "audio/opus",
  mp3: "audio/mpeg",
};

export const MOBILE_SOURCE_RESOLUTION_TIMEOUT_MS = 10_000;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function inferMimeType(filePath: string, mediaType: LocalMediaType): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (mediaType === "audio") {
    return AUDIO_MIME_TYPES[ext] ?? "audio/mpeg";
  }
  return VIDEO_MIME_TYPES[ext] ?? "video/mp4";
}

function formatAttemptSummary(attempts: LocalMediaResolutionAttempt[]): string {
  return attempts.map((attempt) => `${attempt.strategy}:${attempt.status}:${attempt.detail}`).join(" | ");
}

async function probeMediaSource(
  src: string,
  mediaType: LocalMediaType,
  mimeType: string,
): Promise<MediaProbeResult> {
  if (typeof document === "undefined") {
    return { ok: true, detail: "Skipping source probe outside the browser runtime." };
  }

  const media = document.createElement(mediaType);
  media.preload = "auto";
  media.muted = true;

  const capability = typeof media.canPlayType === "function" ? media.canPlayType(mimeType) : "";
  const capabilityDetail = capability ? `canPlayType=${capability}` : "canPlayType=unknown";

  return await new Promise<MediaProbeResult>((resolve) => {
    let settled = false;
    let timeout = 0;

    function finish(result: MediaProbeResult) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      media.removeEventListener("playing", handlePlaying);
      media.removeEventListener("error", handleError);
      media.pause();
      media.removeAttribute("src");
      media.load();
      resolve(result);
    }

    const handlePlaying = () => {
      finish({
        ok: true,
        detail: `${capabilityDetail}; playing successfully`,
      });
    };

    const handleError = () => {
      const code = media.error?.code ?? "unknown";
      const message = media.error?.message?.trim();
      finish({
        ok: false,
        detail: `${capabilityDetail}; media error code ${code}${message ? ` (${message})` : ""}`,
      });
    };

    media.addEventListener("playing", handlePlaying, { once: true });
    media.addEventListener("error", handleError, { once: true });
    timeout = window.setTimeout(() => {
      finish({
        ok: false,
        detail: `${capabilityDetail}; timed out while probing playback`,
      });
    }, 8000);
    media.src = src;
    media.load();
    // Attempt actual playback to verify the codec is supported.
    // On WebKitGTK, loadedmetadata can fire even when the codec cannot be decoded.
    media.play().catch(() => {});
  });
}

export async function resolveLocalMediaSource(
  filePath: string,
  mediaType: LocalMediaType,
): Promise<ResolvedLocalMediaSource> {
  // If it's already a remote URL, return it directly
  if (filePath.startsWith("http://") || filePath.startsWith("https://") || filePath.startsWith("data:")) {
    return {
      src: filePath,
      mimeType: inferMimeType(filePath, mediaType),
      mediaType,
      originalPath: filePath,
      strategy: "tauri-asset", // Using this strategy to mean "direct URL"
      revokeSrcOnDispose: false,
      attempts: [{ strategy: "tauri-asset", status: "success", detail: "Remote URL detected, using directly." }],
    };
  }

  const mimeType = inferMimeType(filePath, mediaType);

  if (isNativeMobile()) {
    try {
      // Use the local streaming HTTP server with Range request support.
      // The Tauri asset protocol (convertFileSrc) buffers the entire file
      // into memory on Android, causing OOM crashes for large audiobooks.
      const streamUrl = await withTimeout(
        invokeCommand<string>("get_media_stream_url", { filePath }),
        MOBILE_SOURCE_RESOLUTION_TIMEOUT_MS,
        "Timed out while resolving the local mobile media stream.",
      );
      if (!streamUrl?.startsWith("http://127.0.0.1:")) {
        throw new Error("The local mobile media stream returned an invalid URL.");
      }
      logAudiobookDiagnostic("source_resolution", {
        filePath,
        strategy: "local-media-server",
        status: "success",
        mimeType,
      });
      return {
        src: streamUrl,
        mimeType,
        mediaType,
        originalPath: filePath,
        strategy: "local-media-server",
        revokeSrcOnDispose: false,
        attempts: [{ strategy: "local-media-server", status: "success", detail: "Using local streaming HTTP server on mobile." }],
      };
    } catch (error) {
      logAudiobookDiagnostic("source_resolution", {
        filePath,
        strategy: "local-media-server",
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      }, "error");
      throw new Error(`Failed to resolve media source on mobile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const attempts: LocalMediaResolutionAttempt[] = [];

  if (!isTauri() && filePath.startsWith("browser-file://")) {
    const browserFile = getBrowserFile(filePath);
    if (browserFile) {
      attempts.push({
        strategy: "browser-object-url",
        status: "success",
        detail: "Using in-memory browser File object.",
      });
      return {
        src: URL.createObjectURL(browserFile),
        mimeType: browserFile.type || mimeType,
        mediaType,
        originalPath: filePath,
        strategy: "browser-object-url",
        revokeSrcOnDispose: true,
        attempts,
      };
    }
    attempts.push({
      strategy: "browser-object-url",
      status: "failed",
      detail: "No browser File object was available for the virtual path.",
    });
  } else if (!filePath.startsWith("browser-file://")) {
    attempts.push({
      strategy: "browser-object-url",
      status: "skipped",
      detail: "Source is not a browser-file:// path.",
    });
  }

  // On Linux (WebKitGTK), the asset:// protocol from convertFileSrc works for <video>/<audio>
  // elements (which use the GStreamer media pipeline), but not for XMLHttpRequest-based loading
  // (e.g. EPUB.js). Blob URLs also fail on WebKitGTK because the media pipeline cannot
  // perform range requests on blob URLs. So on Linux, try asset:// first for media.
  const isLinuxWebKit = isTauri() && /Linux/.test(navigator.platform);

  if (isLinuxWebKit) {
    // On Linux, skip the blob fallback entirely if asset works,
    // since WebKitGTK cannot play blob: URLs with H.264 content.
    try {
      const assetUrl = await convertFileSrc(filePath);
      attempts.push({
        strategy: "tauri-asset",
        status: "success",
        detail: `Resolved via convertFileSrc(); skipped blob probe on WebKitGTK.`,
      });
      return {
        src: assetUrl,
        mimeType,
        mediaType,
        originalPath: filePath,
        strategy: "tauri-asset",
        revokeSrcOnDispose: false,
        attempts,
      };
    } catch (error) {
      attempts.push({
        strategy: "tauri-asset",
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  } else if (isTauri()) {
    try {
      const assetUrl = await convertFileSrc(filePath);
      const probe = await probeMediaSource(assetUrl, mediaType, mimeType);
      if (!probe.ok) {
        attempts.push({
          strategy: "tauri-asset",
          status: "failed",
          detail: probe.detail,
        });
      } else {
        attempts.push({
          strategy: "tauri-asset",
          status: "success",
          detail: `Resolved via convertFileSrc(); ${probe.detail}`,
        });
        return {
          src: assetUrl,
          mimeType,
          mediaType,
          originalPath: filePath,
          strategy: "tauri-asset",
          revokeSrcOnDispose: false,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        strategy: "tauri-asset",
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    attempts.push({
      strategy: "tauri-asset",
      status: "skipped",
      detail: "Not running in Tauri.",
    });
  }

  try {
    const bytes = await readDocumentFile(filePath);
    if (!bytes || bytes.byteLength === 0) {
      throw new Error("File not found or empty.");
    }
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const probe = await probeMediaSource(blobUrl, mediaType, mimeType);
    if (!probe.ok) {
      URL.revokeObjectURL(blobUrl);
      throw new Error(probe.detail);
    }
    attempts.push({
      strategy: "backend-blob",
      status: "success",
      detail: `Created blob URL from backend bytes (${bytes.byteLength} bytes); ${probe.detail}`,
    });
    return {
      src: blobUrl,
      mimeType,
      mediaType,
      originalPath: filePath,
      strategy: "backend-blob",
      revokeSrcOnDispose: true,
      attempts,
    };
  } catch (error) {
    attempts.push({
      strategy: "backend-blob",
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  throw new Error(`Could not resolve a playable media source. ${formatAttemptSummary(attempts)}`);
}
