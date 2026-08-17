/**
 * Selection-interaction state machine (spec: reader-selection-interaction,
 * selection-action-lifecycle; change: overhaul-reader-selection-ux).
 *
 * Pure, framework-free reducer in the pattern of `pdfSelectionPersistence.ts`
 * and `touchSelectionDismissal.ts`. Owns ONE lifecycle shared by every reader
 * surface:
 *
 *   IDLE → SELECTING → SETTLING → READY → ACTION_RUNNING → RESULT_VISIBLE
 *     ↑________________________________________|                  |
 *     ← (dismiss | contextInvalidated | selection collapse) ←─────┘
 *
 * Two invariants carry the two reported bugs:
 *  - Live-selection events (changes, touches, scrolls) can only *promote* into
 *    SELECTING while the machine sits at or below READY — once an action is
 *    running or a result is visible they are ignored entirely, so a collapsed
 *    native selection can never unmount a running/result sheet.
 *  - UI visibility is keyed to the phase, never to live selection text: the
 *    action UI renders only in READY (anchored bar) and beyond, and any
 *    selection change from READY drops straight back to hidden SELECTING.
 *
 * The machine is deliberately timer-free: the React binding
 * (`useSelectionInteraction`) owns the settle debounce and the bounded defer
 * loop and feeds `settleConfirmed` when stability has actually been observed.
 */

import { isSuppressedSelection } from "../touchSelectionDismissal";

export type SelectionPhase =
  | "idle"
  | "selecting"
  | "settling"
  | "ready"
  | "actionRunning"
  | "resultVisible";

/** Bounded settle window: range must be stable this long with no touch down. */
export const SELECTION_STABLE_MS = 500;
/** Cap on the defer loop while a touch stays down (system-consumed gestures). */
export const MAX_DEFER_MS = 3000;
/** Defer step while a touch is still active when the settle timer fires. */
export const DEFER_STEP_MS = 150;

export interface SelectionMachineConfig {
  selectionStableMs?: number;
  maxDeferMs?: number;
  deferStepMs?: number;
}

export const defaultSelectionMachineConfig: Required<SelectionMachineConfig> = {
  selectionStableMs: SELECTION_STABLE_MS,
  maxDeferMs: MAX_DEFER_MS,
  deferStepMs: DEFER_STEP_MS,
};

/** Reader surface the interaction belongs to (used for capture provenance). */
export type SelectionSurface =
  | "epub"
  | "pdf-fixed"
  | "pdf-reflow"
  | "pdf-ocr-html"
  | "markdown"
  | "html"
  | "transcript"
  | "rss";

/** What the controller captured when the selection settled (phase ≥ READY). */
export interface ReadySelection {
  text: string;
  /** Selection plus surrounding block text (AI passage); captured at settle. */
  passage: string;
  /** Range fingerprint at settle — geometry revalidation matches against it. */
  fingerprint: string;
  /** Surface's anchor representation (EPUB CFI / PDF canonical / null). */
  selectionContext: unknown;
  /** Best-effort viewport-space geometry at settle (null when unreadable). */
  geometry: import("./geometry").SelectionGeometry | null;
  /** Reading context at settle (chapter/page/mode) for staleness checks. */
  readerContext: unknown;
}

/** Immutable application-owned snapshot taken at action invocation. */
export interface CapturedSelection {
  /** Staleness key: every AI run carries this; mismatched completions drop. */
  operationId: string;
  text: string;
  passage: string;
  selectionContext: unknown;
  geometry: ReadySelection["geometry"];
  documentId: string | null;
  surface: SelectionSurface;
  readerContext: unknown;
  capturedAt: number;
}

export type ActionOutcome = "success" | "failure";

export type ContextInvalidationReason =
  | "document-switch"
  | "epub-relocated"
  | "epub-theme-changed"
  | "epub-closed"
  | "reflow-relayout"
  | "reflow-regenerated"
  | "view-mode-changed"
  | "ocr-page-replaced"
  | (string & {});

export type SelectionInput =
  | {
      type: "selectionChanged";
      /** Fingerprint of the new live range (null when no range is readable). */
      fingerprint: string | null;
      hasText: boolean;
      /** Selected text (used to key suppression checks). */
      text?: string;
    }
  | { type: "pointerDown" }
  | { type: "pointerUp" }
  | { type: "touchStart"; /** Touch landed in reader content (clears suppression). */ inContent?: boolean }
  | { type: "touchEnd" }
  | { type: "touchCancel" }
  | {
      type: "contentScroll";
      /** True when the host's scroll-dismiss gate considers it deliberate. */
      deliberate?: boolean;
    }
  | {
      type: "settleConfirmed";
      fingerprint: string | null;
      /** Settle-time capture (text, passage, geometry — layout reads allowed). */
      selection: ReadySelection;
    }
  | { type: "commitReady"; selection: ReadySelection }
  | { type: "actionInvoked"; snapshot: CapturedSelection }
  | { type: "actionSettled"; operationId: string; outcome: ActionOutcome }
  | { type: "dismiss"; suppressCurrentText?: boolean }
  | { type: "contextInvalidated"; reason: ContextInvalidationReason };

export interface SelectionMachineState {
  phase: SelectionPhase;
  /** Fingerprint of the most recent live range (null = none/collapsed). */
  fingerprint: string | null;
  /** Text of the most recent live selection (suppression key comparisons). */
  liveText: string | null;
  /** Text-keyed dismissal guard (`isSuppressedSelection`); no expiry. */
  suppressedText: string | null;
  readySelection: ReadySelection | null;
  capturedAction: CapturedSelection | null;
  /** Terminal outcome of `capturedAction` once the phase is resultVisible. */
  actionOutcome: ActionOutcome | null;
  /** Last contextInvalidated reason (diagnostics/tests). */
  lastInvalidationReason: ContextInvalidationReason | null;
}

export const initialSelectionMachineState: SelectionMachineState = {
  phase: "idle",
  fingerprint: null,
  liveText: null,
  suppressedText: null,
  readySelection: null,
  capturedAction: null,
  actionOutcome: null,
  lastInvalidationReason: null,
};

/** Phases whose UI depends on the live selection (everything below READY). */
export function isLiveSelectionPhase(phase: SelectionPhase): boolean {
  return phase === "idle" || phase === "selecting" || phase === "settling";
}

/** True when an anchored action bar should be rendered for the phase. */
export function showsAnchoredBar(phase: SelectionPhase): boolean {
  return phase === "ready";
}

/**
 * True when a phase ≥ READY must survive live-selection collapse, scrolls,
 * and focus changes (the "result disappears" bug fix).
 */
export function isActionPhase(phase: SelectionPhase): boolean {
  return phase === "actionRunning" || phase === "resultVisible";
}

function withLive(
  state: SelectionMachineState,
  fingerprint: string | null,
  text: string | null,
): SelectionMachineState {
  // Same-reference return keeps per-event dispatches render-free.
  if (state.fingerprint === fingerprint && state.liveText === text) return state;
  return { ...state, fingerprint, liveText: text };
}

/**
 * Reduce one input. Returns the SAME reference when nothing observable
 * changes, so a React binding that mirrors this state can bail out cheaply
 * on the continuous `selectionchange` stream during handle drags.
 */
export function reduceSelectionMachine(
  state: SelectionMachineState,
  input: SelectionInput,
): SelectionMachineState {
  switch (input.type) {
    case "selectionChanged": {
      if (isActionPhase(state.phase)) return state; // never demote running/result
      const text = input.hasText ? input.text ?? state.liveText : null;
      if (!input.hasText) {
        // Collapsed/empty live selection: hidden phases and READY demote to
        // idle; a running/result action is protected above.
        if (state.phase === "idle") return withLive(state, null, null);
        return {
          ...withLive(state, null, null),
          phase: "idle",
          readySelection: null,
          // The selection is gone, so a future selection is a fresh gesture
          // that deserves fresh UI — drop the dismissal guard.
          suppressedText: null,
        };
      }
      const next = withLive(state, input.fingerprint, text);
      if (state.phase === "selecting") return next;
      // Resumed adjustment (or first activity): hide any visible UI
      // immediately — AC7 re-hide. Suppression keyed to the OLD text only
      // survives if the new text matches it (churn case); a genuinely new
      // selection re-arms.
      const suppressed =
        state.suppressedText !== null && !isSuppressedSelection(state.suppressedText, text ?? "")
          ? null
          : state.suppressedText;
      return { ...next, phase: "selecting", readySelection: null, suppressedText: suppressed };
    }

    case "touchStart":
    case "pointerDown": {
      if (isActionPhase(state.phase)) return state;
      // A fresh content gesture can deliberately re-select suppressed text;
      // touches on the controller's own UI never reach the machine at all.
      const suppressClear =
        input.type === "touchStart" && input.inContent ? null : state.suppressedText;
      if (state.phase === "idle") {
        return suppressClear !== state.suppressedText ? { ...state, suppressedText: suppressClear } : state;
      }
      return { ...state, phase: "selecting", readySelection: null, suppressedText: suppressClear };
    }

    case "touchEnd":
    case "touchCancel":
    case "pointerUp": {
      // Release signals never *hide* anything; they only complete SETTLING's
      // precondition. The binding confirms stability via `settleConfirmed`.
      if (state.phase === "selecting" && state.liveText) {
        return { ...state, phase: "settling" };
      }
      return state;
    }

    case "settleConfirmed": {
      if (isActionPhase(state.phase)) return state;
      if (state.phase !== "selecting" && state.phase !== "settling") return state;
      // The range moved again between the timer firing and now: keep waiting.
      if (state.fingerprint !== null && input.fingerprint !== state.fingerprint) {
        return { ...state, phase: "selecting" };
      }
      const text = input.selection.text.trim();
      if (!text) {
        return { ...state, phase: "idle", readySelection: null, suppressedText: null };
      }
      // Text-keyed suppression: the native selection survives dismissal on
      // Android, so churn keeps firing selectionchange for the SAME text.
      if (isSuppressedSelection(state.suppressedText, text)) {
        return { ...state, phase: "idle", readySelection: null };
      }
      return {
        ...state,
        phase: "ready",
        readySelection: input.selection,
        liveText: text,
        fingerprint: input.selection.fingerprint,
        suppressedText: null,
      };
    }

    case "commitReady": {
      if (isActionPhase(state.phase)) return state; // port only feeds idle/hidden phases
      const text = input.selection.text.trim();
      if (!text) return state;
      return {
        ...state,
        phase: "ready",
        readySelection: input.selection,
        liveText: text,
        fingerprint: input.selection.fingerprint,
        suppressedText: null,
      };
    }

    case "contentScroll": {
      if (isActionPhase(state.phase)) return state; // results never re-anchor
      if (!input.deliberate) return state;
      // Deliberate content scroll while UI is anchored/pending: dismiss and
      // suppress the surviving native selection's text (Android keeps it).
      if (state.phase === "ready" && state.readySelection) {
        return {
          ...state,
          phase: "idle",
          readySelection: null,
          suppressedText: state.readySelection.text,
        };
      }
      if (state.phase === "settling") {
        return { ...state, phase: "idle", readySelection: null };
      }
      return state;
    }

    case "actionInvoked": {
      // From READY (bar chip / sheet row / context-menu item). A second
      // invocation supersedes the first: the binding aborts the old run.
      return {
        ...state,
        phase: "actionRunning",
        capturedAction: input.snapshot,
        actionOutcome: null,
        // Keep readySelection: retry reuses the snapshot, but the anchored
        // bar itself is hidden while running (the sheet owns presentation).
      };
    }

    case "actionSettled": {
      if (state.capturedAction?.operationId !== input.operationId) return state; // stale
      if (state.phase !== "actionRunning") return state;
      return { ...state, phase: "resultVisible", actionOutcome: input.outcome };
    }

    case "dismiss": {
      if (state.phase === "idle" && !state.capturedAction) {
        return input.suppressCurrentText && state.liveText
          ? { ...state, suppressedText: state.liveText }
          : state;
      }
      const suppress =
        input.suppressCurrentText && state.readySelection
          ? state.readySelection.text
          : input.suppressCurrentText && state.liveText
            ? state.liveText
            : state.suppressedText;
      return {
        ...state,
        phase: "idle",
        readySelection: null,
        capturedAction: null,
        actionOutcome: null,
        suppressedText: suppress,
      };
    }

    case "contextInvalidated": {
      // From EVERY phase: aborts in-flight ops, dismisses anchored UI, clears
      // stale refs. Late completions for the dropped operation are rejected
      // because capturedAction is null.
      return {
        ...initialSelectionMachineState,
        lastInvalidationReason: input.reason,
      };
    }

    default:
      return state;
  }
}
