/**
 * useSelectionInteraction — React binding for the shared selection-interaction
 * controller (change: overhaul-reader-selection-ux, design decisions 1/2/5).
 *
 * Owns the timers (re-armed settle debounce, bounded defer loop), the event
 * adapters, and the rAF-throttled geometry revalidation. The machine state
 * lives in a ref; React state mirrors ONLY the observable slices
 * (phase/readySelection/capturedAction), so the continuous `selectionchange`
 * stream during a handle drag costs one O(1) fingerprint compare and no
 * re-render.
 *
 *   phase           — machine phase (UI visibility derives from it)
 *   readySelection  — settle-time capture (text/passage/context/geometry)
 *   capturedAction  — immutable snapshot once an action is invoked
 *   placement       — anchored-bar placement (null = no anchored UI)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateId } from "../../../utils/id";
import { passageAroundSelection } from "../SelectionActionsSheet";
import { createScrollDismissGate } from "../touchSelectionDismissal";
import {
  anchorRectFromGeometry,
  captureSelectionGeometry,
  fingerprintRange,
  placeAnchoredBar,
  readLayoutViewport,
  readSafeInsets,
  type BarPlacement,
} from "./geometry";
import {
  defaultSelectionMachineConfig,
  initialSelectionMachineState,
  reduceSelectionMachine,
  type ActionOutcome,
  type CapturedSelection,
  type ContextInvalidationReason,
  type ReadySelection,
  type SelectionInput,
  type SelectionMachineConfig,
  type SelectionMachineState,
  type SelectionPhase,
  type SelectionSurface,
} from "./machine";
import {
  attachContentDocumentBridge,
  attachTopDocumentAdapter,
  isSelectionInContent,
  type ContentDocumentEntry,
  type SelectionAdapterHandlers,
} from "./adapters";

/** Live reading of a selection in one of the adapted documents. */
interface LiveSelection {
  selection: Selection;
  range: Range;
  fingerprint: string;
  text: string;
  entry: ContentDocumentEntry | null; // null = top document
  offset: { x: number; y: number } | null;
}

export interface UseSelectionInteractionOptions {
  surface: SelectionSurface;
  documentId: string | null;
  /** Attach adapters + accept input; false parks the controller at idle. */
  enabled: boolean;
  config?: SelectionMachineConfig;
  /** Passage builder for the settle capture (defaults to passageAroundSelection). */
  buildPassage?: (selection: Selection, text: string) => string;
  /** Reading context captured with every snapshot (chapter/page/mode). */
  getReaderContext?: () => unknown;
  /** Fires when a selection settles (host updates its own selection state). */
  onReady?: (selection: ReadySelection) => void;
  /** Fires when the context is invalidated — host aborts in-flight work. */
  onInvalidate?: (reason: ContextInvalidationReason) => void;
  /** Size used for placement math; the bar reports its own via registerBarSize. */
  barSize?: { width: number; height: number };
  /** Host-supplied own-UI check in addition to the shared data attribute. */
  isOwnUi?: (target: EventTarget | null) => boolean;
}

export interface SelectionInteractionController {
  phase: SelectionPhase;
  readySelection: ReadySelection | null;
  capturedAction: CapturedSelection | null;
  placement: BarPlacement | null;
  /** Build + commit the immutable snapshot for an invoked action. */
  captureForAction: (overrides?: Partial<Omit<CapturedSelection, "operationId">>) => CapturedSelection | null;
  /** Force the stability check now (desktop release semantics). */
  settleNow: () => void;
  invalidate: (reason: ContextInvalidationReason) => void;
  dismiss: (options?: { suppressCurrentText?: boolean }) => void;
  /** External commit port (PDF fixed mode's validated selections). */
  commitReadySelection: (selection: ReadySelection) => void;
  /**
   * Commit the current live selection as READY, overriding its context (the
   * PDF validated-commit port: canonical context arrives with the commit).
   */
  commitLiveSelectionAsReady: (context?: unknown) => void;
  /** True when a touch started recently (touch-derived mouseup detection). */
  isRecentTouch: () => boolean;
  /** Surface-side context (EPUB CFI / PDF canonical) feeding readySelection. */
  setLiveSelectionContext: (context: unknown) => void;
  /** Register an iframe content document (EPUB/HTML bridge). Returns detach. */
  registerContentDocument: (entry: ContentDocumentEntry) => () => void;
  /** Register a top-document content root (scoping, e.g. transcripts). */
  registerContentRoot: (element: Element | null) => () => void;
  /** Sheet reports AI-run completion; stale operationIds are dropped by the machine. */
  notifyActionSettled: (operationId: string, outcome: ActionOutcome) => void;
  /** True while any adapted document holds a non-collapsed selection. */
  hasLiveSelection: () => boolean;
  /** The bar reports its measured size for placement math. */
  registerBarSize: (size: { width: number; height: number }) => void;
}

const DEFAULT_BAR_SIZE = { width: 280, height: 48 };

export function useSelectionInteraction(
  options: UseSelectionInteractionOptions,
): SelectionInteractionController {
  const { surface, documentId, enabled } = options;

  // ── Refs: per-event bookkeeping that must never trigger renders ──────────
  const machineRef = useRef<SelectionMachineState>(initialSelectionMachineState);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const configRef = useRef<SelectionMachineConfig & typeof defaultSelectionMachineConfig>({
    ...defaultSelectionMachineConfig,
    ...options.config,
  });
  configRef.current = { ...defaultSelectionMachineConfig, ...options.config };

  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchActiveRef = useRef(false);
  const lastTouchAtRef = useRef(0);
  const deferStartedAtRef = useRef(0);
  const contentDocsRef = useRef(new Set<ContentDocumentEntry>());
  const contentRootsRef = useRef(new Set<Element>());
  const liveContextRef = useRef<unknown>(null);
  const barSizeRef = useRef(options.barSize ?? DEFAULT_BAR_SIZE);
  const rafRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const armSettleTimerRef = useRef<(immediate?: boolean) => void>(() => {});
  const settleTimerFiredRef = useRef<() => void>(() => {});
  const currentHandlersRef = useRef<SelectionAdapterHandlers | null>(null);
  const bridgeDetachersRef = useRef(new Set<() => void>());

  // ── React-visible mirror: updated ONLY on observable changes ─────────────
  const [mirror, setMirror] = useState(() => ({
    phase: machineRef.current.phase,
    readySelection: machineRef.current.readySelection,
    capturedAction: machineRef.current.capturedAction,
    actionOutcome: machineRef.current.actionOutcome,
  }));
  const [placement, setPlacement] = useState<BarPlacement | null>(null);

  const clearStableTimer = useCallback(() => {
    if (stableTimerRef.current) {
      clearTimeout(stableTimerRef.current);
      stableTimerRef.current = null;
    }
  }, []);

  /** Run one input through the machine; mirror observable changes only. */
  const apply = useCallback(
    (input: SelectionInput) => {
      const prev = machineRef.current;
      const next = reduceSelectionMachine(prev, input);
      if (next === prev) return;
      machineRef.current = next;
      if (
        next.phase !== prev.phase ||
        next.readySelection !== prev.readySelection ||
        next.capturedAction !== prev.capturedAction ||
        next.actionOutcome !== prev.actionOutcome
      ) {
        setMirror({
          phase: next.phase,
          readySelection: next.readySelection,
          capturedAction: next.capturedAction,
          actionOutcome: next.actionOutcome,
        });
      }
      if (next.phase === "idle") clearStableTimer();
    },
    [clearStableTimer],
  );

  /**
   * Non-collapsed text selection in any adapted document, or null. Top-document
   * selections must anchor in reader content (registered roots or the standard
   * content markers) — the legacy readDocumentSelection scoping rule; iframe
   * documents are content by definition.
   */
  const readLiveSelection = useCallback((): LiveSelection | null => {
    const probe = (entry: ContentDocumentEntry | null): LiveSelection | null => {
      try {
        const view = entry ? (entry.win ?? entry.doc.defaultView) : window;
        const selection = view?.getSelection?.() ?? null;
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
        const text = selection.toString().trim();
        if (!text) return null;
        if (!entry && !isSelectionInContent(selection, contentRootsRef.current)) return null;
        const range = selection.getRangeAt(0);
        const fingerprint = fingerprintRange(range);
        if (!fingerprint) return null;
        return {
          selection,
          range,
          fingerprint,
          text,
          entry,
          offset: entry?.offset?.() ?? null,
        };
      } catch {
        return null; // cross-origin or detached document
      }
    };
    // Registered iframe documents first (EPUB/HTML host their content there),
    // then the top document (reflow PDF, markdown, OCR-HTML).
    for (const entry of contentDocsRef.current) {
      const found = probe(entry);
      if (found) return found;
    }
    return probe(null);
  }, []);

  const computePlacement = useCallback(
    (geometry: ReadySelection["geometry"]): BarPlacement | null => {
      if (!geometry) return null;
      const viewport = readLayoutViewport();
      const anchor = anchorRectFromGeometry(geometry, viewport);
      return placeAnchoredBar(anchor, barSizeRef.current, viewport, readSafeInsets());
    },
    [],
  );

  /** Build the settle-time capture (layout reads allowed — at settle only). */
  const buildReadySelection = useCallback((live: LiveSelection): ReadySelection => {
    const { buildPassage, getReaderContext } = optionsRef.current;
    return {
      text: live.text,
      passage: (buildPassage ?? passageAroundSelection)(live.selection, live.text),
      fingerprint: live.fingerprint,
      selectionContext:
        live.entry?.buildSelectionContext?.(live.range, live.selection) ??
        liveContextRef.current ??
        null,
      geometry: captureSelectionGeometry(live.range, live.offset),
      readerContext: getReaderContext?.() ?? null,
    };
  }, []);

  /** Timer body: confirm stability, or defer while a finger is still down. */
  const settleTimerFired = useCallback(() => {
    stableTimerRef.current = null;
    const state = machineRef.current;
    if (state.phase !== "selecting" && state.phase !== "settling") return;

    const live = readLiveSelection();
    if (!live) {
      // Selection vanished while waiting: the machine cleans up (and protects
      // any running action — this path only demotes hidden phases).
      if (state.liveText) apply({ type: "selectionChanged", fingerprint: null, hasText: false });
      return;
    }
    if (state.fingerprint !== null && live.fingerprint !== state.fingerprint) {
      // Range moved since the last change event landed: restart the window.
      apply({
        type: "selectionChanged",
        fingerprint: live.fingerprint,
        hasText: true,
        text: live.text,
      });
      armSettleTimerRef.current();
      return;
    }
    if (touchActiveRef.current) {
      // Long-press hold / active handle drag: re-check shortly — bounded, so
      // Android's system-consumed gestures (no touchend) cannot wedge it.
      if (!deferStartedAtRef.current) deferStartedAtRef.current = Date.now();
      if (Date.now() - deferStartedAtRef.current > configRef.current.maxDeferMs) {
        apply({ type: "dismiss" });
        return;
      }
      clearStableTimer();
      stableTimerRef.current = setTimeout(settleTimerFiredRef.current, configRef.current.deferStepMs);
      return;
    }
    deferStartedAtRef.current = 0;
    apply({
      type: "settleConfirmed",
      fingerprint: live.fingerprint,
      selection: buildReadySelection(live),
    });
  }, [apply, buildReadySelection, clearStableTimer, readLiveSelection]);
  settleTimerFiredRef.current = settleTimerFired;

  const armSettleTimer = useCallback(
    (immediate = false) => {
      clearStableTimer();
      stableTimerRef.current = setTimeout(
        settleTimerFiredRef.current,
        immediate ? 0 : configRef.current.selectionStableMs,
      );
    },
    [clearStableTimer],
  );
  armSettleTimerRef.current = armSettleTimer;

  // ── Geometry revalidation (rAF-throttled; READY only) ────────────────────

  const revalidatePlacement = useCallback(() => {
    const state = machineRef.current;
    // Never re-anchor a running/result panel; only the READY bar follows.
    if (state.phase !== "ready" || !state.readySelection) return;
    const live = readLiveSelection();
    if (!live || live.fingerprint !== state.readySelection.fingerprint) {
      // Anchored to a dead geometry: dismiss rather than misposition.
      apply({ type: "dismiss" });
      return;
    }
    setPlacement(computePlacement(captureSelectionGeometry(live.range, live.offset)));
  }, [apply, computePlacement, readLiveSelection]);

  const scheduleRevalidate = useCallback(() => {
    if (rafRef.current !== null) return;
    const run = () => {
      rafRef.current = null;
      revalidatePlacement();
    };
    rafRef.current =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(run)
        : (window.setTimeout(run, 16) as unknown as number);
  }, [revalidatePlacement]);

  // ── Adapter wiring ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) {
      // Park at idle and drop all adapter input (rollback = flag off).
      machineRef.current = initialSelectionMachineState;
      setMirror({ phase: "idle", readySelection: null, capturedAction: null, actionOutcome: null });
      setPlacement(null);
      clearStableTimer();
      currentHandlersRef.current = null;
      return;
    }

    const gate = createScrollDismissGate();
    const handlers: SelectionAdapterHandlers = {
      onSelectionChanged: () => {
        const live = readLiveSelection();
        if (!live) {
          apply({ type: "selectionChanged", fingerprint: null, hasText: false });
          return;
        }
        apply({
          type: "selectionChanged",
          fingerprint: live.fingerprint,
          hasText: true,
          text: live.text,
        });
        // Re-arm the settle window on every change (a drag never settles).
        armSettleTimer();
      },
      onContentTouchStart: (inContent) => {
        touchActiveRef.current = true;
        lastTouchAtRef.current = Date.now();
        apply({ type: "touchStart", inContent });
      },
      onContentTouchEnd: () => {
        // Release only — NEVER re-arms the timer from here: touchend fires on
        // every scroll flick, and the surviving native selection (Android)
        // would re-surface the UI over unrelated views.
        touchActiveRef.current = false;
        deferStartedAtRef.current = 0;
        apply({ type: "touchEnd" });
      },
      onPointerRelease: () => {
        apply({ type: "pointerUp" });
        // Desktop: no artificial delay — confirm as soon as the range is set.
        const phase = machineRef.current.phase;
        if (phase === "settling" || phase === "selecting") armSettleTimer(true);
      },
      onContentScroll: (target, top, left) => {
        scheduleRevalidate(); // reposition at most once per frame…
        if (gate.track(target ?? window, top, left)) {
          apply({ type: "contentScroll", deliberate: true }); // …or dismiss when deliberate
        }
      },
      isOwnUi: (target) => optionsRef.current.isOwnUi?.(target) ?? false,
    };
    currentHandlersRef.current = handlers;

    const detachTop = attachTopDocumentAdapter(handlers, {
      contentRoots: () => contentRootsRef.current,
    });

    // Attach bridges for already-registered iframe documents.
    const detachers = new Set<() => void>();
    for (const entry of contentDocsRef.current) {
      detachers.add(attachContentDocumentBridge(entry, handlers));
    }
    bridgeDetachersRef.current = detachers;

    // Viewport changes revalidate the anchored placement (keyboard, zoom).
    const onViewportChange = () => scheduleRevalidate();
    window.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);

    return () => {
      detachTop();
      for (const detach of detachers) detach();
      bridgeDetachersRef.current = new Set();
      currentHandlersRef.current = null;
      window.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
      clearStableTimer();
      if (rafRef.current !== null) {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafRef.current);
        else window.clearTimeout(rafRef.current);
        rafRef.current = null;
      }
      touchActiveRef.current = false;
      deferStartedAtRef.current = 0;
    };
  }, [enabled, apply, armSettleTimer, clearStableTimer, readLiveSelection, scheduleRevalidate]);

  const registerContentDocument = useCallback((entry: ContentDocumentEntry) => {
    contentDocsRef.current.add(entry);
    let detach: (() => void) | null = null;
    const handlers = currentHandlersRef.current;
    if (enabledRef.current && handlers) {
      detach = attachContentDocumentBridge(entry, handlers);
      bridgeDetachersRef.current.add(detach);
    }
    return () => {
      contentDocsRef.current.delete(entry);
      if (detach) {
        detach();
        bridgeDetachersRef.current.delete(detach);
      }
    };
  }, []);

  // ── Imperative surface ────────────────────────────────────────────────────

  const settleNow = useCallback(() => {
    armSettleTimer(true);
  }, [armSettleTimer]);

  const invalidate = useCallback(
    (reason: ContextInvalidationReason) => {
      clearStableTimer();
      liveContextRef.current = null;
      setPlacement(null);
      apply({ type: "contextInvalidated", reason });
      optionsRef.current.onInvalidate?.(reason);
    },
    [apply, clearStableTimer],
  );

  const dismiss = useCallback(
    (dismissOptions?: { suppressCurrentText?: boolean }) => {
      setPlacement(null);
      apply({ type: "dismiss", suppressCurrentText: dismissOptions?.suppressCurrentText });
    },
    [apply],
  );

  const commitReadySelection = useCallback(
    (selection: ReadySelection) => {
      apply({ type: "commitReady", selection });
      setPlacement(computePlacement(selection.geometry));
    },
    [apply, computePlacement],
  );

  const commitLiveSelectionAsReady = useCallback(
    (context?: unknown) => {
      const live = readLiveSelection();
      if (!live) return;
      const ready = buildReadySelection(live);
      if (context !== undefined) ready.selectionContext = context;
      apply({ type: "commitReady", selection: ready });
      setPlacement(computePlacement(ready.geometry));
    },
    [apply, buildReadySelection, computePlacement, readLiveSelection],
  );

  const isRecentTouch = useCallback(() => Date.now() - lastTouchAtRef.current < 1500, []);

  const setLiveSelectionContext = useCallback((context: unknown) => {
    liveContextRef.current = context;
  }, []);

  const captureForAction = useCallback(
    (overrides?: Partial<Omit<CapturedSelection, "operationId">>): CapturedSelection | null => {
      const state = machineRef.current;
      let base = state.readySelection;
      if (!base) {
        // Not settled yet (desktop right-click mid-drag): capture live.
        const live = readLiveSelection();
        base = live ? buildReadySelection(live) : null;
      }
      const text = base?.text?.trim();
      if (!base || !text) return null;
      const snapshot: CapturedSelection = {
        operationId: generateId(),
        text,
        passage: base.passage,
        selectionContext: base.selectionContext,
        geometry: base.geometry,
        documentId: optionsRef.current.documentId ?? null,
        surface: optionsRef.current.surface,
        readerContext: base.readerContext,
        capturedAt: Date.now(),
        ...overrides,
      };
      apply({ type: "actionInvoked", snapshot });
      return snapshot;
    },
    [apply, buildReadySelection, readLiveSelection],
  );

  const notifyActionSettled = useCallback(
    (operationId: string, outcome: ActionOutcome) => {
      apply({ type: "actionSettled", operationId, outcome });
    },
    [apply],
  );

  const hasLiveSelection = useCallback(() => readLiveSelection() !== null, [readLiveSelection]);

  // Publish the live-selection probe for module-level consumers
  // (ReaderTapZones' tap guard — EPUB iframe selections are invisible to
  // window.getSelection()).
  useEffect(() => {
    if (!enabled) return;
    return registerActiveSelectionProbe(hasLiveSelection);
  }, [enabled, hasLiveSelection]);

  const registerContentRoot = useCallback((element: Element | null) => {
    if (!element) return () => {};
    contentRootsRef.current.add(element);
    return () => {
      contentRootsRef.current.delete(element);
    };
  }, []);

  const registerBarSize = useCallback((size: { width: number; height: number }) => {
    barSizeRef.current = size;
  }, []);

  // Document switch invalidates everything (late results cannot cross docs).
  const lastDocumentIdRef = useRef(documentId);
  useEffect(() => {
    if (lastDocumentIdRef.current !== documentId) {
      lastDocumentIdRef.current = documentId;
      if (enabledRef.current) invalidate("document-switch");
    }
  }, [documentId, invalidate]);

  // onReady fires when a selection settles (host updates its own state).
  const onReadyRef = useRef(options.onReady);
  onReadyRef.current = options.onReady;
  const lastReadyFingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    if (mirror.phase === "ready" && mirror.readySelection) {
      if (lastReadyFingerprintRef.current !== mirror.readySelection.fingerprint) {
        lastReadyFingerprintRef.current = mirror.readySelection.fingerprint;
        onReadyRef.current?.(mirror.readySelection);
      }
    } else if (mirror.phase !== "ready") {
      lastReadyFingerprintRef.current = null;
    }
  }, [mirror.phase, mirror.readySelection]);

  // Placement follows readySelection (settle capture / commit port); hidden
  // phases never keep an anchored placement.
  useEffect(() => {
    if (mirror.phase === "ready" && mirror.readySelection) {
      setPlacement(computePlacement(mirror.readySelection.geometry));
    } else if (mirror.phase !== "ready") {
      setPlacement(null);
    }
  }, [mirror.phase, mirror.readySelection, computePlacement]);

  // Clean timers on unmount.
  useEffect(
    () => () => {
      clearStableTimer();
      if (rafRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafRef.current);
      }
    },
    [clearStableTimer],
  );

  return useMemo(
    () => ({
      phase: mirror.phase,
      readySelection: mirror.readySelection,
      capturedAction: mirror.capturedAction,
      placement,
      captureForAction,
      settleNow,
      invalidate,
      dismiss,
      commitReadySelection,
      commitLiveSelectionAsReady,
      isRecentTouch,
      setLiveSelectionContext,
      registerContentDocument,
      registerContentRoot,
      notifyActionSettled,
      hasLiveSelection,
      registerBarSize,
    }),
    [
      mirror.phase,
      mirror.readySelection,
      mirror.capturedAction,
      placement,
      captureForAction,
      settleNow,
      invalidate,
      dismiss,
      commitReadySelection,
      commitLiveSelectionAsReady,
      isRecentTouch,
      setLiveSelectionContext,
      registerContentDocument,
      registerContentRoot,
      notifyActionSettled,
      hasLiveSelection,
      registerBarSize,
    ],
  );
}

// Module-level probe registry: consumers that ask "is a reader selection
// active?" without reaching the host component (ReaderTapZones' guard — the
// top-level window.getSelection() is always empty for EPUB iframe selections).
const activeProbes = new Set<() => boolean>();

export function registerActiveSelectionProbe(probe: () => boolean): () => void {
  activeProbes.add(probe);
  return () => {
    activeProbes.delete(probe);
  };
}

/** True when any mounted selection controller sees a live reader selection. */
export function hasActiveReaderSelection(): boolean {
  for (const probe of activeProbes) {
    try {
      if (probe()) return true;
    } catch {
      /* controller unmounted concurrently */
    }
  }
  return false;
}
