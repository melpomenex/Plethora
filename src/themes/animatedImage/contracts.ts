/** Shared contracts for locally prepared animated-image themes.
 *
 * These types describe prepared still-frame packs. They intentionally do not
 * expose GIF block, palette-table, or LZW details to storage or playback.
 */

export const ANIMATED_IMAGE_LIMITS = {
  inputBytes: 16 * 1024 * 1024,
  sourceEdge: 2048,
  sourcePixels: 2_073_600,
  sourceFrames: 450,
  cycleMs: 30_000,
  decodedPatchPixels: 150_000_000,
  composedPixels: 150_000_000,
  foregroundJobMs: 10_000,
  analysisMs: 4_000,
  desktop: {
    edge: 960,
    pixels: 518_400,
    framesPerSecond: 20,
    outputBytes: 24 * 1024 * 1024,
  },
  mobile: {
    edge: 640,
    pixels: 230_400,
    framesPerSecond: 12,
    outputBytes: 12 * 1024 * 1024,
  },
} as const;

export const ANIMATED_IMAGE_PACK_VERSION = 1 as const;

export type AnimatedImageFailureCode =
  | "cancelled"
  | "empty-input"
  | "invalid-signature"
  | "malformed-container"
  | "unsupported-feature"
  | "input-too-large"
  | "dimension-limit"
  | "frame-limit"
  | "timeline-limit"
  | "pixel-work-limit"
  | "deadline-exceeded"
  | "worker-unavailable"
  | "decoder-unavailable"
  | "decode-failed"
  | "poster-encode-failed"
  | "pack-encode-failed"
  | "output-too-large"
  | "unsafe-flashing"
  | "storage-unavailable"
  | "storage-write-failed"
  | "invalid-pack"
  | "asset-missing"
  | "asset-corrupt";

export type AnimatedImageCapabilityCode =
  | "module-worker"
  | "worker-canvas-2d"
  | "scratch-canvas-2d"
  | "create-image-bitmap"
  | "indexeddb-blob"
  | "png-encode"
  | "webp-encode";

export interface AnimatedImageCapabilityResult {
  readonly code: AnimatedImageCapabilityCode;
  readonly supported: boolean;
  readonly failure?: AnimatedImageFailureCode;
}

export type AnimatedImageRepeatCount = number | "infinite";

/** A complete presentation frame, not a source GIF patch. */
export interface AnimatedImageFrame {
  /** Start offset on the normalized, unrolled cycle timeline. */
  readonly startMs: number;
  /** Presentation hold duration. */
  readonly durationMs: number;
  readonly still: Blob;
  readonly width: number;
  readonly height: number;
}

/** A bounded, independently decodable still-frame rendition. */
export interface AnimatedImagePack {
  readonly version: typeof ANIMATED_IMAGE_PACK_VERSION;
  readonly mediaId: string;
  readonly sourceFormat: "gif";
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly width: number;
  readonly height: number;
  /** Duration of one normalized loop, before repeat count is applied. */
  readonly durationMs: number;
  /** Total plays; 1 is a single play, or "infinite". */
  readonly plays: AnimatedImageRepeatCount;
  readonly frames: readonly AnimatedImageFrame[];
  /** Sum of retained frame Blob sizes, checked before retaining each Blob. */
  readonly byteLength: number;
  readonly droppedTransitions: boolean;
}

export interface AnimatedImagePaletteSample {
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** Duration represented by this sample in the source cycle. */
  readonly weightMs: number;
}

export type AnimatedImagePreparationOutcome = "animated" | "still";

export type AnimatedImagePreparationStage =
  | "validating"
  | "analyzing"
  | "preparing-preview"
  | "still-fallback";

/** Result held in memory until the provider commits the asset generation. */
export interface PreparedAnimatedImage {
  readonly mediaId: string;
  readonly tier: "desktop" | "mobile";
  readonly outcome: AnimatedImagePreparationOutcome;
  readonly poster: Blob;
  readonly thumbnail: Blob;
  readonly thumbnailDataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly paletteSamples: readonly AnimatedImagePaletteSample[];
  readonly pack?: AnimatedImagePack;
  readonly stillReason?: AnimatedImageFailureCode;
}

/** Monotonic job identity used to ignore stale worker messages and results. */
export interface AnimatedImageJobToken {
  readonly generation: number;
  readonly isCurrent: () => boolean;
}

export interface AnimatedImageProgress {
  readonly generation: number;
  readonly stage: AnimatedImagePreparationStage;
  readonly fraction: number;
}

export interface AnimatedImagePreparationErrorOptions {
  readonly capability?: AnimatedImageCapabilityCode;
  readonly cause?: unknown;
}

/** Typed, user-safe failure classification for import and playback paths. */
export class AnimatedImagePreparationError extends Error {
  readonly code: AnimatedImageFailureCode;
  readonly capability?: AnimatedImageCapabilityCode;

  constructor(
    code: AnimatedImageFailureCode,
    message: string,
    options: AnimatedImagePreparationErrorOptions = {}
  ) {
    super(message);
    this.name = "AnimatedImagePreparationError";
    this.code = code;
    this.capability = options.capability;
    if (options.cause !== undefined) {
      Object.defineProperty(this, "cause", { configurable: true, value: options.cause });
    }
  }
}

export function isAnimatedImagePack(
  value: unknown,
  tier: "desktop" | "mobile" = "desktop",
  expectedMediaId?: string
): value is AnimatedImagePack {
  const renditionLimit = ANIMATED_IMAGE_LIMITS[tier];
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AnimatedImagePack>;
  if (
    candidate.version !== ANIMATED_IMAGE_PACK_VERSION ||
    typeof candidate.mediaId !== "string" ||
    !/^anim-[a-z0-9-]{8,64}$/.test(candidate.mediaId) ||
    (expectedMediaId !== undefined && candidate.mediaId !== expectedMediaId) ||
    candidate.sourceFormat !== "gif" ||
    !isPositiveInteger(candidate.sourceWidth) ||
    !isPositiveInteger(candidate.sourceHeight) ||
    !isPositiveInteger(candidate.width) ||
    !isPositiveInteger(candidate.height) ||
    typeof candidate.durationMs !== "number" ||
    !Number.isFinite(candidate.durationMs) ||
    (candidate.durationMs ?? 0) <= 0 ||
    (candidate.durationMs ?? 0) > ANIMATED_IMAGE_LIMITS.cycleMs ||
    !isValidRepeatCount(candidate.plays) ||
    !Array.isArray(candidate.frames) ||
    candidate.frames.length < 2 ||
    candidate.frames.length > ANIMATED_IMAGE_LIMITS.sourceFrames ||
    typeof candidate.byteLength !== "number" ||
    !Number.isSafeInteger(candidate.byteLength) ||
    (candidate.byteLength ?? 0) <= 0 ||
    (candidate.byteLength ?? 0) > renditionLimit.outputBytes ||
    !isWithinRendition(candidate.width, candidate.height, renditionLimit.edge, renditionLimit.pixels) ||
    !isWithinRendition(
      candidate.sourceWidth,
      candidate.sourceHeight,
      ANIMATED_IMAGE_LIMITS.sourceEdge,
      ANIMATED_IMAGE_LIMITS.sourcePixels
    ) ||
    typeof candidate.droppedTransitions !== "boolean"
  ) {
    return false;
  }

  let priorEnd = 0;
  let frameBytes = 0;
  for (const frame of candidate.frames) {
    if (
      !frame ||
      !Number.isFinite(frame.startMs) ||
      Math.abs(frame.startMs - priorEnd) > 0.01 ||
      !Number.isFinite(frame.durationMs) ||
      frame.durationMs <= 0 ||
      typeof Blob === "undefined" ||
      !(frame.still instanceof Blob) ||
      frame.still.size <= 0 ||
      !isAllowedStillMime(frame.still.type) ||
      !isPositiveInteger(frame.width) ||
      !isPositiveInteger(frame.height) ||
      frame.width !== candidate.width ||
      frame.height !== candidate.height
    ) {
      return false;
    }
    priorEnd = frame.startMs + frame.durationMs;
    frameBytes += frame.still.size;
  }

  return frameBytes === candidate.byteLength && Math.abs(priorEnd - candidate.durationMs) <= 0.01;
}

function isWithinRendition(width: unknown, height: unknown, edge: number, pixels: number): boolean {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) return false;
  return Math.max(width, height) <= edge && width * height <= pixels;
}

function isAllowedStillMime(value: string): boolean {
  return value === "image/png" || value === "image/webp" || value === "image/jpeg";
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isValidRepeatCount(value: unknown): value is AnimatedImageRepeatCount {
  return (
    value === "infinite" ||
    (Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 65_536)
  );
}
