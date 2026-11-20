import { bench } from "vitest";
import { seededRandom } from "../../test/bench-support";
import { extractPaletteFromWeightedSamples } from "../imageThemeExtractor";
import { getPaletteFrameWeights } from "./gifComposer";
import { preflightGif, type GifFrameMetadata } from "./gifPreflight";

let sink = 0;

const preflightBytes = createGifFixture(200, 0x71a9);
const temporalTimeline = createTimeline(450, 0x219b);
const paletteSamples = createPaletteSamples(12, 64, 0x5eed);

bench("animated-image/preflight-200-frames", () => {
  const result = preflightGif(preflightBytes);
  sink ^= result.frames.length ^ result.durationMs ^ result.width;
});

bench("animated-image/temporal-sampling-450-frames", () => {
  const weights = getPaletteFrameWeights(temporalTimeline, temporalTimeline.at(-1)!.startMs + temporalTimeline.at(-1)!.delayMs);
  let folded = weights.size;
  for (const [index, weight] of weights) folded ^= index ^ Math.round(weight);
  sink ^= folded;
});

bench("animated-image/palette-histogram-12x64", () => {
  const result = extractPaletteFromWeightedSamples(paletteSamples);
  sink ^= result.swatches.length ^ Math.round(result.medianLightness * 1_000);
  for (const swatch of result.swatches) sink ^= swatch.hex.charCodeAt(1);
});

function createGifFixture(frameCount: number, seed: number): Uint8Array {
  const random = seededRandom(seed);
  const bytes: number[] = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x01, 0x00, 0x01, 0x00, // 1x1 logical screen
    0x80, 0x00, 0x00, // two-entry global table, black background
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
    0x21, 0xff, 0x0b, // NETSCAPE2.0 loop extension
    ...Array.from("NETSCAPE2.0", (character) => character.charCodeAt(0)),
    0x03, 0x01, 0x00, 0x00, 0x00, // repeat forever
  ];

  for (let index = 0; index < frameCount; index += 1) {
    const delay = 2 + Math.floor(random() * 4);
    bytes.push(
      0x21, 0xf9, 0x04, 0x00, delay, 0x00, 0x00, 0x00, // graphic control
      0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // 1x1 image
      0x02, 0x02, 0x44, 0x01, 0x00 // minimal clear/index/end LZW stream
    );
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

function createTimeline(frameCount: number, seed: number): Array<GifFrameMetadata & { startMs: number }> {
  const random = seededRandom(seed);
  let startMs = 0;
  return Array.from({ length: frameCount }, () => {
    const delayMs = 16 + Math.floor(random() * 185);
    const frame = {
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      delayMs,
      disposal: 1 as const,
      transparentIndex: null,
      startMs,
    };
    startMs += delayMs;
    return frame;
  });
}

function createPaletteSamples(sampleCount: number, edge: number, seed: number) {
  const random = seededRandom(seed);
  return Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const pixels = new Uint8ClampedArray(edge * edge * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels[offset] = Math.floor(random() * 256);
      pixels[offset + 1] = Math.floor(random() * 256);
      pixels[offset + 2] = Math.floor(random() * 256);
      pixels[offset + 3] = Math.floor(64 + random() * 192);
    }
    return { pixels, width: edge, height: edge, weightMs: 250 + sampleIndex * 25 };
  });
}

void sink;
