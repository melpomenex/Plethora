// @vitest-environment jsdom
/**
 * Ambient renderer benchmarks.
 *
 * Measures the JavaScript frame cost of representative effects plus the hot
 * pure functions of the renderer layer. Context stubs are plain no-op objects
 * (never vi.fn — call recording would dominate), so the numbers reflect the
 * draw logic itself: the plasma case documents exactly the CPU per-pixel cost
 * the WebGL2 backend takes off the main thread.
 */
import { bench } from "vitest";
import { drawJellyfishFrame, layoutJellyfish } from "./jellyfishRenderer";
import { resolveJellyfishPalette } from "../../../themes/jellyfishPalettes";
import { LEGACY_EFFECTS } from "./renderer/canvas2d/legacyEffects";
import { computeBackingSize, resolveQuality } from "./renderer/qualityPolicy";
import { findEffect } from "./renderer/effects";
import { createFrameScheduler } from "./renderer/frameScheduler";
import "../../../test/bench-dom-setup";

/* ------------------------------------------------------------------ */
/*  Deterministic canvas stubs                                         */
/* ------------------------------------------------------------------ */

const noop = () => {};

function makeCtx2d(_size: number): CanvasRenderingContext2D {
  return {
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    drawImage: noop,
    putImageData: noop,
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4),
      width: w,
      height: h,
    }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    fillText: noop,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

/** Run exactly one draw iteration of a legacy AnimFn (rAF neutered). */
function runOneFrame(anim: (a: unknown) => void, cv: HTMLCanvasElement, density = 1): void {
  let first = true;
  anim({
    cv,
    ctx: makeCtx2d(cv.width * cv.height),
    density,
    _frameInterval: 0,
    timer: noop,
    onResize: noop,
    frame: noop,
    shouldRender: () => {
      const ok = first;
      first = false;
      return ok;
    },
  });
}

const desktop = document.createElement("canvas");
desktop.width = 1920;
desktop.height = 1080;

// jsdom has no canvas backend: legacy effects that allocate their own buffer
// canvas (plasma) need a working getContext returning the stub context.
(HTMLCanvasElement.prototype as unknown as { getContext: () => CanvasRenderingContext2D }).getContext =
  function () {
    return makeCtx2d(1920 * 1080);
  };

// Neuter rAF so legacy effect loops park after their first frame, and stub
// setInterval so effects that register spawner timers (rain's lightning,
// meteorshower, …) cannot leak thousands of real 2–8 s intervals per run.
(window as unknown as { requestAnimationFrame: () => number }).requestAnimationFrame = () => 1;
(window as unknown as { setInterval: () => number }).setInterval = () => 1;
(window as unknown as { clearInterval: () => void }).clearInterval = () => {};

let sink = 0;

/* ------------------------------------------------------------------ */
/*  Effect frame costs                                                 */
/* ------------------------------------------------------------------ */

bench("ambient/plasma-canvas2d-frame-1080p", () => {
  runOneFrame(LEGACY_EFFECTS.plasma, desktop);
  sink += 1;
});

bench("ambient/jellyfish-draw-frame-1080p", () => {
  const cv = desktop;
  const palette = resolveJellyfishPalette("deep-ocean-glow");
  const jelly = layoutJellyfish(cv);
  const ctx = makeCtx2d(cv.width * cv.height);
  const particles = new Array(12).fill(0).map((_, i) => ({
    nx: (i * 37 % 100) / 100,
    ny: (i * 71 % 100) / 100,
    z: 0.2 + (i % 6) * 0.1,
    speed: 0.05 + (i % 5) * 0.02,
    r: 0.4 + (i % 4) * 0.3,
    phase: i * 0.52,
  }));
  drawJellyfishFrame(ctx, cv, palette, jelly, particles, 12_000, true);
  sink += ctx.lineWidth;
});

bench("ambient/rain-canvas2d-frame-1080p", () => {
  runOneFrame(LEGACY_EFFECTS.rain, desktop);
  sink += 1;
});

/* ------------------------------------------------------------------ */
/*  Renderer hot paths                                                 */
/* ------------------------------------------------------------------ */

const envMatrix = [
  { mobile: false, onBattery: false, reducedMotion: false, animationsEnabled: true, visible: true },
  { mobile: false, onBattery: true, reducedMotion: false, animationsEnabled: true, visible: true },
  { mobile: true, onBattery: false, reducedMotion: false, animationsEnabled: true, visible: true },
  { mobile: true, onBattery: true, reducedMotion: false, animationsEnabled: true, visible: true },
];

bench("ambient/quality-resolve-sweep", () => {
  for (let i = 0; i < 1000; i++) {
    const env = envMatrix[i % envMatrix.length];
    sink += resolveQuality(env, i % 2 === 0 ? "webgl2" : "canvas2d").fps;
  }
});

bench("ambient/backing-size-sweep", () => {
  for (let i = 0; i < 1000; i++) {
    const size = computeBackingSize(1280 + (i % 4) * 320, 720 + (i % 3) * 180, (i % 3) + 1, 0.5 + (i % 4) * 0.15);
    sink += size.width;
  }
});

const effectIds = [
  "plasma", "aurora", "nebula", "oceanwaves", "northern", "underwater", "sunbeams",
  "synthsun", "lavalamp", "cosmicdust", "bioglow", "starwarp", "jellyfish", "rain",
];

bench("ambient/effect-lookup-sweep", () => {
  for (let i = 0; i < 1000; i++) {
    const effect = findEffect(effectIds[i % effectIds.length]);
    sink += effect ? 1 : 0;
  }
});

bench("ambient/scheduler-decision", () => {
  const scheduler = createFrameScheduler({ draw: noop });
  for (let i = 0; i < 200; i++) {
    scheduler.start(30);
    scheduler.setFps(24);
    scheduler.stop();
  }
  sink += 1;
});

// Keep `sink` observably alive so the engine cannot elide the loops.
if (sink === Number.POSITIVE_INFINITY) console.error("unreachable", sink);
