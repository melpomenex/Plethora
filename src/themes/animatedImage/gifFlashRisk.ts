export interface TimedRgbaSample {
  readonly pixels: Uint8ClampedArray;
  readonly timeMs: number;
}

type FlashKind = "luminance" | "red";
type Direction = "forward" | "reverse";

interface LinearRgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

const BACKDROPS = [0, 255] as const;
const SATURATED_RED_SHARE = 0.8;
const RED_CHROMATICITY_THRESHOLD = 0.2;

interface FlashTransition {
  readonly timeMs: number;
  readonly kind: FlashKind;
  readonly direction: Direction;
}

/** Conservative sampled screen for repeated bright/dark or saturated-red flashes. */
export function hasHighFlashRisk(samples: readonly TimedRgbaSample[], cycleDurationMs: number): boolean {
  const sampler = new GifFlashRiskSampler();
  for (const sample of [...samples].sort((left, right) => left.timeMs - right.timeMs)) {
    sampler.push(sample.pixels, sample.timeMs);
  }
  return sampler.finish(cycleDurationMs);
}

/** Retains only the first/previous small sample while collecting transition events. */
export class GifFlashRiskSampler {
  private firstPixels: Uint8ClampedArray | null = null;
  private previousPixels: Uint8ClampedArray | null = null;
  private readonly transitions: FlashTransition[] = [];

  push(pixels: Uint8ClampedArray, timeMs: number): void {
    if (!this.firstPixels) {
      this.firstPixels = pixels.slice();
      this.previousPixels = pixels.slice();
      return;
    }
    collectTransition(this.previousPixels!, pixels, timeMs, this.transitions);
    this.previousPixels = pixels.slice();
  }

  finish(cycleDurationMs: number): boolean {
    if (!this.firstPixels || !this.previousPixels || cycleDurationMs <= 0) return false;
    collectTransition(this.previousPixels, this.firstPixels, cycleDurationMs, this.transitions);
    return transitionsAreUnsafe(this.transitions, cycleDurationMs);
  }
}

function transitionsAreUnsafe(transitions: readonly FlashTransition[], cycleDurationMs: number): boolean {
  if (transitions.length < 2) return false;

  const kinds: FlashKind[] = ["luminance", "red"];
  for (const anchor of transitions) {
    for (const kind of kinds) {
      const directions = new Set<Direction>();
      let count = 0;
      for (const candidate of transitions) {
        if (candidate.kind !== kind) continue;
        const firstCycleOffset = -1;
        const lastCycleOffset = Math.ceil(1_000 / cycleDurationMs) + 1;
        for (let cycleOffset = firstCycleOffset; cycleOffset <= lastCycleOffset; cycleOffset += 1) {
          const elapsed = candidate.timeMs + cycleOffset * cycleDurationMs - anchor.timeMs;
          if (elapsed >= 0 && elapsed <= 1_000) {
            count += 1;
            directions.add(candidate.direction);
          }
        }
      }
      // This intentionally trips before the WCAG three-flash ceiling.
      if (count >= 4 && directions.size > 1) return true;
    }
  }
  return false;
}

function collectTransition(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  timeMs: number,
  output: FlashTransition[]
): void {
  const pixels = Math.min(Math.floor(before.length / 4), Math.floor(after.length / 4));
  let luminanceForward = false;
  let luminanceReverse = false;
  let redForward = false;
  let redReverse = false;

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    if (
      before[offset] === after[offset] && before[offset + 1] === after[offset + 1] &&
      before[offset + 2] === after[offset + 2] && before[offset + 3] === after[offset + 3]
    ) continue;

    for (const backdrop of BACKDROPS) {
      const beforeColor = readCompositedColor(before, offset, backdrop);
      const afterColor = readCompositedColor(after, offset, backdrop);
      const beforeLuminance = luminance(beforeColor);
      const afterLuminance = luminance(afterColor);
      luminanceForward ||= isBrightToDark(beforeLuminance, afterLuminance);
      luminanceReverse ||= isBrightToDark(afterLuminance, beforeLuminance);

      const beforeRedShare = redShare(beforeColor);
      const afterRedShare = redShare(afterColor);
      if (
        Math.max(beforeRedShare, afterRedShare) >= SATURATED_RED_SHARE &&
        hasRedChromaticityChange(beforeColor, afterColor)
      ) {
        redForward ||= beforeRedShare < afterRedShare;
        redReverse ||= beforeRedShare > afterRedShare;
      }

      if (before[offset + 3] === 255 && after[offset + 3] === 255) break;
    }
  }

  if (luminanceForward) output.push({ timeMs, kind: "luminance", direction: "forward" });
  if (luminanceReverse) output.push({ timeMs, kind: "luminance", direction: "reverse" });
  if (redForward) output.push({ timeMs, kind: "red", direction: "forward" });
  if (redReverse) output.push({ timeMs, kind: "red", direction: "reverse" });
}

function isBrightToDark(from: number, to: number): boolean {
  return from >= 0.8 && to <= 0.1;
}

function readCompositedColor(
  pixels: Uint8ClampedArray, offset: number, backdrop: number
): LinearRgb {
  const alpha = pixels[offset + 3] / 255;
  const base = backdrop * (1 - alpha);
  return {
    red: linearize((pixels[offset] * alpha + base) / 255),
    green: linearize((pixels[offset + 1] * alpha + base) / 255),
    blue: linearize((pixels[offset + 2] * alpha + base) / 255),
  };
}

function luminance({ red, green, blue }: LinearRgb): number {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function redShare({ red, green, blue }: LinearRgb): number {
  return red > 0 ? red / (red + green + blue) : 0;
}

function hasRedChromaticityChange(before: LinearRgb, after: LinearRgb): boolean {
  const from = chromaticity(before);
  const to = chromaticity(after);
  // Black has no defined chromaticity. Retain detection of bright red flashing against black.
  if (!from || !to) return Math.abs(luminance(before) - luminance(after)) >= 0.1;
  const deltaU = from.u - to.u;
  const deltaV = from.v - to.v;
  return deltaU * deltaU + deltaV * deltaV > RED_CHROMATICITY_THRESHOLD ** 2;
}

/** CIE 1976 UCS coordinates used by the WCAG 2.2 red flash definition. */
function chromaticity({ red, green, blue }: LinearRgb): { u: number; v: number } | null {
  const x = 0.4124564 * red + 0.3575761 * green + 0.1804375 * blue;
  const y = 0.2126729 * red + 0.7151522 * green + 0.0721750 * blue;
  const z = 0.0193339 * red + 0.1191920 * green + 0.9503041 * blue;
  const scale = x + 15 * y + 3 * z;
  return scale > 0 ? { u: 4 * x / scale, v: 9 * y / scale } : null;
}
