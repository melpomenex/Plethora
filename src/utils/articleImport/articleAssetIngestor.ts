/**
 * Durable asset ingestion for canonical article imports.
 *
 * Discovers remote images in sanitized HTML, fetches through SSRF-guarded
 * infrastructure, deduplicates via the image registry, and rewrites `src`
 * to `plethora-asset://` logical URLs for offline rendering. Figures whose
 * download fails degrade to their retained absolute remote URL (never a
 * stripped src); only user cancellation aborts the import.
 */

import { ingestImageBlob, ingestRemoteImage } from "../../api/image-registry";
import { isTauri } from "../../lib/tauri";
import { normalizeArticleUrl } from "./urlNormalizer";
import { isBlockedMediaHost } from "./mediaUrlPolicy";
import {
  ARTICLE_ASSET_MAX_BYTES,
  ARTICLE_ASSET_MAX_COUNT,
  ARTICLE_ASSET_MAX_TOTAL_BYTES,
  ARTICLE_ASSET_FETCH_CONCURRENCY,
} from "./extractor-config";
import { toArticleAssetUrl } from "./articleAssetScheme";
import { throwIfAborted } from "./errors";

export type ArticleAssetFailureReason =
  | "invalid_url"
  | "private_address"
  | "fetch_failed"
  | "timeout"
  | "too_large"
  | "unsupported_type"
  | "invalid_content"
  | "unsafe_svg"
  | "storage_failed"
  | "canceled"
  | "skipped";

export interface ArticleAssetFailure {
  sourceUrl: string;
  reason: ArticleAssetFailureReason;
  message?: string;
}

export interface ArticleAssetDiagnostics {
  discovered: number;
  imported: number;
  reused: number;
  failed: number;
  rejected: number;
  /** Figures whose ingestion failed and were degraded to their remote URL
   * (CSP already allows https: images — a live figure beats removal). */
  degradedToRemote: number;
  totalBytes: number;
  assetIds: string[];
  failures: ArticleAssetFailure[];
}

export interface IngestArticleAssetsOptions {
  referrerUrl?: string;
  signal?: AbortSignal;
  preserveImages?: boolean;
}

export interface IngestArticleAssetsResult {
  html: string;
  diagnostics: ArticleAssetDiagnostics;
}

const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

function emptyDiagnostics(): ArticleAssetDiagnostics {
  return {
    discovered: 0,
    imported: 0,
    reused: 0,
    failed: 0,
    rejected: 0,
    degradedToRemote: 0,
    totalBytes: 0,
    assetIds: [],
    failures: [],
  };
}

function isRemoteHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return !isBlockedMediaHost(url);
  } catch {
    return false;
  }
}

async function fetchImageInBrowser(
  imageUrl: string,
  referrerUrl: string | undefined,
  signal?: AbortSignal
): Promise<{ blob: Blob; mimeType: string }> {
  const normalized = normalizeArticleUrl(imageUrl);
  if (!normalized.valid) {
    throw new Error(normalized.error ?? "invalid_url");
  }

  const response = await fetch(normalized.normalized, {
    signal,
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      ...(referrerUrl ? { Referer: referrerUrl } : {}),
    },
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > ARTICLE_ASSET_MAX_BYTES) {
    throw new Error("too_large");
  }
  const blob = await response.blob();
  if (blob.size > ARTICLE_ASSET_MAX_BYTES) {
    throw new Error("too_large");
  }
  const headerMime = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const mimeType =
    headerMime && SUPPORTED_IMAGE_MIME.has(headerMime)
      ? headerMime
      : blob.type && SUPPORTED_IMAGE_MIME.has(blob.type)
        ? blob.type
        : "";
  if (!mimeType || !mimeType.startsWith("image/")) {
    throw new Error("unsupported_type");
  }
  return { blob, mimeType };
}

function fileNameFromUrl(url: string): string | undefined {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last || undefined;
  } catch {
    return undefined;
  }
}

function mapIngestError(err: unknown): ArticleAssetFailureReason {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/canceled|aborted/i.test(message)) return "canceled";
  if (/private|localhost|not allowed|unsupported scheme/i.test(message)) return "private_address";
  if (/invalid.*url|unparseable/i.test(message)) return "invalid_url";
  if (/too large|exceeds max/i.test(message)) return "too_large";
  if (/unsupported image|unsupported_type|text\/html/i.test(message)) return "unsupported_type";
  if (/svg|unsafe/i.test(message)) return "unsafe_svg";
  if (/timeout/i.test(message)) return "timeout";
  return "fetch_failed";
}

async function ingestOneRemoteImage(
  sourceUrl: string,
  referrerUrl: string | undefined,
  signal?: AbortSignal
): Promise<{ assetId: string; byteSize: number; reused: boolean }> {
  throwIfAborted(signal);
  if (isTauri()) {
    const asset = await ingestRemoteImage(sourceUrl, fileNameFromUrl(sourceUrl), referrerUrl);
    return { assetId: asset.id, byteSize: asset.byte_size, reused: false };
  }
  const { blob, mimeType } = await fetchImageInBrowser(sourceUrl, referrerUrl, signal);
  const asset = await ingestImageBlob(blob, fileNameFromUrl(sourceUrl) ?? undefined);
  if (!asset.mime_type.startsWith("image/")) {
    throw new Error("unsupported_type");
  }
  return { assetId: asset.id, byteSize: asset.byte_size ?? blob.size, reused: false };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Ingest remote images referenced by sanitized canonical HTML.
 * When `preserveImages` is false, returns HTML unchanged with empty diagnostics.
 */
export async function ingestArticleAssets(
  html: string,
  options: IngestArticleAssetsOptions = {}
): Promise<IngestArticleAssetsResult> {
  if (options.preserveImages === false) {
    return { html, diagnostics: emptyDiagnostics() };
  }

  const diagnostics = emptyDiagnostics();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const images = [...doc.querySelectorAll<HTMLImageElement>("img[src]")];
  const remoteImages = images.filter((img) => isRemoteHttpUrl(img.getAttribute("src") ?? ""));
  diagnostics.discovered = remoteImages.length;

  if (remoteImages.length === 0) {
    return { html, diagnostics };
  }

  if (remoteImages.length > ARTICLE_ASSET_MAX_COUNT) {
    diagnostics.rejected = remoteImages.length - ARTICLE_ASSET_MAX_COUNT;
    remoteImages.splice(ARTICLE_ASSET_MAX_COUNT);
  }

  const urlToResult = new Map<string, { assetId: string; byteSize: number; reused: boolean }>();
  let reservedBytes = 0;

  const uniqueUrls = [...new Set(remoteImages.map((img) => img.getAttribute("src")!))];

  await mapWithConcurrency(
    uniqueUrls,
    ARTICLE_ASSET_FETCH_CONCURRENCY,
    async (sourceUrl) => {
      throwIfAborted(options.signal);
      if (reservedBytes >= ARTICLE_ASSET_MAX_TOTAL_BYTES) {
        diagnostics.rejected += 1;
        diagnostics.failures.push({ sourceUrl, reason: "too_large", message: "aggregate limit" });
        return;
      }
      try {
        const result = await ingestOneRemoteImage(sourceUrl, options.referrerUrl, options.signal);
        if (reservedBytes + result.byteSize > ARTICLE_ASSET_MAX_TOTAL_BYTES) {
          diagnostics.rejected += 1;
          diagnostics.failures.push({ sourceUrl, reason: "too_large", message: "aggregate limit" });
          return;
        }
        reservedBytes += result.byteSize;
        urlToResult.set(sourceUrl, result);
        diagnostics.totalBytes += result.byteSize;
        if (result.reused) diagnostics.reused += 1;
        else diagnostics.imported += 1;
        if (!diagnostics.assetIds.includes(result.assetId)) {
          diagnostics.assetIds.push(result.assetId);
        }
      } catch (err) {
        const reason = mapIngestError(err);
        if (reason === "canceled") throw err;
        diagnostics.failed += 1;
        diagnostics.failures.push({
          sourceUrl,
          reason,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );

  for (const img of remoteImages) {
    const src = img.getAttribute("src") ?? "";
    const ingested = urlToResult.get(src);
    if (ingested) {
      img.setAttribute("src", toArticleAssetUrl(ingested.assetId));
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
    } else {
      // Ingestion failed for this figure: retain the already-absolutized
      // remote http(s) URL instead of stripping src. CSP permits https:
      // images, so the figure may still load from the live site — strictly
      // better than removal, and the reader never sees an img whose src was
      // rewritten to a non-image document URL. Only srcset/sizes go: they
      // may still reference unabsolutized or stale candidates.
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      diagnostics.degradedToRemote += 1;
    }
  }

  const bodyHtml = doc.body.innerHTML;
  return { html: bodyHtml, diagnostics };
}
