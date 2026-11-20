import {
  ANIMATED_IMAGE_LIMITS,
  AnimatedImagePreparationError,
  type AnimatedImageRepeatCount,
} from "./contracts";

const HEADER_BYTES = 13;
const MAX_GIF_COLOR_ENTRIES = 256;

export interface GifFrameMetadata {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly delayMs: number;
  readonly disposal: 0 | 1 | 2 | 3;
  readonly transparentIndex: number | null;
}

export interface GifPreflightResult {
  readonly width: number;
  readonly height: number;
  readonly backgroundColor: readonly [number, number, number] | null;
  readonly transparentCanvas: boolean;
  readonly frames: readonly GifFrameMetadata[];
  readonly durationMs: number;
  readonly plays: AnimatedImageRepeatCount;
  readonly hasLoopExtension: boolean;
}

interface GraphicControl {
  readonly delayCentiseconds: number;
  readonly disposal: 0 | 1 | 2 | 3;
  readonly transparentIndex: number | null;
}

/** Walks GIF framing and declared work before the strict Rust LZW decoder runs. */
export function preflightGif(bytes: Uint8Array): GifPreflightResult {
  if (bytes.byteLength === 0) {
    throw preparationError("empty-input", "The selected image is empty.");
  }
  if (bytes.byteLength > ANIMATED_IMAGE_LIMITS.inputBytes) {
    throw preparationError("input-too-large", "This image is larger than the 16 MiB import limit.");
  }

  const cursor = new GifCursor(bytes);
  const signature = cursor.readAscii(6);
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw preparationError("invalid-signature", "The selected file is not a valid GIF image.");
  }
  cursor.require(HEADER_BYTES - 6);
  const width = cursor.readU16();
  const height = cursor.readU16();
  const packed = cursor.readU8();
  const backgroundIndex = cursor.readU8();
  cursor.readU8(); // Pixel aspect ratio is advisory and not used for layout.
  assertDimensions(width, height);

  const hasGlobalPalette = (packed & 0x80) !== 0;
  const globalPalette = hasGlobalPalette
    ? cursor.readBytes(colorTableBytes(packed & 0x07))
    : null;
  const backgroundColor = globalPalette && backgroundIndex < globalPalette.length / 3
    ? [
        globalPalette[backgroundIndex * 3],
        globalPalette[backgroundIndex * 3 + 1],
        globalPalette[backgroundIndex * 3 + 2],
      ] as const
    : null;

  const frames: GifFrameMetadata[] = [];
  let pendingControl: GraphicControl | null = null;
  let loopRepeats: number | null = null;
  let loopExtensionCount = 0;
  let sourcePixels = 0;
  let totalDurationMs = 0;
  let sawTrailer = false;

  while (!cursor.done) {
    const marker = cursor.readU8();
    if (marker === 0x3b) {
      sawTrailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = cursor.readU8();
      if (label === 0xf9) {
        if (pendingControl) malformed("A GIF contains more than one control block before a frame.");
        const blockSize = cursor.readU8();
        if (blockSize !== 4) malformed("A GIF frame control block has an invalid size.");
        const control = cursor.readU8();
        const delayCentiseconds = cursor.readU16();
        const transparentIndex = cursor.readU8();
        if (cursor.readU8() !== 0) malformed("A GIF frame control block is not terminated.");
        if ((control & 0xe0) !== 0) malformed("A GIF frame control block uses reserved flags.");
        if ((control & 0x02) !== 0) {
          throw preparationError("unsupported-feature", "This GIF requests user input to advance a frame.");
        }
        const disposalValue = (control >> 2) & 0x07;
        if (disposalValue > 3) {
          throw preparationError("unsupported-feature", "This GIF uses an unsupported frame disposal mode.");
        }
        pendingControl = {
          delayCentiseconds,
          disposal: disposalValue as 0 | 1 | 2 | 3,
          transparentIndex: (control & 0x01) !== 0 ? transparentIndex : null,
        };
        continue;
      }

      if (label === 0x01) {
        throw preparationError("unsupported-feature", "This GIF uses animated text rendering that is not supported.");
      }

      if (label === 0xff) {
        const applicationHeaderSize = cursor.readU8();
        if (applicationHeaderSize !== 11) malformed("A GIF application extension has an invalid header.");
        const applicationId = cursor.readAscii(11);
        const firstData = cursor.readSubBlocks((block, first) => {
          if (first) return block.slice();
          return null;
        });
        if (applicationId === "NETSCAPE2.0" || applicationId === "ANIMEXTS1.0") {
          if (!firstData || firstData.length !== 3 || firstData[0] !== 1) {
            malformed("A GIF loop extension is malformed.");
          }
          const repeats = firstData[1] | (firstData[2] << 8);
          if (loopRepeats !== null && loopRepeats !== repeats) {
            malformed("A GIF contains conflicting loop extensions.");
          }
          loopRepeats = repeats;
          loopExtensionCount += 1;
          continue;
        }
        if (firstData?.length) {
          // The extension was structurally consumed; no unknown app data is retained.
        }
        continue;
      }

      cursor.readSubBlocks();
      continue;
    }

    if (marker !== 0x2c) malformed("The GIF contains an unknown block marker.");
    if (frames.length >= ANIMATED_IMAGE_LIMITS.sourceFrames) {
      throw preparationError("frame-limit", "This GIF contains more than 450 frames.");
    }

    const left = cursor.readU16();
    const top = cursor.readU16();
    const frameWidth = cursor.readU16();
    const frameHeight = cursor.readU16();
    const imagePacked = cursor.readU8();
    if (frameWidth === 0 || frameHeight === 0 || left + frameWidth > width || top + frameHeight > height) {
      malformed("A GIF frame extends outside its logical screen.");
    }
    if ((imagePacked & 0x18) !== 0) malformed("A GIF image descriptor uses reserved bits.");

    const localPalette = (imagePacked & 0x80) !== 0
      ? cursor.readBytes(colorTableBytes(imagePacked & 0x07))
      : null;
    const activePalette = localPalette || globalPalette;
    if (!activePalette) malformed("A GIF frame has no color table.");

    const control = pendingControl || {
      delayCentiseconds: 0,
      disposal: 0 as const,
      transparentIndex: null,
    };
    if (control.transparentIndex !== null && control.transparentIndex >= activePalette.length / 3) {
      malformed("A GIF transparency index is outside its color table.");
    }

    const minimumCodeSize = cursor.readU8();
    if (minimumCodeSize < 2 || minimumCodeSize > 8) {
      malformed("A GIF frame uses an unsupported LZW code size.");
    }
    cursor.readSubBlocks();

    const framePixels = frameWidth * frameHeight;
    const screenPixels = width * height;
    sourcePixels += framePixels;
    if (sourcePixels > ANIMATED_IMAGE_LIMITS.decodedPatchPixels) {
      throw preparationError("pixel-work-limit", "This GIF requires too much decoded frame data.");
    }
    if ((frames.length + 1) * screenPixels > ANIMATED_IMAGE_LIMITS.composedPixels) {
      throw preparationError("pixel-work-limit", "This GIF requires too much compositing work.");
    }

    const delayMs = normalizeFrameDelay(control.delayCentiseconds);
    totalDurationMs += delayMs;
    if (totalDurationMs > ANIMATED_IMAGE_LIMITS.cycleMs) {
      throw preparationError("timeline-limit", "This GIF animation is longer than 30 seconds.");
    }
    frames.push({
      left,
      top,
      width: frameWidth,
      height: frameHeight,
      delayMs,
      disposal: control.disposal,
      transparentIndex: control.transparentIndex,
    });
    pendingControl = null;
  }

  if (!sawTrailer || !cursor.done) malformed("The GIF trailer is missing or has trailing data.");
  if (pendingControl) malformed("A GIF ends with a frame control block that has no image.");
  if (frames.length === 0) malformed("The GIF contains no image frames.");

  const hasLoopExtension = loopExtensionCount > 0;
  const plays: AnimatedImageRepeatCount = !hasLoopExtension
    ? 1
    : loopRepeats === 0
      ? "infinite"
      : (loopRepeats || 0) + 1;

  return {
    width,
    height,
    backgroundColor,
    transparentCanvas: !backgroundColor || frames.some((frame) => frame.transparentIndex === backgroundIndex),
    frames,
    durationMs: totalDurationMs,
    plays,
    hasLoopExtension,
  };
}

function assertDimensions(width: number, height: number): void {
  if (
    width <= 0 || height <= 0 ||
    width > ANIMATED_IMAGE_LIMITS.sourceEdge ||
    height > ANIMATED_IMAGE_LIMITS.sourceEdge ||
    width * height > ANIMATED_IMAGE_LIMITS.sourcePixels
  ) {
    throw preparationError("dimension-limit", "This GIF exceeds the supported image dimensions.");
  }
}

function colorTableBytes(sizeBits: number): number {
  const entries = 1 << (sizeBits + 1);
  if (entries > MAX_GIF_COLOR_ENTRIES) malformed("A GIF color table has an invalid size.");
  return entries * 3;
}

function normalizeFrameDelay(delayCentiseconds: number): number {
  const milliseconds = delayCentiseconds * 10;
  return milliseconds < 20 ? 100 : milliseconds;
}

function malformed(message: string): never {
  throw preparationError("malformed-container", message);
}

function preparationError(
  code: ConstructorParameters<typeof AnimatedImagePreparationError>[0],
  message: string
): AnimatedImagePreparationError {
  return new AnimatedImagePreparationError(code, message);
}

class GifCursor {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset === this.bytes.byteLength;
  }

  require(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.byteLength) {
      malformed("The GIF ends inside a block.");
    }
  }

  readU8(): number {
    this.require(1);
    return this.bytes[this.offset++];
  }

  readU16(): number {
    const low = this.readU8();
    return low | (this.readU8() << 8);
  }

  readAscii(length: number): string {
    this.require(length);
    const start = this.offset;
    this.offset += length;
    return String.fromCharCode(...this.bytes.subarray(start, start + length));
  }

  readBytes(length: number): Uint8Array {
    this.require(length);
    const result = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  readSubBlocks<T>(onBlock?: (block: Uint8Array, first: boolean) => T | null): T | null {
    let first = true;
    let captured: T | null = null;
    while (true) {
      const length = this.readU8();
      if (length === 0) return captured;
      const block = this.readBytes(length);
      if (onBlock) {
        const candidate = onBlock(block, first);
        if (candidate !== null) captured = candidate;
      }
      first = false;
    }
  }
}
