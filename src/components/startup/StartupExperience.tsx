/**
 * StartupExperience — the Knowledge Peck branded launch overlay.
 *
 * Layers (design D1): the static pre-React frame in index.html paints first;
 * this overlay renders an identical first frame (same mascot size/position/
 * colors from KP_GEOMETRY + the shared timeline layout) and plays the
 * choreography above the booting app; a 250 ms crossfade reveals it.
 *
 * Lifecycle (design D2/D3): appReady = startup data ready (ensureStartup
 * reaching "ready", which transitively implies backend-ready) AND the main
 * route painted (MainLayout marker). All timing flows through an injectable
 * clock (`window.__kpTestClock` seam; performance.now otherwise) and the pure
 * timeline modules — one rAF loop while animating, cancelled on every exit.
 *
 * Variants (design D8, resolved once at mount): kill switch → none;
 * e-ink → 3 crisp stepped stills; reduced motion → static mark + single card
 * + ≤ 250 ms crossfade; else the full desktop/phone choreography.
 */

import { useEffect, useRef, useState } from "react";
import "./knowledge-peck.css";
import { StartupBird } from "./StartupBird";
import { KnowledgeFragments, type ConnectorSpan } from "./KnowledgeFragments";
import {
  WATCHDOG_MS,
  isAnimating,
  resolveAnimationMode,
  transition,
} from "../../lib/startupAnimation/machine";
import {
  REVEAL_FADE_MS,
  accelerationPlan,
  buildTimeline,
  fragmentVisualStatesAt,
  sampleTimeline,
  sceneLayout,
  type FragmentVisualState,
} from "../../lib/startupAnimation/timeline";
import {
  claimLaunch,
  shouldArmForRoute,
  useStartupExperienceStore,
} from "../../lib/startupAnimation/store";
import {
  KP_GEOMETRY,
  type FormFactor,
  type KPAnimationMode,
  type KPEvent,
  type PhaseName,
} from "../../lib/startupAnimation/types";
import { usePresentation } from "../../contexts/PresentationContext";
import { useSettingsStore } from "../../stores/settingsStore";
import { useStartupStore } from "../../stores/startupStore";

/** Injectable clock seam: deterministic tests fake time through here. */
type KpClockWindow = Window & { __kpTestClock?: () => number };

const nowMs = (): number => {
  const seam = (window as KpClockWindow).__kpTestClock;
  return seam ? seam() : performance.now();
};

const ABORT_FADE_MS = 150;
const EINK_STEP_MS = 450;

/** DEV freeze hook (design D14): representative time inside a named stage. */
const FREEZE_STAGE_AT: Record<string, number | "idleAt"> = {
  handoff: 0,
  fragments: 0.35,
  notice: 0.5,
  "peck-1": 0.5,
  "peck-2": 0.5,
  "peck-3": 0.5,
  consolidate: 0.5,
  resolve: 0.6,
  idle: "idleAt",
};

function readFreezeStage(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("kp-freeze") !== "1") return null;
    return params.get("kp-stage");
  } catch {
    return null;
  }
}

function freezeVirtualTime(stage: string, formFactor: FormFactor): number {
  const timeline = buildTimeline("knowledge-peck", formFactor);
  const preset = FREEZE_STAGE_AT[stage];
  if (preset === "idleAt") return timeline.script.idleAt;
  if (stage === "handoff") return 0;
  const phase = timeline.phases.find((p) => p.name === (stage as PhaseName));
  if (!phase) return 0;
  return phase.start + (phase.end - phase.start) * (preset ?? 0.5);
}

interface DriverState {
  rafId: number | null;
  started: boolean;
  startedAt: number;
  /** Wall clock at APP_READY; null until then (1× playback). */
  readyWallAt: number | null;
  /** Virtual time at APP_READY — compression continues from here. */
  readyVirtualAt: number;
  /** Playback rate from ready on (≥ 1; see accelerationPlan). */
  timeScale: number;
  lastVisualKey: string;
  elements: Map<string, HTMLElement>;
}

export function StartupExperience() {
  const presentation = usePresentation();
  const stage = useStartupExperienceStore((s) => s.stage);
  const [armed, setArmed] = useState(false);
  const [fading, setFading] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [einkStep, setEinkStep] = useState(1);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const driverRef = useRef<DriverState>({
    rafId: null,
    started: false,
    startedAt: 0,
    readyWallAt: null,
    readyVirtualAt: 0,
    timeScale: 1,
    lastVisualKey: "",
    elements: new Map(),
  });
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const unsubscribeRef = useRef<Array<() => void>>([]);

  const formFactor: FormFactor = presentation.isMobileShell ? "phone" : "desktop";
  const mode: KPAnimationMode = resolveAnimationMode({
    startupAnimationEnabled:
      useSettingsStore.getState().settings.interface.startupAnimationEnabled !== false,
    isEinkMode: presentation.isEinkMode,
    reducedMotion: presentation.reducedMotion,
  });
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const timeline = buildTimeline("knowledge-peck", formFactor);
  const layout = sceneLayout(formFactor);
  const mascotSize =
    formFactor === "phone"
      ? KP_GEOMETRY.mascotSizePhone
      : KP_GEOMETRY.mascotSizeDesktop;

  const connectorSpans: ConnectorSpan[] = [];
  for (let i = 0; i + 1 < timeline.script.fragmentCount; i++) {
    const a = layout.slot[i];
    const b = layout.slot[i + 1];
    const halfCard = layout.card.width / 2 + 4;
    connectorSpans.push({
      x: a.x + halfCard,
      y: a.y - 1,
      width: Math.max(8, b.x - a.x - halfCard * 2),
    });
  }

  const setTimer = (fn: () => void, ms: number): void => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
  };

  const clearTimers = (): void => {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current.clear();
  };

  const cancelRaf = (): void => {
    const d = driverRef.current;
    if (d.rafId !== null) {
      window.cancelAnimationFrame(d.rafId);
      d.rafId = null;
    }
  };

  const dispatch = (event: KPEvent): void => {
    const store = useStartupExperienceStore.getState();
    store.setStage(transition(store.stage, event));
  };

  const elementFor = (id: string): HTMLElement | null => {
    const d = driverRef.current;
    if (!d.elements.has(id)) {
      const el = rootRef.current?.querySelector<HTMLElement>(
        `[data-kp-part="${id}"]`
      );
      if (!el) return null;
      d.elements.set(id, el);
    }
    return d.elements.get(id) ?? null;
  };

  /** Write one sampled frame: inline transform/opacity + card visuals. */
  const applySample = (virtualT: number): void => {
    const states = sampleTimeline(timeline, virtualT);
    for (const state of states) {
      const el = elementFor(state.id);
      if (!el) continue;
      el.style.transform = state.transform;
      el.style.opacity = String(state.opacity);
    }
    const visuals = fragmentVisualStatesAt(timeline, virtualT);
    const key = visuals.join(",");
    const d = driverRef.current;
    if (key !== d.lastVisualKey) {
      d.lastVisualKey = key;
      visuals.forEach((visual: FragmentVisualState, i: number) => {
        const el = elementFor(`fragment-${i + 1}`);
        if (el) el.dataset.visual = visual;
      });
    }
  };

  /**
   * Wall → virtual mapping: 1× until ready, then a single compression rate
   * over every remaining beat (monotonic by construction; never jumps, so
   * un-played pecks still play — see accelerationPlan).
   */
  const virtualNow = (): number => {
    const d = driverRef.current;
    if (d.readyWallAt === null) return nowMs() - d.startedAt;
    return d.readyVirtualAt + (nowMs() - d.readyWallAt) * d.timeScale;
  };

  const onAppReady = (): void => {
    const current = useStartupExperienceStore.getState().stage;
    if (current === "reveal" || current === "done" || current === "aborted") return;
    const m = modeRef.current;
    if (m === "eink") {
      // Reveal without animation: jump to the final still, then unmount.
      setEinkStep(3);
      setTimer(() => useStartupExperienceStore.getState().setStage("done"), EINK_STEP_MS);
      return;
    }
    if (m === "reduced-motion") {
      // Single ≤ 250 ms crossfade into the app (spec: reduced-motion variant).
      setFading(true);
      setTimer(() => useStartupExperienceStore.getState().setStage("done"), REVEAL_FADE_MS);
      return;
    }
    const d = driverRef.current;
    if (d.readyWallAt === null) {
      const elapsedAtReady =
        current === "handoff" || !d.started ? 0 : Math.max(0, nowMs() - d.startedAt);
      const plan = accelerationPlan(elapsedAtReady, timeline);
      d.timeScale = plan.timeScale;
      d.readyVirtualAt = plan.startVirtualMs;
      d.readyWallAt = nowMs();
    }
    dispatch("APP_READY");
  };

  /* ---------------------------------------------------------------- */
  /* Mount: arm, resolve mode, wire readiness + watchdog, cleanup.     */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    let hash = "";
    try {
      hash = window.location.hash;
    } catch {
      hash = "";
    }
    if (!shouldArmForRoute(hash) || !claimLaunch()) return;
    setArmed(true);

    const freeze = readFreezeStage();
    if (freeze) {
      // Frozen scene: sampled once; no lifecycle wiring, no timers, no rAF.
      requestAnimationFrame(() => {
        applySample(freezeVirtualTime(freeze, formFactor));
        const root = rootRef.current;
        if (root) {
          root.dataset.kpStage = freeze;
          if (freeze === "idle") {
            root.querySelector(".kp-scene")?.setAttribute("data-idle", "true");
          }
        }
      });
      return;
    }

    const store = useStartupExperienceStore.getState();
    store.setStage(transition(store.stage, "MOUNTED"));

    if (modeRef.current === "none") {
      // Kill switch: no branded layer and no delay — the app reveals itself.
      store.setStage("aborted");
      store.setStage("done");
      return;
    }

    // Driver start: full mode begins the choreography on its first frame.
    if (modeRef.current === "full") {
      store.setStage("choreography");
    }

    // Data readiness: initiate/join the deduplicated startup snapshot.
    const handleStatus = (status: string) => {
      if (status === "ready") {
        useStartupExperienceStore.getState().markDataReady();
      } else if (status === "error") {
        dispatch("APP_ERROR");
      }
    };
    handleStatus(useStartupStore.getState().status);
    // A timed-out native startup snapshot intentionally returns null and
    // resets the coordinator to `idle` so later surfaces can retry. `idle` is
    // not a terminal error for the store, but it must be terminal for this
    // launch overlay: the React route is already mounted and can boot with
    // its normal empty/loading states. Without this branch the overlay sits
    // forever in its idle pose on a stalled iOS IPC bridge.
    void useStartupStore.getState().ensureStartup("startup").then((snapshot) => {
      if (snapshot === null) dispatch("APP_ERROR");
    });
    unsubscribeRef.current.push(
      useStartupStore.subscribe((state) => handleStatus(state.status))
    );

    unsubscribeRef.current.push(
      useStartupExperienceStore.subscribe((state, prev) => {
        if (state.appReady && !prev.appReady) onAppReady();
      })
    );
    if (useStartupExperienceStore.getState().appReady) onAppReady();

    // Watchdog: the overlay can never outlive 15 s regardless of stores.
    setTimer(() => dispatch("WATCHDOG"), WATCHDOG_MS);

    return () => {
      cancelRaf();
      clearTimers();
      for (const unsub of unsubscribeRef.current) unsub();
      unsubscribeRef.current = [];
      useStartupExperienceStore.getState().reset();
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Stage effects: terminal fades; the rAF loop for the full variant. */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!armed || mode === "none") return;

    if (stage === "aborted") {
      setAborting(true);
      setTimer(() => useStartupExperienceStore.getState().setStage("done"), ABORT_FADE_MS);
      return;
    }
    if (stage === "reveal") {
      setFading(true);
      setTimer(() => useStartupExperienceStore.getState().setStage("done"), REVEAL_FADE_MS);
      return;
    }
    if (mode !== "full" || !isAnimating(stage)) return;

    const d = driverRef.current;
    if (stage === "choreography" && !d.started) {
      d.started = true;
      d.startedAt = nowMs();
    }

    const tick = (): void => {
      const d = driverRef.current;
      const currentStage = useStartupExperienceStore.getState().stage;
      if (!isAnimating(currentStage)) return;

      const virtualT = virtualNow();

      if (
        currentStage === "choreography" &&
        d.readyWallAt === null &&
        virtualT >= timeline.script.idleAt
      ) {
        // Slow startup: settle into the stable idle pose; the rAF loop stops.
        applySample(timeline.script.idleAt);
        useStartupExperienceStore.getState().setStage("idle");
        return;
      }

      if (currentStage === "resolve" && virtualT >= timeline.script.brandedSpanEnd) {
        applySample(timeline.script.brandedSpanEnd);
        useStartupExperienceStore.getState().setStage("reveal");
        return;
      }

      applySample(virtualT);
      d.rafId = window.requestAnimationFrame(tick);
    };
    d.rafId = window.requestAnimationFrame(tick);
    return cancelRaf;
  }, [armed, stage, mode]);

  /* E-ink stills: three crisp full-state steps, plain timeouts only. */
  useEffect(() => {
    if (!armed || mode !== "eink") return;
    if (stage === "done" || stage === "aborted") return;
    if (einkStep >= 3) return;
    setTimer(() => setEinkStep((s) => Math.min(3, s + 1)), EINK_STEP_MS);
  }, [armed, mode, stage, einkStep]);

  if (!armed || mode === "none" || stage === "done") return null;

  const shieldActive =
    !fading && !aborting && stage !== "reveal" && stage !== "aborted";

  const einkVisuals: FragmentVisualState[] = Array.from(
    { length: timeline.script.fragmentCount },
    (): FragmentVisualState => (einkStep >= 3 ? "gone" : einkStep >= 2 ? "card" : "raw")
  );

  const initialVisuals: FragmentVisualState[] =
    mode === "eink"
      ? einkVisuals
      : Array.from({ length: timeline.script.fragmentCount }, () => "raw");

  return (
    <div
      ref={rootRef}
      className="kp-overlay"
      data-kp-stage={stage}
      data-form-factor={formFactor}
      data-variant={mode}
      data-fading={fading || aborting ? "true" : "false"}
      data-aborting={aborting ? "true" : "false"}
      aria-hidden="true"
    >
      {shieldActive && <div className="kp-shield" />}
      <div
        className="kp-scene"
        data-form-factor={formFactor}
        data-variant={mode}
        data-idle={stage === "idle" ? "true" : "false"}
      >
        {mode === "eink" ? (
          <EinkScene
            mascotSize={mascotSize}
            timeline={timeline}
            layout={layout}
            connectorSpans={connectorSpans}
            step={einkStep}
            visuals={einkVisuals}
          />
        ) : mode === "reduced-motion" ? (
          <ReducedMotionScene
            mascotSize={mascotSize}
            layout={layout}
          />
        ) : (
          <>
            <div
              className="kp-bird-breathe"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translate(${layout.mascot.x}px, ${layout.mascot.y}px)`,
              }}
            >
              <StartupBird size={mascotSize} />
            </div>
            <KnowledgeFragments
              count={timeline.script.fragmentCount}
              card={layout.card}
              connectors={connectorSpans}
              visualStates={initialVisuals}
            />
            <div className="kp-wordmark-anchor" data-kp-part="wordmark">
              <h1 className="kp-wordmark">Plethora</h1>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* E-ink variant: three crisp stepped stills, no fades or transforms.  */
/* ------------------------------------------------------------------ */

function EinkScene({
  mascotSize,
  timeline,
  layout,
  connectorSpans,
  step,
  visuals,
}: {
  mascotSize: number;
  timeline: ReturnType<typeof buildTimeline>;
  layout: ReturnType<typeof sceneLayout>;
  connectorSpans: ConnectorSpan[];
  step: number;
  visuals: FragmentVisualState[];
}) {
  return (
    <>
      <StaticBirdAt size={mascotSize} x={layout.mascot.x} y={layout.mascot.y} />
      {step < 3 && (
        <KnowledgeFragments
          count={timeline.script.fragmentCount}
          card={layout.card}
          connectors={connectorSpans}
          visualStates={visuals}
          connectorScaleX={step >= 2 ? 1 : 0}
        />
      )}
      {step >= 3 && (
        <div
          className="kp-wordmark-anchor"
          style={{
            opacity: 1,
            transform: `translate(${layout.wordmark.x}px, ${layout.wordmark.y}px)`,
          }}
        >
          <h1 className="kp-wordmark">Plethora</h1>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Reduced-motion variant: static mark + single card + quick crossfade. */
/* ------------------------------------------------------------------ */

function ReducedMotionScene({
  mascotSize,
  layout,
}: {
  mascotSize: number;
  layout: ReturnType<typeof sceneLayout>;
}) {
  return (
    <>
      <StaticBirdAt size={mascotSize} x={layout.mascot.x} y={layout.mascot.y} />
      <KnowledgeFragments
        count={1}
        card={layout.card}
        connectors={[]}
        visualStates={["card"]}
      />
      <div
        className="kp-wordmark-anchor"
        data-kp-part="wordmark"
        style={{
          opacity: 1,
          transform: `translate(${layout.wordmark.x}px, ${layout.wordmark.y}px)`,
        }}
      >
        <h1 className="kp-wordmark">Plethora</h1>
      </div>
    </>
  );
}

/** Static mascot pinned at scene coordinates (no driver, no transforms). */
function StaticBirdAt({
  size,
  x,
  y,
}: {
  size: number;
  x: number;
  y: number;
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        transform: `translate(${x}px, ${y}px)`,
      }}
    >
      <StartupBird size={size} />
    </div>
  );
}
