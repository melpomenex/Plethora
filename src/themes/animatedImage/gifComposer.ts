import {
  ANIMATED_IMAGE_LIMITS,
  AnimatedImagePreparationError,
  type AnimatedImagePack,
  type AnimatedImagePaletteSample,
  type PreparedAnimatedImage,
} from "./contracts";
import { preflightGif, type GifFrameMetadata, type GifPreflightResult } from "./gifPreflight";
import { createStrictGifDecoder, type StrictGifFrame } from "./gifDecoder";
import { GifFlashRiskSampler } from "./gifFlashRisk";

export interface GifPreparationOptions {
  readonly bytes: Uint8Array;
  readonly mediaId: string;
  readonly tier: "desktop" | "mobile";
  readonly progress: (stage: "validating" | "analyzing" | "preparing-preview", fraction: number) => void;
  readonly isCurrent: () => boolean;
}

interface RetainedFrame {
  readonly index: number;
  readonly startMs: number;
  readonly durationMs: number;
}

/** Strictly decode, compose, sample and encode a single GIF in an isolated worker. */
export async function prepareGif(options: GifPreparationOptions): Promise<PreparedAnimatedImage> {
  const { bytes, mediaId, tier, progress, isCurrent } = options;
  const deadline = performance.now() + ANIMATED_IMAGE_LIMITS.foregroundJobMs;
  progress("validating", 0.02);
  const preflight = preflightGif(bytes);
  const decoder = await createStrictGifDecoder(bytes);
  try {
    assertCurrent(isCurrent, deadline);
    assertDecoderMatchesPreflight(decoder.info, preflight);

    const sourceCanvas = new OffscreenCanvas(preflight.width, preflight.height);
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true, alpha: true });
    if (!sourceContext) {
      throw new AnimatedImagePreparationError(
        "worker-unavailable",
        "This device cannot prepare animated image frames in a worker.",
        { capability: "worker-canvas-2d" }
      );
    }
    initializeCanvas(sourceContext, preflight);

    const sampleSize = fitSize(preflight.width, preflight.height, 96, 9_216);
    const sampleCanvas = new OffscreenCanvas(sampleSize.width, sampleSize.height);
    const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true, alpha: true });
    if (!sampleContext) {
      throw new AnimatedImagePreparationError(
        "worker-unavailable",
        "This device cannot sample animated image frames.",
        { capability: "worker-canvas-2d" }
      );
    }

    const outputSize = fitSize(
      preflight.width,
      preflight.height,
      ANIMATED_IMAGE_LIMITS[tier].edge,
      ANIMATED_IMAGE_LIMITS[tier].pixels
    );
    const outputCanvas = new OffscreenCanvas(outputSize.width, outputSize.height);
    const outputContext = outputCanvas.getContext("2d", { alpha: true });
    if (!outputContext) {
      throw new AnimatedImagePreparationError(
        "worker-unavailable",
        "This device cannot encode animated image frames.",
        { capability: "worker-canvas-2d" }
      );
    }

    const thumbnailSize = fitSize(preflight.width, preflight.height, 48, 2_304);
    const thumbnailCanvas = new OffscreenCanvas(thumbnailSize.width, thumbnailSize.height);
    const thumbnailContext = thumbnailCanvas.getContext("2d", { alpha: true });
    if (!thumbnailContext) {
      throw new AnimatedImagePreparationError(
        "worker-unavailable",
        "This device cannot make an image-theme thumbnail.",
        { capability: "worker-canvas-2d" }
      );
    }

    const timeline = getTimeline(preflight.frames);
    const retainedFrames = chooseRetainedFrames(timeline, preflight.durationMs, tier);
    const retainedIndex = new Map(retainedFrames.map((frame, index) => [frame.index, index]));
    const paletteWeights = getPaletteFrameWeights(timeline, preflight.durationMs);
    const paletteSamples: AnimatedImagePaletteSample[] = [];
    const flashSampler = new GifFlashRiskSampler();
    const outputFrames: Array<AnimatedImagePack["frames"][number]> = [];
    let previous: { metadata: GifFrameMetadata; restore?: ImageData } | null = null;
    let firstPosterAssets: { poster: Blob; thumbnail: Blob; thumbnailDataUrl: string } | null = null;
    let poster: Blob | null = null;
    let thumbnail: Blob | null = null;
    let thumbnailDataUrl: string | null = null;
    let outputByteLength = 0;
    let packFailure: PreparedAnimatedImage["stillReason"];

    progress("analyzing", 0.05);
    for (let index = 0; index < preflight.frames.length; index += 1) {
      assertCurrent(isCurrent, deadline);
      const frame = decoder.next();
      if (!frame) {
        throw decodeError("The GIF ended before all declared frames were decoded.");
      }
      const metadata = preflight.frames[index];
      assertFrameMatchesPreflight(frame, metadata);

      if (previous) applyDisposal(sourceContext, preflight, previous.metadata, previous.restore);
      const restore = metadata.disposal === 3
        ? sourceContext.getImageData(metadata.left, metadata.top, metadata.width, metadata.height)
        : undefined;
      drawIndexedPatch(sourceContext, frame);
      previous = { metadata, restore };

      const samplePixels = samplePresentation(
        sourceCanvas,
        sampleCanvas,
        sampleContext,
        sampleSize.width,
        sampleSize.height
      );
      flashSampler.push(samplePixels, timeline[index].startMs);
      const paletteWeight = paletteWeights.get(index);
      if (paletteWeight) {
        paletteSamples.push({
          pixels: samplePixels.slice(),
          width: sampleSize.width,
          height: sampleSize.height,
          weightMs: paletteWeight,
        });
      }

      const target = retainedIndex.get(index);
      if (target !== undefined && !packFailure) {
        try {
          const blob = await encodePackFrame(sourceCanvas, outputCanvas, outputContext);
          const frameInfo = retainedFrames[target];
          if (outputByteLength + blob.size > ANIMATED_IMAGE_LIMITS[tier].outputBytes) {
            packFailure = "output-too-large";
            outputFrames.length = 0;
          } else {
            outputFrames.push({
              startMs: frameInfo.startMs,
              durationMs: frameInfo.durationMs,
              still: blob,
              width: outputSize.width,
              height: outputSize.height,
            });
            outputByteLength += blob.size;
          }
        } catch {
          packFailure = "pack-encode-failed";
          outputFrames.length = 0;
        }
      }

      const alphaCoverage = getAlphaCoverage(samplePixels);
      if (index === 0) {
        const assets = await encodePosterAssets(
          sourceCanvas,
          outputCanvas,
          outputContext,
          thumbnailCanvas,
          thumbnailContext
        );
        firstPosterAssets = assets;
        if (alphaCoverage >= 0.05) {
          poster = assets.poster;
          thumbnail = assets.thumbnail;
          thumbnailDataUrl = assets.thumbnailDataUrl;
        }
      } else if (!poster && alphaCoverage >= 0.05) {
        const assets = await encodePosterAssets(
          sourceCanvas,
          outputCanvas,
          outputContext,
          thumbnailCanvas,
          thumbnailContext
        );
        poster = assets.poster;
        thumbnail = assets.thumbnail;
        thumbnailDataUrl = assets.thumbnailDataUrl;
      }

      if ((index & 7) === 7) await yieldToWorker();
      progress("analyzing", 0.05 + ((index + 1) / preflight.frames.length) * 0.72);
    }

    if (decoder.next() !== null) {
      throw decodeError("The GIF contains more frames than its validated structure declares.");
    }
    if (!poster) {
      if (!firstPosterAssets) throw posterError("The GIF did not produce a usable poster image.");
      poster = firstPosterAssets.poster;
      thumbnail = firstPosterAssets.thumbnail;
      thumbnailDataUrl = firstPosterAssets.thumbnailDataUrl;
    }

    assertCurrent(isCurrent, deadline);
    const unsafeFlashing = flashSampler.finish(preflight.durationMs);
    if (unsafeFlashing) {
      packFailure = "unsafe-flashing";
      outputFrames.length = 0;
    }

    const totalOutputBytes = outputByteLength + poster.size;
    if (totalOutputBytes > ANIMATED_IMAGE_LIMITS[tier].outputBytes) {
      packFailure = "output-too-large";
      outputFrames.length = 0;
    }
    if (retainedFrames.length < 2) {
      packFailure ||= "unsupported-feature";
      outputFrames.length = 0;
    }

    const pack: AnimatedImagePack | undefined = !packFailure && outputFrames.length >= 2
      ? {
          version: 1,
          mediaId,
          sourceFormat: "gif",
          sourceWidth: preflight.width,
          sourceHeight: preflight.height,
          width: outputSize.width,
          height: outputSize.height,
          durationMs: preflight.durationMs,
          plays: preflight.plays,
          frames: outputFrames,
          byteLength: outputByteLength,
          droppedTransitions: retainedFrames.length !== preflight.frames.length,
        }
      : undefined;

    progress("preparing-preview", 1);
    return {
      mediaId,
      tier,
      outcome: pack ? "animated" : "still",
      poster,
      thumbnail: thumbnail!,
      thumbnailDataUrl: thumbnailDataUrl!,
      width: outputSize.width,
      height: outputSize.height,
      sourceWidth: preflight.width,
      sourceHeight: preflight.height,
      paletteSamples,
      pack,
      stillReason: pack ? undefined : packFailure || "pack-encode-failed",
    };
  } finally {
    decoder.close();
  }
}

function assertDecoderMatchesPreflight(
  decoder: { readonly width: number; readonly height: number; readonly plays: number | "infinite" },
  preflight: GifPreflightResult
): void {
  if (
    decoder.width !== preflight.width ||
    decoder.height !== preflight.height ||
    decoder.plays !== preflight.plays
  ) {
    throw decodeError("The GIF decoder disagreed with its validated frame header.");
  }
}

function assertFrameMatchesPreflight(frame: StrictGifFrame, metadata: GifFrameMetadata): void {
  const delayMs = frame.delayCentiseconds * 10 < 20 ? 100 : frame.delayCentiseconds * 10;
  if (
    frame.left !== metadata.left ||
    frame.top !== metadata.top ||
    frame.width !== metadata.width ||
    frame.height !== metadata.height ||
    frame.disposal !== metadata.disposal ||
    frame.transparentIndex !== metadata.transparentIndex ||
    delayMs !== metadata.delayMs
  ) {
    throw decodeError("The GIF decoder disagreed with its validated frame metadata.");
  }
}

function initializeCanvas(
  context: OffscreenCanvasRenderingContext2D,
  preflight: GifPreflightResult
): void {
  context.clearRect(0, 0, preflight.width, preflight.height);
  if (preflight.backgroundColor && !preflight.transparentCanvas) {
    const [red, green, blue] = preflight.backgroundColor;
    context.fillStyle = `rgb(${red} ${green} ${blue})`;
    context.fillRect(0, 0, preflight.width, preflight.height);
  }
}

function applyDisposal(
  context: OffscreenCanvasRenderingContext2D,
  preflight: GifPreflightResult,
  previous: GifFrameMetadata,
  restore?: ImageData
): void {
  if (previous.disposal === 2) {
    if (preflight.backgroundColor && !preflight.transparentCanvas) {
      const [red, green, blue] = preflight.backgroundColor;
      context.fillStyle = `rgb(${red} ${green} ${blue})`;
      context.fillRect(previous.left, previous.top, previous.width, previous.height);
    } else {
      context.clearRect(previous.left, previous.top, previous.width, previous.height);
    }
  } else if (previous.disposal === 3 && restore) {
    context.putImageData(restore, previous.left, previous.top);
  }
}

function drawIndexedPatch(context: OffscreenCanvasRenderingContext2D, frame: StrictGifFrame): void {
  const pixels = new Uint8ClampedArray(frame.indices.length * 4);
  for (let index = 0; index < frame.indices.length; index += 1) {
    const paletteIndex = frame.indices[index];
    const offset = index * 4;
    const colorOffset = paletteIndex * 3;
    pixels[offset] = frame.palette[colorOffset];
    pixels[offset + 1] = frame.palette[colorOffset + 1];
    pixels[offset + 2] = frame.palette[colorOffset + 2];
    pixels[offset + 3] = paletteIndex === frame.transparentIndex ? 0 : 255;
  }
  context.putImageData(new ImageData(pixels, frame.width, frame.height), frame.left, frame.top);
}

function samplePresentation(
  source: OffscreenCanvas,
  sample: OffscreenCanvas,
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number
): Uint8ClampedArray {
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data.slice();
}

function getAlphaCoverage(pixels: Uint8ClampedArray): number {
  let visible = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) visible += 1;
  }
  return visible / Math.max(1, pixels.length / 4);
}

function getTimeline(frames: readonly GifFrameMetadata[]): Array<GifFrameMetadata & { startMs: number }> {
  let startMs = 0;
  return frames.map((frame) => {
    const entry = { ...frame, startMs };
    startMs += frame.delayMs;
    return entry;
  });
}

function chooseRetainedFrames(
  timeline: readonly (GifFrameMetadata & { startMs: number })[],
  durationMs: number,
  tier: "desktop" | "mobile"
): RetainedFrame[] {
  const minimumInterval = 1_000 / ANIMATED_IMAGE_LIMITS[tier].framesPerSecond;
  const selected: RetainedFrame[] = [];
  for (let index = 0; index < timeline.length; index += 1) {
    const frame = timeline[index];
    if (index === 0 || frame.startMs - selected[selected.length - 1].startMs >= minimumInterval) {
      selected.push({ index, startMs: frame.startMs, durationMs: 0 });
    }
  }
  while (selected.length > 1 && durationMs - selected[selected.length - 1].startMs < minimumInterval) {
    selected.pop();
  }
  return selected.map((frame, index) => ({
    ...frame,
    durationMs: (selected[index + 1]?.startMs ?? durationMs) - frame.startMs,
  }));
}

export function getPaletteFrameWeights(
  timeline: readonly (GifFrameMetadata & { startMs: number })[],
  durationMs: number
): Map<number, number> {
  if (timeline.length <= 12) {
    return new Map(timeline.map((frame, index) => [index, frame.delayMs]));
  }
  const weights = new Map<number, number>();
  const stratumWeight = durationMs / 12;
  for (let stratum = 0; stratum < 12; stratum += 1) {
    const midpoint = durationMs * ((stratum + 0.5) / 12);
    const frameIndex = timeline.findIndex((frame) => midpoint < frame.startMs + frame.delayMs);
    const selectedIndex = frameIndex < 0 ? timeline.length - 1 : frameIndex;
    weights.set(selectedIndex, (weights.get(selectedIndex) || 0) + stratumWeight);
  }
  return weights;
}

async function encodePackFrame(
  source: OffscreenCanvas,
  output: OffscreenCanvas,
  context: OffscreenCanvasRenderingContext2D
): Promise<Blob> {
  context.clearRect(0, 0, output.width, output.height);
  context.drawImage(source, 0, 0, output.width, output.height);
  try {
    const webp = await output.convertToBlob({ type: "image/webp", quality: 0.86 });
    if (webp.type === "image/webp" && webp.size > 0) return webp;
  } catch {
    // PNG is the interoperable independent-frame fallback.
  }
  const png = await output.convertToBlob({ type: "image/png" });
  if (png.type !== "image/png" || png.size <= 0) {
    throw new AnimatedImagePreparationError("pack-encode-failed", "The animation frame could not be encoded.");
  }
  return png;
}

async function encodePosterAssets(
  source: OffscreenCanvas,
  output: OffscreenCanvas,
  outputContext: OffscreenCanvasRenderingContext2D,
  thumbnail: OffscreenCanvas,
  thumbnailContext: OffscreenCanvasRenderingContext2D
): Promise<{ poster: Blob; thumbnail: Blob; thumbnailDataUrl: string }> {
  outputContext.clearRect(0, 0, output.width, output.height);
  outputContext.drawImage(source, 0, 0, output.width, output.height);
  const poster = await output.convertToBlob({ type: "image/png" });
  if (poster.type !== "image/png" || poster.size <= 0) {
    throw posterError("The image poster could not be encoded as PNG.");
  }
  const thumbnailAssets = await encodeThumbnail(source, thumbnail, thumbnailContext);
  return { poster, ...thumbnailAssets };
}

async function encodeThumbnail(
  source: OffscreenCanvas,
  thumbnail: OffscreenCanvas,
  context: OffscreenCanvasRenderingContext2D
): Promise<{ thumbnail: Blob; thumbnailDataUrl: string }> {
  context.clearRect(0, 0, thumbnail.width, thumbnail.height);
  context.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
  const blob = await thumbnail.convertToBlob({ type: "image/png" });
  if (blob.type !== "image/png" || blob.size <= 0 || blob.size > 24 * 1024) {
    throw posterError("The theme thumbnail could not be encoded safely.");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const base64 = btoa(String.fromCharCode(...bytes));
  return { thumbnail: blob, thumbnailDataUrl: `data:image/png;base64,${base64}` };
}

function fitSize(width: number, height: number, maxEdge: number, maxPixels: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

function assertCurrent(isCurrent: () => boolean, deadline: number): void {
  if (!isCurrent()) throw new AnimatedImagePreparationError("cancelled", "Image preparation was cancelled.");
  if (performance.now() > deadline) {
    throw new AnimatedImagePreparationError("deadline-exceeded", "This GIF took too long to prepare.");
  }
}

function yieldToWorker(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function decodeError(message: string): AnimatedImagePreparationError {
  return new AnimatedImagePreparationError("decode-failed", message);
}

function posterError(message: string): AnimatedImagePreparationError {
  return new AnimatedImagePreparationError("poster-encode-failed", message, {
    capability: "png-encode",
  });
}
