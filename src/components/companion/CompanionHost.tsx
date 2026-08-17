/**
 * CompanionHost — viewport-global overlay for the Plethora companion bird.
 *
 * Mounted once (lazily) in main.tsx beside <Toast/>. Responsibilities:
 *  - gating: disabled / e-ink / presentation reduced-motion / animations off
 *  - position: clamped inside safe viewport, re-clamped on resize
 *  - exclusion: never sits over modals, focused inputs, or live selections
 *  - speech: renders the policy-approved bubble (role=status, Escape closes)
 *  - events: subscribes to domain stores (open/highlight/review/rss) and
 *    forwards structured events to the engine with fresh policy context
 *
 * Performance contract: no rAF loop, no high-frequency subscriptions; ambient
 * ticks use a coarse interval that stops entirely when the tab is hidden.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useCompanionStore } from "../../lib/companion/store";
import { usePresentation } from "../../contexts/PresentationContext";
import { useI18n } from "../../lib/i18n";
import type { CompanionContext } from "../../lib/companion/types";
import { useDocumentStore } from "../../stores/documentStore";
import { useAnnotationsStore } from "../../stores/annotationsStore";
import { useReviewStore } from "../../stores/reviewStore";
import { buildCompanionContext } from "../../lib/companion/bridge";

const CompanionBird = lazy(() =>
  import("./CompanionBird").then((m) => ({ default: m.CompanionBird }))
);

/** Coarse ambient tick (ms). Drives idle behaviors only — never speech. */
const AMBIENT_TICK_MS = 30_000;

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
  const transientUntil = useCompanionStore((s) => s.transientUntil);
  const speech = useCompanionStore((s) => s.speech);
  const clearSpeech = useCompanionStore((s) => s.clearSpeech);
  const consumeSpeech = useCompanionStore((s) => s.consumeSpeech);
  const ambient = useCompanionStore((s) => s.ambient);
  const setState = useCompanionStore((s) => s.setState);
  const notify = useCompanionStore((s) => s.notify);

  const hidden = !enabled || isEinkMode;
  const effectiveReducedMotion = reducedMotion || !animationsEnabled;

  // ── Position: clamped, safe-area aware ───────────────────────────────────
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const clampPosition = useCallback(() => {
    const safeRight = Number(
      getComputedStyle(document.documentElement).getPropertyValue("--safe-right") || 0
    );
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = rootRef.current;
    const w = el?.offsetWidth || 72;
    const h = el?.offsetHeight || 72;
    const margin = 16;
    // Mobile: perch above the bottom nav; desktop: bottom-right corner.
    const isMobileShell = vw < 768;
    const maxY = isMobileShell
      ? vh - h - margin - 56 - Number(
          getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom") || 0
        )
      : vh - h - margin;
    setPosition({
      x: Math.max(margin, vw - w - margin - safeRight),
      y: Math.max(margin, Math.min(maxY, vh - h - margin)),
    });
  }, []);

  useEffect(() => {
    if (hidden) return undefined;
    clampPosition();
    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [hidden, clampPosition]);

  /** True when the current spot would obstruct something important. */
  const positionBlocked = useCallback((): boolean => {
    if (document.querySelector('[role="dialog"][data-open="true"]')) return true;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const el = rootRef.current;
      const box = el?.getBoundingClientRect();
      if (box && rectsOverlap(rect, box)) return true;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      const rect = active.getBoundingClientRect();
      const box = rootRef.current?.getBoundingClientRect();
      if (box && rectsOverlap(rect, box)) return true;
    }
    return false;
  }, []);

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

  // ── Transient state reset + ambient tick ────────────────────────────────
  useEffect(() => {
    if (hidden) return undefined;
    const tick = window.setInterval(() => {
      if (document.hidden) return;
      const store = useCompanionStore.getState();
      const now = Date.now();
      if (store.transientUntil && now >= store.transientUntil) {
        if (store.state !== "sleep") setState("perch");
        else useCompanionStore.setState({ transientUntil: null });
        return;
      }
      if (store.state === "perch" || store.state === "idle") {
        if (positionBlocked()) return;
        ambient(stableUnit(Math.floor(now / AMBIENT_TICK_MS)), buildContext(settings, store));
      }
    }, AMBIENT_TICK_MS);
    return () => window.clearInterval(tick);
  }, [hidden, ambient, setState, settings, positionBlocked]);

  // ── Event bridge: domain stores → structured events ─────────────────────
  useEffect(() => {
    if (hidden) return undefined;
    const store = () => useCompanionStore.getState();

    // Launch greeting (once per mount = once per session)
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
      className="fixed z-[45] pointer-events-none"
      style={
        position
          ? { left: `${position.x}px`, top: `${position.y}px` }
          : { right: "16px", bottom: "16px" }
      }
      data-companion-host
    >
      {line && (
        <div className="relative mb-2 pointer-events-auto">
          <p className="companion-speech relative" role="status" aria-live="polite">
            {line}
          </p>
        </div>
      )}
      <Suspense fallback={null}>
        <CompanionBird state={companionState} reducedMotion={effectiveReducedMotion} />
      </Suspense>
    </div>
  );
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
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
