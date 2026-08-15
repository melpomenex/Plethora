/**
 * Source-image extraction for the OCR-backed occlusion flow (design D18 /
 * task 3.4).
 *
 * Every surface that opens the occlusion composer — PDF figure hover, EPUB
 * image hover, image-registry entry — routes the image through
 * `acquireImageAsset` → `ingest_image_asset` FIRST and opens the composer
 * with an asset id, so the registry is the one universal source. This module
 * turns that asset (or any raw data URL a caller rendered itself, e.g. a
 * pdf.js region capture) into a normalized `OcclusionSource` the assist flow
 * can OCR: base64 bytes + MIME + decoded pixel dimensions.
 *
 * Dimensions are decoded from the image header in TypeScript (PNG IHDR,
 * JPEG SOF markers, WebP VP8/VP8L/VP8X) — no DOM required, so unit tests and
 * workers can use it too.
 */

export type OcclusionSourceKind =
  | "registry"
  | "data-url"
  /** A caller-rendered bitmap (pdf.js page/region render, canvas capture). */
  | "rendered";

/** One analyzable source image for occlusion assistance. */
export interface OcclusionSource {
  /** Base64-encoded image bytes WITHOUT the data-url prefix. */
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  /** Decoded pixel dimensions (header parse); undefined when undecodable. */
  width?: number;
  height?: number;
  /** Registry asset id when the image is (or became) a registry asset. */
  imageAssetId?: string;
  sourceKind: OcclusionSourceKind;
  /** Raw bytes for hashing; derived lazily from `imageBase64`. */
  bytes: Uint8Array;
}

/** Minimal image-registry asset shape this module needs (avoids api import). */
export interface OcclusionImageAssetLike {
  id: string;
  data_url: string;
  width?: number;
  height?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Base64 / data-url helpers
// ──────────────────────────────────────────────────────────────────────────

export function base64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, "");
  const binary =
    typeof atob === "function"
      ? atob(cleaned)
      : Buffer.from(cleaned, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
}

/** Split a `data:<mime>;base64,<payload>` URL; null when not a data URL. */
export function parseDataUrl(
  dataUrl: string
): { mimeType: string; imageBase64: string } | null {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), imageBase64: match[2].replace(/\s+/g, "") };
}

// ──────────────────────────────────────────────────────────────────────────
// Header-based dimension decoding
// ──────────────────────────────────────────────────────────────────────────

/**
 * Decode image pixel dimensions from raw bytes. Supports PNG, JPEG, and
 * WebP (the three MIME types the occlusion flow accepts). Returns undefined
 * for anything else or malformed headers — callers degrade to OCR-reported
 * source dims.
 */
export function decodeImageDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  return decodePngDimensions(bytes) ?? decodeJpegDimensions(bytes) ?? decodeWebpDimensions(bytes);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function decodePngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!isPng(bytes)) return undefined;
  // IHDR must be the first chunk: 8-byte signature + 4 length + "IHDR".
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== "IHDR") return undefined;
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function decodeJpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (!isJpeg(bytes)) return undefined;
  // Walk segments to the first SOF marker (frame header carries the dims).
  let offset = 2;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (sofMarkers.has(marker)) {
      const height = readUint16BE(bytes, offset + 5);
      const width = readUint16BE(bytes, offset + 7);
      if (width > 0 && height > 0) return { width, height };
      return undefined;
    }
    // Standalone markers without length payloads restart the scan.
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = readUint16BE(bytes, offset + 2);
    if (length <= 0) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function decodeWebpDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const hasHeader =
    bytes.length > 30 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50; // P
  if (!hasHeader) return undefined;

  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === "VP8X") {
    // Extended: canvas dims are 24-bit values stored -1, little-endian.
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    // Lossy: frame tag is 3 bytes, then sync code 0x9d012a, then dims (14-bit
    // little-endian with 2 low bits discarded).
    const base = 23;
    if (
      bytes[base] === 0x9d &&
      bytes[base + 1] === 0x01 &&
      bytes[base + 2] === 0x2a
    ) {
      const width = readUint16LE(bytes, base + 3) & 0x3fff;
      const height = readUint16LE(bytes, base + 5) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
    return undefined;
  }
  if (chunk === "VP8L") {
    // Lossless: signature 0x2f, then 14-bit dims packed into 4 bytes LE.
    const base = 21;
    if (bytes[base] !== 0x2f) return undefined;
    const bits = bytes[base + 1] | (bytes[base + 2] << 8) | (bytes[base + 3] << 16) | (bytes[base + 4] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  return undefined;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

// ──────────────────────────────────────────────────────────────────────────
// Source builders
// ──────────────────────────────────────────────────────────────────────────

const SUPPORTED_OCCLUSION_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export class OcclusionSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcclusionSourceError";
  }
}

/**
 * Build an `OcclusionSource` from a data URL (`data:image/png;base64,…`).
 * Throws `OcclusionSourceError` for non-data URLs or unsupported MIME types —
 * the assist flow surfaces the message; manual authoring stays untouched.
 */
export function occlusionSourceFromDataUrl(
  dataUrl: string,
  options?: { sourceKind?: OcclusionSourceKind; imageAssetId?: string }
): OcclusionSource {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new OcclusionSourceError("Source is not a base64 data URL.");
  }
  if (!SUPPORTED_OCCLUSION_MIME.has(parsed.mimeType)) {
    throw new OcclusionSourceError(
      `Unsupported image MIME type for occlusion: ${parsed.mimeType}`
    );
  }
  const bytes = base64ToBytes(parsed.imageBase64);
  const mimeType = parsed.mimeType as OcclusionSource["mimeType"];
  return {
    imageBase64: parsed.imageBase64,
    mimeType,
    ...decodeImageDimensions(bytes),
    imageAssetId: options?.imageAssetId,
    sourceKind: options?.sourceKind ?? "data-url",
    bytes,
  };
}

/**
 * Build an `OcclusionSource` from an image-registry asset (the universal
 * path: PDF figure hovers, EPUB image hovers, and registry entries are all
 * ingested into the registry before the composer opens). Registry-recorded
 * dimensions win; otherwise the header is decoded here.
 */
export function occlusionSourceFromAsset(asset: OcclusionImageAssetLike): OcclusionSource {
  const source = occlusionSourceFromDataUrl(asset.data_url, {
    sourceKind: "registry",
    imageAssetId: asset.id,
  });
  if (source.width === undefined || source.height === undefined) {
    return {
      ...source,
      width: asset.width ?? source.width,
      height: asset.height ?? source.height,
    };
  }
  return source;
}

/** Build a source from already-decoded bytes (rendered pdf.js captures). */
export function occlusionSourceFromBytes(
  bytes: Uint8Array,
  mimeType: OcclusionSource["mimeType"],
  options?: { imageAssetId?: string }
): OcclusionSource {
  return {
    imageBase64: bytesToBase64(bytes),
    mimeType,
    ...decodeImageDimensions(bytes),
    imageAssetId: options?.imageAssetId,
    sourceKind: "rendered",
    bytes,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Staleness fingerprint (spec: source-image change invalidates proposals)
// ──────────────────────────────────────────────────────────────────────────

/**
 * SHA-256 hex digest of the source bytes via WebCrypto. The assist flow
 * records this when proposals are made and re-checks at save time; a
 * mismatch marks the proposals stale (never silently applied to new pixels).
 * Test environments without `crypto.subtle` fall back to a non-cryptographic
 * digest — still a faithful change detector for the stale check.
 */
export async function sha256SourceFingerprint(source: OcclusionSource): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const view = new Uint8Array(source.bytes);
    const digest = await subtle.digest("SHA-256", view);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // FNV-1a over the bytes (deterministic, no-crypto environments).
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.bytes.length; i++) {
    hash ^= source.bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16)}-${source.bytes.length.toString(16)}`;
}
