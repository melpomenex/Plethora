/**
 * CompanionHost — viewport-global overlay for the Plethora companion bird.
 *
 * Mounted once (lazily) in main.tsx beside <Toast/>. Responsibilities:
 *  - gating: disabled / e-ink / presentation reduced-motion / animations off
 *  - interaction: the bird can be picked up, dragged, and dropped — drops
 *    near a perch snap onto it, drops in open space fall with flapping and
 *    then fly to the nearest perch; ambient wandering flies between perches
 *  - position: imperative (ref-driven) during drag/flight so nothing
 *    re-renders at pointer/frame rate; committed to the store at rest and
 *    persisted to localStorage
 *  - speech: renders the policy-approved bubble (role=status, Escape closes),
 *    suppressed by the policy in busy contexts
 *  - events: subscribes to domain stores (open/highlight/review/rss) and
 *    forwards structured events to the engine with fresh policy context
 *
 * Performance contract: rAF runs only during an explicit flight; dragging
 * uses pointer events with direct style writes; the ambient tick is coarse
 * and stops entirely when the tab is hidden.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useCompanionStore } from "../../lib/companion/store";
import { usePresentation } from "../../contexts/PresentationContext";
import { useI18n } from "../../lib/i18n";
import type { CompanionContext, CompanionPosition } from "../../lib/companion/types";
import {
  arcPoint,
  chooseDropOutcome,
  discoverPerchSpots,
  flightDurationMs,
  randomOtherSpot,
  type PerchSpot,
} from "../../lib/companion/perches";
import { useDocumentStore } from "../../stores/documentStore";
import { useAnnotationsStore } from "../../stores/annotationsStore";
import { useReviewStore } from "../../stores/reviewStore";
import { buildCompanionContext } from "../../lib/companion/bridge";

const CompanionBird = lazy(() =>
  import("./CompanionBird").then((m) => ({ default: m.CompanionBird }))
);

/** Coarse ambient tick (ms). Drives idle behaviors + occasional wandering. */
const AMBIENT_TICK_MS = 30_000;
/** Chance per ambient tick (when idle) to fly somewhere else. */
const WANDER_CHANCE = 0.16;
/** Landing squash time before settling into perch (ms). */
const LAND_SETTLE_MS = 500;
/** How long the bird stays put on the floor after a fall before flying on. */
const FALL_PAUSE_MS = 650;
const POSITION_STORAGE_KEY = "plethora-companion-home";

function buildContext(
  settings: CompanionContext["settings"],
  store: ReturnType<typeof useCompanionStore.getState>
): CompanionContext {
  // The shared bridge builder reads live runtime counters; refresh the
  // settings slice with the host's current value (it owns the gating).
  void store;
  return { ...buildCompanionContext(), settings };
}

export default function CompanionHost() {
  const { t } = useI18n();
  const settings = useSettingsStore((s) => s.settings.interface.companion);
  const animationsEnabled = useSettingsStore((s) => s.settings.interface.animationsEnabled);
  const { reducedMotion, isEinkMode } = usePresentation();
  const enabled = settings?.enabled === true;

  const companionState = useCompanionStore((s) => s.state);
  const mode = useCompanionStore((s) => s.mode);
  const speech = useCompanionStore((s) => s.speech);
  const clearSpeech = useCompanionStore((s) => s.clearSpeech);
  const consumeSpeech = useCompanionStore((s) => s.consumeSpeech);
  const ambient = useCompanionStore((s) => s.ambient);
  const setState = useCompanionStore((s) => s.setState);
  const notify = useCompanionStore((s) => s.notify);
  const setMode = useCompanionStore((s) => s.setMode);
  const setPositionStore = useCompanionStore((s) => s.setPosition);

  const hidden = !enabled || isEinkMode;
  const effectiveReducedMotion = reducedMotion || !animationsEnabled;

  // ── Position: imperative writes, committed at rest ───────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef<CompanionPosition | null>(null);
  const [restingPosition, setRestingPosition] = useState<CompanionPosition | null>(null);
  const rafRef = useRef<number | null>(null);
  const flightTimerRef = useRef<number | null>(null);
  /** Perch the bird currently occupies (for wander variety + drop logic). */
  const perchIdRef = useRef<string | null>(null);

  const applyPosition = useCallback((x: number, y: number) => {
    positionRef.current = { x, y };
    const el = rootRef.current;
    if (el) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    }
  }, []);

  const clampToViewport = useCallback((x: number, y: number): CompanionPosition => {
    const margin = 4;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: Math.max(margin, Math.min(vw - 80, x)),
      y: Math.max(margin, Math.min(vh - 80, y)),
    };
  }, []);

  const defaultPosition = useCallback((): CompanionPosition => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Mobile: perch above the bottom nav; desktop: bottom-right corner.
    const isMobileShell = vw < 768;
    return isMobileShell
      ? { x: Math.max(16, vw - 90), y: vh - 76 }
      : { x: vw - 90, y: vh - 92 };
  }, []);

  const persistPosition = useCallback((pos: CompanionPosition) => {
    try {
      localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
    } catch {
      /* storage unavailable — position simply resets next session */
    }
  }, []);

  const restoreOrDefaultPosition = useCallback((): CompanionPosition => {
    try {
      const raw = localStorage.getItem(POSITION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CompanionPosition;
        if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) {
          return clampToViewport(parsed.x, parsed.y);
        }
      }
    } catch {
      /* fall through to default */
    }
    return defaultPosition();
  }, [clampToViewport, defaultPosition]);

  // ── Flight ────────────────────────────────────────────────────────────────
  const cancelFlight = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (flightTimerRef.current != null) {
      window.clearTimeout(flightTimerRef.current);
      flightTimerRef.current = null;
    }
  }, []);

  const settleAt = useCallback(
    (x: number, y: number, perchId: string | null) => {
      perchIdRef.current = perchId;
      applyPosition(x, y);
      const pos = { x, y };
      setRestingPosition(pos);
      setPositionStore(pos);
      persistPosition(pos);
      setMode("anchored");
      setState("perch", null);
    },
    [applyPosition, persistPosition, setMode, setPositionStore, setState]
  );

  /**
   * Fly (or, under reduced motion, jump) to a perch. rAF runs only for the
   * duration of the transition; the arc is computed per frame from pure math.
   */
  const flyTo = useCallback(
    (spot: PerchSpot | { x: number; y: number; id?: string | null }) => {
      const from = positionRef.current ?? defaultPosition();
      const to = { x: spot.x, y: spot.y };
      cancelFlight();
      if (effectiveReducedMotion) {
        settleAt(to.x, to.y, (spot as PerchSpot).id ?? null);
        return;
      }
      setMode("flying");
      setState("fly", null);
      const el = rootRef.current;
      if (el) {
        // Bank into the direction of travel.
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const tilt = Math.max(-18, Math.min(18, (dx / (Math.hypot(dx, dy) || 1)) * 18));
        el.style.setProperty("--companion-fly-tilt", `${Math.round(tilt)}deg`);
      }
      const duration = flightDurationMs(from, to);
      const startedAt = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        const p = arcPoint(from, to, t);
        applyPosition(p.x, p.y);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(step);
          return;
        }
        rafRef.current = null;
        // Landing squash, then settle.
        setState("land", Date.now() + LAND_SETTLE_MS);
        flightTimerRef.current = window.setTimeout(() => {
          flightTimerRef.current = null;
          settleAt(to.x, to.y, (spot as PerchSpot).id ?? null);
        }, LAND_SETTLE_MS);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [applyPosition, cancelFlight, defaultPosition, effectiveReducedMotion, setMode, setState, settleAt]
  );

  /** Drop in open space: flap down to the floor, then fly to a perch. */
  const fallFrom = useCallback(
    (from: CompanionPosition) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const outcome = chooseDropOutcome(from, discoverPerchSpots(viewport), viewport);
      if (outcome.kind === "snap") {
        flyTo(outcome.spot);
        return;
      }
      if (effectiveReducedMotion) {
        flyTo(outcome.thenFlyTo ?? { x: from.x, y: outcome.floorY });
        return;
      }
      setMode("flying");
      setState("fall", null);
      const startedAt = performance.now();
      const duration = Math.max(350, Math.min(900, (outcome.floorY - from.y) * 3.2));
      const step = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        const y = from.y + (outcome.floorY - from.y) * (t * t);
        applyPosition(from.x, y);
        if (t < 1) {
          rafRef.current = requestAnimationFrame(step);
          return;
        }
        rafRef.current = null;
        setState("land", Date.now() + LAND_SETTLE_MS);
        flightTimerRef.current = window.setTimeout(() => {
          flightTimerRef.current = null;
          if (outcome.thenFlyTo) {
            flyTo(outcome.thenFlyTo);
          } else {
            settleAt(from.x, outcome.floorY, "floor");
          }
        }, FALL_PAUSE_MS);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [applyPosition, effectiveReducedMotion, flyTo, setMode, setState, settleAt]
  );

  // ── Dragging ─────────────────────────────────────────────────────────────
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const onBirdPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const el = rootRef.current;
      if (!el) return;
      cancelFlight();
      const rect = el.getBoundingClientRect();
      dragOffsetRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setMode("dragging");
      setState("carried", null);
      clearSpeech();
      document.body.style.userSelect = "none";
      e.preventDefault();
    },
    [cancelFlight, clearSpeech, setMode, setState]
  );

  const onBirdPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (useCompanionStore.getState().mode !== "dragging") return;
      const { dx, dy } = dragOffsetRef.current;
      const pos = clampToViewport(e.clientX - dx, e.clientY - dy);
      applyPosition(pos.x, pos.y);
    },
    [applyPosition, clampToViewport]
  );

  const onBirdPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (useCompanionStore.getState().mode !== "dragging") return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      document.body.style.userSelect = "";
      const droppedAt = positionRef.current ?? defaultPosition();
      perchIdRef.current = null;
      fallFrom(droppedAt);
    },
    [defaultPosition, fallFrom]
  );

  // ── Mount: restore position ──────────────────────────────────────────────
  useEffect(() => {
    if (hidden) return undefined;
    const pos = restoreOrDefaultPosition();
    applyPosition(pos.x, pos.y);
    setRestingPosition(pos);
    setPositionStore(pos);
    return () => {
      cancelFlight();
      document.body.style.userSelect = "";
    };
    // Position restore must run exactly once per enabled mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  // Re-clamp the resting position on resize (only when idle).
  useEffect(() => {
    if (hidden) return undefined;
    const onResize = () => {
      if (useCompanionStore.getState().mode !== "anchored") return;
      const pos = positionRef.current;
      if (!pos) return;
      const clamped = clampToViewport(pos.x, pos.y);
      if (clamped.x !== pos.x || clamped.y !== pos.y) {
        applyPosition(clamped.x, clamped.y);
        setRestingPosition(clamped);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [hidden, applyPosition, clampToViewport]);

  // ── Speech lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!speech) return undefined;
    consumeSpeech(speech.key, Date.now());
    const ttl = Math.max(1000, speech.expiresAt - Date.now());
    const timer = window.setTimeout(() => clearSpeech(), ttl);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSpeech();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
    // One consume per bubble instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech?.key, speech?.expiresAt]);

  // ── Ambient tick: idle behaviors + occasional wandering ──────────────────
  useEffect(() => {
    if (hidden || effectiveReducedMotion) return undefined;
    const tick = window.setInterval(() => {
      if (document.hidden) return;
      const store = useCompanionStore.getState();
      if (store.mode !== "anchored") return;
      const now = Date.now();
      if (store.transientUntil && now < store.transientUntil) return;
      // Wander: fly to a different perch.
      if (Math.random() < WANDER_CHANCE) {
        const spots = discoverPerchSpots({
          width: window.innerWidth,
          height: window.innerHeight,
        });
        const target = randomOtherSpot(spots, perchIdRef.current);
        if (target) {
          flyTo(target);
          return;
        }
      }
      if (store.state === "perch" || store.state === "idle") {
        ambient(stableUnit(Math.floor(now / AMBIENT_TICK_MS)), buildContext(settings, store));
      }
    }, AMBIENT_TICK_MS);
    return () => window.clearInterval(tick);
  }, [hidden, effectiveReducedMotion, ambient, flyTo, settings]);

  // Transient-state reset (kept separate from wandering).
  useEffect(() => {
    if (hidden) return undefined;
    const tick = window.setInterval(() => {
      const store = useCompanionStore.getState();
      if (store.mode !== "anchored") return;
      const now = Date.now();
      if (store.transientUntil && now >= store.transientUntil) {
        if (store.state !== "sleep") setState("perch");
        else useCompanionStore.setState({ transientUntil: null });
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [hidden, setState]);

  // ── Event bridge: domain stores → structured events ─────────────────────
  useEffect(() => {
    if (hidden) return undefined;
    const store = () => useCompanionStore.getState();

    notify({ type: "app_launched" }, buildContext(settings, store()));

    const unsubDoc = useDocumentStore.subscribe((state, prev) => {
      if (state.currentDocument && state.currentDocument !== prev.currentDocument) {
        notify(
          { type: "document_opened", title: state.currentDocument.title },
          buildContext(settings, store())
        );
      }
    });

    const annotationCount = (state: ReturnType<typeof useAnnotationsStore.getState>) =>
      Array.from(state.annotationsByArticle.values()).reduce((n, list) => n + list.length, 0);
    const unsubHighlights = useAnnotationsStore.subscribe((state, prev) => {
      if (annotationCount(state) > annotationCount(prev)) {
        notify({ type: "highlight_created" }, buildContext(settings, store()));
      }
    });

    const unsubReview = useReviewStore.subscribe((state, prev) => {
      if (state.reviewsCompleted > prev.reviewsCompleted) {
        if (state.correctCount > prev.correctCount) {
          notify(
            { type: "review_correct", streak: state.streak?.current_streak ?? 0 },
            buildContext(settings, store())
          );
        } else {
          notify({ type: "review_difficult" }, buildContext(settings, store()));
        }
      }
    });

    return () => {
      unsubDoc();
      unsubHighlights();
      unsubReview();
    };
  }, [hidden, notify, settings]);

  const line = useMemo(() => {
    if (!speech) return null;
    const raw = t(speech.key, speech.vars);
    return raw === speech.key ? null : raw;
  }, [speech, t]);

  if (hidden) return null;

  return (
    <div
      ref={rootRef}
      className="companion-host fixed z-[45] pointer-events-none"
      data-companion-mode={mode}
      style={
        restingPosition
          ? { left: `${restingPosition.x}px`, top: `${restingPosition.y}px` }
          : { right: "16px", bottom: "16px" }
      }
    >
      {line && (
        <div className="relative mb-2 pointer-events-auto">
          <p className="companion-speech relative" role="status" aria-live="polite">
            {line}
          </p>
        </div>
      )}
      <div
        className="companion-bird-hit"
        onPointerDown={onBirdPointerDown}
        onPointerMove={onBirdPointerMove}
        onPointerUp={onBirdPointerUp}
        onPointerCancel={onBirdPointerUp}
      >
        <Suspense fallback={null}>
          <CompanionBird state={companionState} reducedMotion={effectiveReducedMotion} />
        </Suspense>
      </div>
    </div>
  );
}

/** Deterministic 0..1 hash so ambient behavior is reproducible per tick. */
function stableUnit(text: number | string): number {
  const s = String(text);
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}
