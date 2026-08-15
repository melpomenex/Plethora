import type { ImageAsset } from "../api/image-registry";
import { isNativeMobile } from "../lib/tauri";

/**
 * Acquiring an image for the Image Registry or an occlusion card.
 *
 * The desktop WebView cannot `fetch()` a cross-origin image — WebKit rejects it
 * with the cryptic message "Load failed". Native ingestion (reqwest, not subject
 * to CORS) and rendered-pixel capture both work around that, but they used to be
 * reachable *only* when the source was a public remote URL. Every other source —
 * an image inside an imported article, an app asset, the in-app image viewer —
 * fell through to a bare `fetch()` and surfaced "Load failed" verbatim, which is
 * exactly what the occlusion bug report showed.
 *
 * Acquisition now runs a chain of strategies for every source. The source's
 * scheme decides the *order* (start with whatever is most likely to work), never
 * which strategies exist. Images served by the app's own loopback media/epub
 * server are the notable mobile case: the webview cannot fetch them (no CORS
 * headers on the loopback server) and Rust will not fetch them (the SSRF guard
 * rejects loopback hosts), so their URL-named backing file is ingested
 * natively via `ingestFromPath`.
 */

export interface ImageAcquisitionSource {
  src: string;
  /** Page the image was displayed on; some hosts require a matching referrer. */
  referrerUrl?: string;
  /** On-screen rect, required for the rendered-pixel fallback. */
  rect?: { left: number; top: number; width: number; height: number };
}

export interface ImageAcquisitionDeps {
  isTauri: () => boolean;
  fetchBlob: (src: string) => Promise<Blob>;
  ingestBlob: (blob: Blob, fileName?: string) => Promise<ImageAsset>;
  ingestRemote: (
    src: string,
    fileName?: string,
    referrerUrl?: string,
  ) => Promise<ImageAsset>;
  /** Rust-side `ingest_image_asset_from_path`: reads and ingests in one hop. */
  ingestFromPath: (
    path: string,
    fileName?: string,
    mimeType?: string,
  ) => Promise<ImageAsset>;
  captureRect: (rect: NonNullable<ImageAcquisitionSource["rect"]>) => Promise<Blob>;
}

export type StrategyName = "direct" | "native" | "local-file" | "pixel-capture";

export class ImageAcquisitionError extends Error {
  readonly attempts: { strategy: StrategyName; reason: string }[];

  constructor(message: string, attempts: { strategy: StrategyName; reason: string }[]) {
    super(message);
    this.name = "ImageAcquisitionError";
    this.attempts = attempts;
  }
}

/** WebKit's generic cross-origin fetch rejection. Never show this to a user. */
const OPAQUE_PLATFORM_ERRORS = ["load failed", "failed to fetch", "networkerror"];

function describeFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.trim().toLowerCase();
  if (OPAQUE_PLATFORM_ERRORS.some((opaque) => normalized === opaque || normalized.startsWith(opaque))) {
    return "blocked by the browser engine (cross-origin)";
  }
  return raw.trim() || "unknown error";
}

export function isPublicRemoteImageUrl(src: string): boolean {
  try {
    const url = new URL(src);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "::1", "asset.localhost"].includes(host);
  } catch {
    return false;
  }
}

export function getRemoteImageFileName(src: string): string | undefined {
  try {
    const name = decodeURIComponent(new URL(src).pathname.split("/").pop() || "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

export function getFilePathFromUrl(src: string): string | null {
  const normalizeWindowsPath = (pathname: string): string =>
    /^\/[a-zA-Z]:/.test(pathname) ? pathname.substring(1) : pathname;

  try {
    const url = new URL(src);
    const streamPath = filePathFromLoopbackStreamUrl(url);
    if (streamPath) return streamPath;
    if (url.protocol === "asset:" || url.host === "asset.localhost" || url.protocol === "file:") {
      return normalizeWindowsPath(decodeURIComponent(url.pathname));
    }
  } catch {
    // Fall through to prefix matching below.
  }

  const cleanSrc = src.split("?")[0].split("#")[0];
  const prefixes = [
    "asset://localhost/",
    "https://asset.localhost/",
    "http://asset.localhost/",
    "asset://",
    "file:///",
    "file://",
  ];
  for (const prefix of prefixes) {
    if (cleanSrc.startsWith(prefix)) {
      const path = decodeURIComponent(cleanSrc.substring(prefix.length));
      return /^[a-zA-Z]:/.test(path) ? path : `/${path.replace(/^\/+/, "")}`;
    }
  }

  return null;
}

/**
 * Hosts the app's own loopback media/epub server binds. Every stream URL it
 * mints carries the backing file path as a `?path=` query parameter (see
 * media_server::get_media_stream_url and epub_server::get_epub_stream_url),
 * regardless of the exact route.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function filePathFromLoopbackStreamUrl(url: URL): string | null {
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // searchParams.get already percent-decodes the server-encoded path.
  const path = url.searchParams.get("path");
  if (!path || !/^\//.test(path)) return null;
  // Server-side canonical paths may be Windows-style (C:/...); strip the
  // leading slash there, matching the asset/file URL handling above.
  return /^\/[a-zA-Z]:/.test(path) ? path.substring(1) : path;
}

/**
 * Recognize one of the app's own media/epub stream URLs. The webview cannot
 * `fetch()` these (the loopback server sends no CORS headers — cross-origin
 * from the tauri.localhost page) and Rust will not reqwest them (the SSRF
 * guard rejects loopback hosts), but the URL names its backing file, which
 * `ingestFromPath` reads natively.
 */
export function isLoopbackStreamUrl(src: string): boolean {
  try {
    return filePathFromLoopbackStreamUrl(new URL(src)) !== null;
  } catch {
    return false;
  }
}

function mimeTypeForPath(path: string): string {
  switch (path.split(".").pop()?.toLowerCase()) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "epub":
      return "application/epub+zip";
    default:
      return "image/png";
  }
}

function fileNameFor(src: string, extension: string): string {
  return getRemoteImageFileName(src) ?? `saved-image-${Date.now()}.${extension}`;
}

/**
 * Order the strategies for a source. Every source gets every applicable
 * strategy; only the ordering changes.
 */
export function planStrategies(
  source: ImageAcquisitionSource,
  deps: Pick<ImageAcquisitionDeps, "isTauri">,
): StrategyName[] {
  const { src } = source;
  const native = deps.isTauri();
  const plan: StrategyName[] = [];

  if (src.startsWith("data:") || src.startsWith("blob:")) {
    // Same-origin by construction; a direct read always wins.
    plan.push("direct");
  } else if (native && isLoopbackStreamUrl(src)) {
    // One of the app's own media/epub stream URLs. The webview fetch is
    // cross-origin (the loopback server sends no CORS headers) and the
    // native remote fetch is rejected by the SSRF guard, but the URL names
    // its backing file — from-path ingestion is the one strategy whose
    // transport cannot fail. Lead with it.
    plan.push("local-file", "direct", "native");
  } else if (native && isPublicRemoteImageUrl(src)) {
    // A webview fetch would be CORS-blocked, so lead with native ingestion.
    plan.push("native", "direct");
  } else {
    plan.push("direct");
    if (native) plan.push("local-file", "native");
  }

  // Capturing what is already painted works regardless of scheme or origin,
  // so it is the universal last resort rather than a remote-only special
  // case. The capture command is desktop-only (xcap; compiled out of the
  // Android/iOS build) — planning it there just produces "command not
  // found" failures.
  if (native && !isNativeMobile() && source.rect) plan.push("pixel-capture");

  return plan.filter((strategy, index) => plan.indexOf(strategy) === index);
}

export async function acquireImageAsset(
  source: ImageAcquisitionSource,
  deps: ImageAcquisitionDeps,
): Promise<ImageAsset> {
  const attempts: { strategy: StrategyName; reason: string }[] = [];

  for (const strategy of planStrategies(source, deps)) {
    try {
      switch (strategy) {
        case "direct": {
          const blob = await deps.fetchBlob(source.src);
          const extension = blob.type.split("/")[1] || "png";
          return await deps.ingestBlob(blob, fileNameFor(source.src, extension));
        }
        case "native":
          return await deps.ingestRemote(
            source.src,
            getRemoteImageFileName(source.src),
            source.referrerUrl,
          );
        case "local-file": {
          const path = getFilePathFromUrl(source.src);
          if (!path) throw new Error("not a local file URL");
          return await deps.ingestFromPath(
            path,
            path.split("/").pop() || undefined,
            mimeTypeForPath(path),
          );
        }
        case "pixel-capture": {
          const blob = await deps.captureRect(source.rect!);
          return await deps.ingestBlob(blob, `captured-image-${Date.now()}.png`);
        }
      }
    } catch (error) {
      attempts.push({ strategy, reason: describeFailure(error) });
    }
  }

  throw new ImageAcquisitionError(buildFailureMessage(source, attempts), attempts);
}

function buildFailureMessage(
  source: ImageAcquisitionSource,
  attempts: { strategy: StrategyName; reason: string }[],
): string {
  const name = getRemoteImageFileName(source.src) ?? "this image";
  if (attempts.length === 0) {
    return `Could not retrieve ${name}. The image has no readable source.`;
  }
  const detail = attempts.map((attempt) => `${attempt.strategy}: ${attempt.reason}`).join("; ");
  return `Could not retrieve ${name} after ${attempts.length} attempt${
    attempts.length === 1 ? "" : "s"
  }. Try opening the image in a new tab and saving it, then import it from the Image Registry. (${detail})`;
}
