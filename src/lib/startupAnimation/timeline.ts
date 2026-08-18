/**
 * Knowledge Peck timeline — pure construction, sampling, and acceleration.
 *
 * Everything here is deterministic math over the phase scripts in
 * variants.ts: no clock, no DOM, no store. The component samples this with
 * an injectable clock (test seam `__kpTestClock`) once per animation frame.
 *
 * Animated properties are strictly transform/opacity (spec: silent,
 * compositor-only animation). Opacity is monotonic per element within the
 * whole timeline — nothing oscillates, so the ≤3 luminance transitions/s
 * flashing limit holds by construction.
 */

import { KP_VARIANTS } from "./variants";
import type {
  ElementState,
  FormFactor,
  KPVariantId,
  Phase,
  PhaseName,
  Timeline,
} from "./types";

/* ------------------------------------------------------------------ */
/* Budgets (design D4, amended: complete-metaphor playback) — asserted  */
/* by tests.                                                           */
/* ------------------------------------------------------------------ */

/**
 * After appReady, pointer-events must be released (reveal start) within
 * this. Amendment rationale: the original 600 ms budget skipped straight to
 * the resolve epilogue on fast starts, so the pecks never visibly played —
 * the whole point of the branded moment. The policy now compresses the
 * remaining choreography at a higher tempo instead of dropping beats.
 */
export const REVEAL_START_BUDGET_MS = 900;
/** After appReady, the overlay must be fully unmounted within this. */
export const UNMOUNT_BUDGET_MS = 1150;
/** Wall-time budget for the remaining choreography on a fast start (desktop). */
export const FAST_PLAY_BUDGET_MS = 900;
/** Phone composition is shorter, so its fast-play budget is tighter. */
export const FAST_PLAY_BUDGET_PHONE_MS = 700;
/** Reveal crossfade duration (overlay container fade). */
export const REVEAL_FADE_MS = 250;

/* ------------------------------------------------------------------ */
/* Small math helpers                                                  */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Progress of t through the [start, end] window, clamped to [0, 1]. */
const progress = (t: number, start: number, end: number): number =>
  end <= start ? (t >= end ? 1 : 0) : clamp01((t - start) / (end - start));

const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);

const easeInOutSine = (p: number): number => -(Math.cos(Math.PI * p) - 1) / 2;

/** There-and-back curve: 0 → 1 → 0 over p ∈ [0, 1] (peck dips, impulses). */
const pulse = (p: number): number => Math.sin(Math.PI * clamp01(p));

const round2 = (v: number): number => Math.round(v * 100) / 100;

/* ------------------------------------------------------------------ */
/* Scene layout (container-relative px; container capped at 480 wide)  */
/* ------------------------------------------------------------------ */

interface SceneLayout {
  mascot: { x: number; y: number };
  /** Where each fragment floats before its peck. */
  float: { x: number; y: number }[];
  /** Structural slot each pecked card snaps into. */
  slot: { x: number; y: number }[];
  /** Cards converge toward this point during resolve. */
  converge: { x: number; y: number };
  wordmark: { x: number; y: number };
  /** Token-card footprint (phone uses larger elements, D5 composition rule). */
  card: { width: number; height: number };
}

const LAYOUTS: Record<FormFactor, SceneLayout> = {
  desktop: {
    mascot: { x: 240, y: 118 },
    float: [
      { x: 104, y: 196 },
      { x: 240, y: 238 },
      { x: 376, y: 196 },
    ],
    slot: [
      { x: 168, y: 292 },
      { x: 240, y: 292 },
      { x: 312, y: 292 },
    ],
    converge: { x: 240, y: 150 },
    wordmark: { x: 240, y: 262 },
    card: { width: 76, height: 52 },
  },
  phone: {
    mascot: { x: 240, y: 132 },
    float: [
      { x: 128, y: 226 },
      { x: 352, y: 226 },
    ],
    slot: [
      { x: 185, y: 312 },
      { x: 295, y: 312 },
    ],
    converge: { x: 240, y: 164 },
    wordmark: { x: 240, y: 290 },
    card: { width: 96, height: 64 },
  },
};

export type { SceneLayout };

/** Composition coordinates for a form factor (shared with the components). */
export function sceneLayout(formFactor: FormFactor): SceneLayout {
  return LAYOUTS[formFactor];
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export function buildTimeline(
  variant: KPVariantId,
  formFactor: FormFactor
): Timeline {
  const script = KP_VARIANTS[variant][formFactor];
  const phases = script.phases;
  const phaseAt = (t: number): Phase => {
    let current = phases[0];
    for (const phase of phases) {
      if (t >= phase.start) current = phase;
      else break;
    }
    return current;
  };
  return { variant, formFactor, script, phases, phaseAt };
}

/* ------------------------------------------------------------------ */
/* Sampling                                                            */
/* ------------------------------------------------------------------ */

const findPhase = (tl: Timeline, name: PhaseName): Phase | undefined =>
  tl.phases.find((p) => p.name === name);

/**
 * Head rotation/offset track. The glance is piecewise-eased between phase
 * boundaries; each peck dips there-and-back within its own window. Values
 * outside all windows settle to 0 (rest pose).
 */
function headPose(t: number, tl: Timeline): { rot: number; dy: number } {
  const notice = findPhase(tl, "notice");
  if (notice) {
    const mid = (notice.start + notice.end) / 2;
    if (t < mid) {
      const p = easeInOutSine(progress(t, notice.start, mid));
      return { rot: lerp(0, -8, p), dy: lerp(0, 2, p) };
    }
    if (t < notice.end) {
      const p = easeInOutSine(progress(t, mid, notice.end));
      return { rot: lerp(-8, 6, p), dy: 2 };
    }
    // Settle from the glance back to rest before the first peck.
    const settleEnd = notice.end + 40;
    if (t < settleEnd) {
      const p = easeInOutSine(progress(t, notice.end, settleEnd));
      return { rot: lerp(6, 0, p), dy: lerp(2, 0, p) };
    }
  }

  for (let i = 1; i <= tl.script.peckCount; i++) {
    const peck = findPhase(tl, `peck-${i}` as PhaseName);
    if (!peck) continue;
    if (t >= peck.start && t < peck.end) {
      const p = progress(t, peck.start, peck.end);
      const dip = pulse(p);
      // Alternate dip lean so consecutive pecks read as distinct motions.
      const lean = i % 2 === 1 ? 1 : -1;
      return {
        rot: (12 + lean * 2) * dip,
        dy: 10 * dip,
      };
    }
  }
  return { rot: 0, dy: 0 };
}

interface FragmentTrack {
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

/**
 * One fragment's full journey: float in (fragments phase) → snap to its slot
 * with a restrained scale impulse (its peck) → tighten (consolidate) →
 * converge into the mark and fade (converge phase).
 */
function fragmentState(
  t: number,
  tl: Timeline,
  index: number,
  layout: SceneLayout
): FragmentTrack {
  const fragments = findPhase(tl, "fragments")!;
  const floatIn = fragments.start + index * 70;
  const appear = easeOutCubic(progress(t, floatIn, floatIn + 200));

  let { x, y } = layout.float[index];
  let scale = lerp(0.94, 1, appear);
  let opacity = appear;

  const peck = findPhase(tl, `peck-${index + 1}` as PhaseName);
  if (peck && t >= peck.start) {
    const p = easeInOutSine(progress(t, peck.start, peck.end));
    x = lerp(layout.float[index].x, layout.slot[index].x, p);
    y = lerp(layout.float[index].y, layout.slot[index].y, p);
    // Restrained scale impulse 1.0 → 1.08 → 1.0 while snapping into place.
    scale = 1 + 0.08 * pulse(p);
  }

  const consolidate = findPhase(tl, "consolidate");
  if (consolidate && t >= consolidate.start) {
    const p = easeInOutSine(progress(t, consolidate.start, consolidate.end));
    // Tighten: row draws slightly toward its center card.
    const center = layout.slot[tl.script.fragmentCount > 2 ? 1 : 0];
    x = lerp(x, lerp(layout.slot[index].x, center.x, 0.12), p);
    y = lerp(y, layout.slot[index].y - 8, p);
    scale = lerp(scale, 0.96, p);
  }

  const converge = findPhase(tl, "converge")!;
  if (t >= converge.start) {
    const p = easeInOutSine(progress(t, converge.start, converge.end));
    x = lerp(x, layout.converge.x, p);
    y = lerp(y, layout.converge.y, p);
    scale = lerp(scale, 0.35, p);
    opacity = lerp(1, 0, p);
  }

  return { x, y, scale, opacity };
}

/**
 * Sample every animated element at virtual time t. Returns a stable-length
 * array in stable order; same input always yields the same output.
 */
export function sampleTimeline(timeline: Timeline, t: number): ElementState[] {
  const layout = LAYOUTS[timeline.formFactor];
  const script = timeline.script;
  const states: ElementState[] = [];

  // Mascot group: static-parity from frame one (opacity 1), tiny settle.
  // Scene position is CSS-owned (static geometry from sceneLayout); the
  // driver's transform is only the settle scale.
  const entrance = findPhase(timeline, "entrance")!;
  const settle = easeOutCubic(progress(t, entrance.start, entrance.end));
  const birdScale = lerp(0.98, 1, settle);
  states.push({
    id: "bird",
    opacity: 1,
    transform: `scale(${round2(birdScale)})`,
  });

  const head = headPose(t, timeline);
  states.push({
    id: "bird-head",
    opacity: 1,
    transform: `rotate(${round2(head.rot)}deg) translateY(${round2(head.dy)}px)`,
  });

  // Wing: small flutter during each peck window (transform-only motion).
  let wingRot = 0;
  for (let i = 1; i <= script.peckCount; i++) {
    const peck = findPhase(timeline, `peck-${i}` as PhaseName)!;
    if (t >= peck.start && t < peck.end) {
      wingRot = 5 * pulse(progress(t, peck.start, peck.end));
      break;
    }
  }
  states.push({
    id: "bird-wing",
    opacity: 1,
    transform: `rotate(${round2(wingRot)}deg)`,
  });

  for (let i = 0; i < script.fragmentCount; i++) {
    const f = fragmentState(t, timeline, i, layout);
    states.push({
      id: `fragment-${i + 1}`,
      opacity: round2(clamp01(f.opacity)),
      transform: `translate(${round2(f.x)}px, ${round2(f.y)}px) scale(${round2(f.scale)})`,
    });
  }

  // Connector i joins card i with card i+1; it draws during peck-(i+1).
  for (let i = 0; i + 1 < script.fragmentCount; i++) {
    const draw = findPhase(timeline, `peck-${i + 2}` as PhaseName)!;
    const sx = easeInOutSine(progress(t, draw.start, draw.end));
    states.push({
      id: `connector-${i + 1}`,
      opacity: 1,
      transform: `scaleX(${round2(sx)})`,
    });
  }

  const wordmark = findPhase(timeline, "wordmark")!;
  const wp = easeOutCubic(progress(t, wordmark.start, wordmark.end));
  states.push({
    id: "wordmark",
    opacity: round2(wp),
    transform: `translate(${layout.wordmark.x}px, ${round2(lerp(layout.wordmark.y + 10, layout.wordmark.y, wp))}px)`,
  });

  return states;
}

/**
 * Discrete card styling at t: "raw" token, emphasized "card" (post-peck),
 * or "gone" (converged into the mark). Drives data attributes only — never
 * transform/opacity, which sampleTimeline owns.
 */
export type FragmentVisualState = "raw" | "card" | "gone";

export function fragmentVisualStatesAt(
  timeline: Timeline,
  t: number
): FragmentVisualState[] {
  const converge = findPhase(timeline, "converge")!;
  const out: FragmentVisualState[] = [];
  for (let i = 0; i < timeline.script.fragmentCount; i++) {
    const peck = findPhase(timeline, `peck-${i + 1}` as PhaseName)!;
    if (t >= converge.start + (converge.end - converge.start) * 0.7) {
      out.push("gone");
    } else if (t >= peck.start + (peck.end - peck.start) / 2) {
      out.push("card");
    } else {
      out.push("raw");
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Acceleration plan (design D4, amended)                              */
/* ------------------------------------------------------------------ */

export interface AccelerationPlan {
  kind: "accelerate" | "resolve";
  /** Single playback rate applied from the ready moment on (≥ 1). */
  timeScale: number;
  /**
   * Virtual time playback continues from once ready. "accelerate" keeps the
   * current position (continuous); "resolve" restarts at converge.start —
   * the idle end-state equals converge's start-state (cards at slots,
   * wordmark hidden), so the restart is visually continuous while still
   * playing the converge+wordmark motion at 1×.
   */
  startVirtualMs: number;
  /** Wall ms from APP_READY at which reveal (pointer release) begins. */
  revealStartInMs: number;
  /** Wall ms from APP_READY at which the overlay is fully unmounted. */
  unmountInMs: number;
}

/**
 * Plan how the remaining choreography compresses once APP_READY arrives.
 *
 * Amended policy (complete-metaphor playback): a fast start must never
 * *skip* the pecks — the compression time-scales every remaining beat
 * (fragments → pecks → connect → consolidate → resolve) into the fast-play
 * budget instead of warping past them. A slow start that already reached
 * idle still resolves at 1× (the idle end-state equals converge's
 * start-state, so the virtual restart is visually continuous).
 *
 * The driver maps wall→virtual as
 *   virtual = startVirtualMs + (now − readyWallAt) × timeScale
 * which is monotonic by construction (timeScale ≥ 1); "accelerate" plans
 * never jump (startVirtualMs = the current position).
 */
export function accelerationPlan(
  elapsedAtReady: number,
  timeline: Timeline
): AccelerationPlan {
  const elapsed = Math.max(0, elapsedAtReady);
  const { script } = timeline;
  const converge = findPhase(timeline, "converge")!;

  if (elapsed >= script.idleAt) {
    // Resolve at 1× from the start of converge.
    const span = script.brandedSpanEnd - converge.start;
    return {
      kind: "resolve",
      timeScale: 1,
      startVirtualMs: converge.start,
      revealStartInMs: span,
      unmountInMs: span + REVEAL_FADE_MS,
    };
  }

  // Fast start (anywhere before idle): compress the REMAINING choreography
  // — every un-played beat included — into the form factor's play budget.
  const budget =
    timeline.formFactor === "phone" ? FAST_PLAY_BUDGET_PHONE_MS : FAST_PLAY_BUDGET_MS;
  const remaining = Math.max(0, script.brandedSpanEnd - elapsed);
  const wallSpan = Math.min(remaining, budget);
  const timeScale = remaining / Math.max(wallSpan, 1);

  return {
    kind: "accelerate",
    timeScale: Math.max(1, round2(timeScale)),
    startVirtualMs: elapsed,
    revealStartInMs: wallSpan,
    unmountInMs: wallSpan + REVEAL_FADE_MS,
  };
}
