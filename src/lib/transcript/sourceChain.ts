import { isTauri, invokeCommand } from "../tauri";
import { useSettingsStore } from "../../stores/settingsStore";
import { fetchYouTubeTranscript as fetchFromBrowser } from "../../utils/youtubeTranscriptBrowser";
import type { WordTiming } from "../../utils/wordTimings";

export interface YouTubeTranscriptSegment {
  text: string;
  start: number;
  duration: number;
  /**
   * Per-word offsets for karaoke highlighting. Present when the caption track
   * carried them (YouTube ASR tracks do; human-authored ones generally don't),
   * absent otherwise — every hop in this chain must pass it through untouched
   * rather than rebuilding segments field-by-field.
   */
  words?: WordTiming[];
}

export interface SourceChainResult {
  segments: YouTubeTranscriptSegment[];
  language: string;
  source: "on-device" | "self-hosted" | "relay" | "local-cache";
}

export interface DiagnosticInfo {
  videoId: string;
  timestamp: string;
  source: string;
  status: "success" | "failure";
  durationMs: number;
  error?: string;
}

export class TerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalError";
  }
}

export function getLastDiagnostic(): DiagnosticInfo | null {
  try {
    const raw = localStorage.getItem("last_youtube_transcript_diagnostic");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDiagnostic(info: DiagnosticInfo) {
  try {
    localStorage.setItem("last_youtube_transcript_diagnostic", JSON.stringify(info));
  } catch {}
}

// Timeout wrapper for fetch/promises
function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    promise.then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function resolveTranscriptInternal(
  videoId: string,
  language?: string
): Promise<SourceChainResult> {
  const settings = useSettingsStore.getState().settings;
  const onDeviceEnabled = settings.youtube?.transcriptOnDeviceEnabled ?? true;
  const customUrl = settings.youtube?.transcriptServerUrl;
  const customApiKey = settings.youtube?.transcriptServerApiKey;

  // 1 & 2. Try On-device Tauri Rust fetcher (which checks SQLite cache first)
  if (isTauri() && onDeviceEnabled) {
    try {
      console.log(`[sourceChain] Attempting on-device fetch for video: ${videoId}`);
      const result = await withTimeout(
        invokeCommand<any>("fetch_youtube_transcript_on_device", {
          videoId,
          language,
          documentId: null,
        }),
        15000,
        "On-device transcript fetch timed out (15s)"
      );

      const isOk = result && (result.kind === "Ok" || result.status === "ok" || (Array.isArray(result.segments) && result.segments.length > 0));
      if (isOk) {
        console.log(`[sourceChain] On-device fetch succeeded for video: ${videoId}`);
        
        // Warm the self-hosted cache in the background (fire-and-forget)
        if (customUrl) {
          uploadToVpsBackground(customUrl, customApiKey, videoId, result.segments);
        }
        
        return {
          segments: result.segments,
          language: result.language || "en",
          source: "on-device",
        };
      } else {
        console.warn(`[sourceChain] On-device fetch returned err: ${result?.kind || result?.status} - ${result?.detail}`);
        // Terminal errors: raise immediately
        if (result?.kind === "NoCaptions" || result?.kind === "VideoUnavailable") {
          throw new TerminalError(result.detail || `YouTube error: ${result.kind}`);
        }
        // Other errors (e.g. rate limit, bot block, network): fall through
      }
    } catch (e: any) {
      if (e instanceof TerminalError) {
        throw e;
      }
      console.error("[sourceChain] On-device fetch failed:", e);
      // Non-terminal failures: fall through
    }
  }

  // 3. Try Self-hosted VPS Server (if configured)
  if (customUrl) {
    try {
      console.log(`[sourceChain] Attempting self-hosted fetch from: ${customUrl}`);
      const response = await fetchFromCustomUrl(customUrl, customApiKey, videoId, language);
      if (response && response.segments && response.segments.length > 0) {
        return {
          segments: response.segments,
          language: response.language || "en",
          source: "self-hosted",
        };
      }
    } catch (e: any) {
      console.error("[sourceChain] Self-hosted fetch failed:", e);
      if (e instanceof TerminalError) {
        throw e;
      }
      // If terminal (e.g. video unavailable, no captions), propagate. Otherwise, fall through to hosted relay
      if (e.message?.includes("NoCaptions") || e.message?.includes("VideoUnavailable") || e.message?.includes("captions enabled") || e.message?.includes("unavailable")) {
        throw new TerminalError(e.message);
      }
    }
  }

  // 4. Try Hosted Relay (readsync.org or browser scrapers)
  console.log(`[sourceChain] Attempting default hosted relay fetch for video: ${videoId}`);
  try {
    const response = await fetchFromBrowser(videoId, language);
    if (response && response.segments && response.segments.length > 0) {
      return {
        segments: response.segments,
        language: response.language || "en",
        source: "relay",
      };
    }
  } catch (e: any) {
    console.error("[sourceChain] Hosted relay fetch failed:", e);
    throw e;
  }

  throw new Error("Failed to fetch YouTube transcript from any source.");
}

export async function resolveTranscript(
  videoId: string,
  language?: string
): Promise<SourceChainResult> {
  const startTime = Date.now();
  try {
    const result = await resolveTranscriptInternal(videoId, language);
    saveDiagnostic({
      videoId,
      timestamp: new Date().toISOString(),
      source: result.source,
      status: "success",
      durationMs: Date.now() - startTime,
    });
    return result;
  } catch (e: any) {
    saveDiagnostic({
      videoId,
      timestamp: new Date().toISOString(),
      source: "unknown",
      status: "failure",
      durationMs: Date.now() - startTime,
      error: e.message || String(e),
    });
    throw e;
  }
}

async function fetchFromCustomUrl(url: string, apiKey: string | undefined, videoId: string, language?: string) {
  const base = url.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  const params = new URLSearchParams({ videoId });
  if (language) params.append("language", language);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  const res = await withTimeout(
    fetch(`${base}/api/youtube/transcript?${params.toString()}`, { headers }),
    45000,
    "Self-hosted transcript server timed out (45s)"
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data.code === "RELAY_UNAVAILABLE") {
      throw new Error("Self-hosted worker is offline (RELAY_UNAVAILABLE)");
    }
    throw new Error(`Self-hosted server returned status ${res.status}: ${data.error || "Unknown error"}`);
  }

  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || "Failed to fetch from self-hosted server");
  }
  return data;
}

function uploadToVpsBackground(url: string, apiKey: string | undefined, videoId: string, segments: YouTubeTranscriptSegment[]) {
  const base = url.replace(/\/$/, "");
  const uploadUrl = `${base}/worker/upload`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  headers["X-Worker-ID"] = "tauri-client";

  fetch(uploadUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      video_id: videoId,
      segments: segments,
    }),
  }).catch((err) => console.warn("[sourceChain] Background cache upload failed:", err));
}
