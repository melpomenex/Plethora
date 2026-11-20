export interface TimedRgbaSample {
  readonly pixels: Uint8ClampedArray;
  readonly timeMs: number;
}

type FlashKind = "luminance" | "red";
type Direction = "forward" | "reverse";

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
    const beforeAlpha = before[offset + 3] / 255;
    const afterAlpha = after[offset + 3] / 255;
    const beforeRed = before[offset];
    const beforeGreen = before[offset + 1];
    const beforeBlue = before[offset + 2];
    const afterRed = after[offset];
    const afterGreen = after[offset + 1];
    const afterBlue = after[offset + 2];
    const beforeBlack = luminance(
      beforeRed * beforeAlpha,
      beforeGreen * beforeAlpha,
      beforeBlue * beforeAlpha
    );
    const beforeWhite = luminance(
      beforeRed * beforeAlpha + 255 * (1 - beforeAlpha),
      beforeGreen * beforeAlpha + 255 * (1 - beforeAlpha),
      beforeBlue * beforeAlpha + 255 * (1 - beforeAlpha)
    );
    const afterBlack = luminance(afterRed * afterAlpha, afterGreen * afterAlpha, afterBlue * afterAlpha);
    const afterWhite = luminance(
      afterRed * afterAlpha + 255 * (1 - afterAlpha),
      afterGreen * afterAlpha + 255 * (1 - afterAlpha),
      afterBlue * afterAlpha + 255 * (1 - afterAlpha)
    );

    if (isBrightToDark(beforeBlack, afterBlack) || isBrightToDark(beforeWhite, afterWhite)) {
      luminanceForward = true;
    }
    if (isBrightToDark(afterBlack, beforeBlack) || isBrightToDark(afterWhite, beforeWhite)) {
      luminanceReverse = true;
    }

    const wasRed = isSaturatedRed(beforeRed, beforeGreen, beforeBlue);
    const isRed = isSaturatedRed(afterRed, afterGreen, afterBlue);
    if (!wasRed && isRed) redForward = true;
    if (wasRed && !isRed) redReverse = true;
  }

  if (luminanceForward) output.push({ timeMs, kind: "luminance", direction: "forward" });
  if (luminanceReverse) output.push({ timeMs, kind: "luminance", direction: "reverse" });
  if (redForward) output.push({ timeMs, kind: "red", direction: "forward" });
  if (redReverse) output.push({ timeMs, kind: "red", direction: "reverse" });
}

function isBrightToDark(from: number, to: number): boolean {
  return from >= 0.8 && to <= 0.1;
}

function luminance(red: number, green: number, blue: number): number {
  const redLinear = linearize(red / 255);
  const greenLinear = linearize(green / 255);
  const blueLinear = linearize(blue / 255);
  return (0.2126 * redLinear) + (0.7152 * greenLinear) + (0.0722 * blueLinear);
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function isSaturatedRed(red: number, green: number, blue: number): boolean {
  return red >= 160 && red > green * 1.2 && red > blue * 1.2 && (red - Math.min(green, blue)) >= 80;
}
