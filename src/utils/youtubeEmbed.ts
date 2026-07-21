import { isTauri, isNativeMobile, getPlatform } from "../lib/tauri";

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export type YouTubeEmbedHost = "https://www.youtube-nocookie.com" | "https://www.youtube.com";

/**
 * Pick the iframe host for the YouTube player.
 *
 * WebKitGTK, Android WebView, and iOS WKWebView block CORS/postMessage against
 * youtube-nocookie.com, which renders as a blank player. Those platforms must use
 * the youtube.com host directly. Everywhere else we keep the privacy-preserving host.
 *
 * This is the single source of truth: the player's initial state and any reset on
 * document switch both read from here, so the two can't drift apart.
 */
export function resolveEmbedHost(): YouTubeEmbedHost {
  if (isTauri() || isNativeMobile() || getPlatform() === "linux") {
    return "https://www.youtube.com";
  }
  return "https://www.youtube-nocookie.com";
}
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function sanitizeCandidate(id: string | null | undefined): string | null {
  if (!id) return null;
  const clean = id.trim();
  if (!clean) return null;
  return YOUTUBE_ID_PATTERN.test(clean) ? clean : null;
}

function parseYouTubeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    try {
      return new URL(`https://${raw}`);
    } catch {
      return null;
    }
  }
}

export function extractYouTubeVideoId(input: string): string | null {
  const direct = sanitizeCandidate(input);
  if (direct) return direct;

  const parsed = parseYouTubeUrl(input);
  if (!parsed) return null;

  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  if (host === "youtu.be" || host === "www.youtu.be") {
    const fromPath = sanitizeCandidate(parsed.pathname.split("/").filter(Boolean)[0]);
    if (fromPath) return fromPath;
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const first = pathParts[0]?.toLowerCase();
  const second = sanitizeCandidate(pathParts[1]);

  if (first === "watch") {
    const v = sanitizeCandidate(parsed.searchParams.get("v"));
    if (v) return v;
  }

  if (first === "shorts" || first === "embed" || first === "v" || first === "live") {
    if (second) return second;
  }

  const viaQuery = sanitizeCandidate(parsed.searchParams.get("v"))
    || sanitizeCandidate(parsed.searchParams.get("vi"));
  if (viaQuery) return viaQuery;

  const fromPath = sanitizeCandidate(pathParts[0]);
  if (fromPath) return fromPath;

  return null;
}

export function buildYouTubeNoCookieEmbedUrl(videoId: string, startSeconds?: number): string {
  const params = new URLSearchParams();
  params.set("enablejsapi", "1");
  params.set("modestbranding", "1");
  params.set("rel", "0");
  params.set("playsinline", "1");
  if (typeof startSeconds === "number" && Number.isFinite(startSeconds) && startSeconds > 0) {
    params.set("start", String(Math.floor(startSeconds)));
  }
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

