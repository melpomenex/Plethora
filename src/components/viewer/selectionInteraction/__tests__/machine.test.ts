import { describe, expect, it } from "vitest";
import {
  initialSelectionMachineState as initial,
  isActionPhase,
  reduceSelectionMachine as reduce,
  type CapturedSelection,
  type ReadySelection,
  type SelectionInput,
  type SelectionMachineState,
} from "../machine";

let fingerprintSeq = 0;
const fp = () => `fp-${++fingerprintSeq}`;

function ready(overrides: Partial<ReadySelection> = {}): ReadySelection {
  return {
    text: "selected passage",
    passage: "context around selected passage",
    fingerprint: "fp-ready",
    selectionContext: null,
    geometry: null,
    readerContext: null,
    intent: { kind: "phrase" },
    gestureOrigin: "touch",
    ...overrides,
  };
}

function snapshot(overrides: Partial<CapturedSelection> = {}): CapturedSelection {
  return {
    operationId: "op-1",
    text: "selected passage",
    passage: "context around selected passage",
    selectionContext: null,
    geometry: null,
    documentId: "doc-1",
    surface: "epub",
    readerContext: null,
    capturedAt: 0,
    ...overrides,
  };
}

const changed = (fingerprint: string | null, text: string): SelectionInput => ({
  type: "selectionChanged",
  fingerprint,
  hasText: Boolean(text),
  text,
});

const settle = (fingerprint: string | null, selection: ReadySelection): SelectionInput => ({
  type: "settleConfirmed",
  fingerprint,
  selection,
});

/** Drive the machine from IDLE through a settled selection. */
function driveToReady(state: SelectionMachineState = initial): SelectionMachineState {
  let s = reduce(state, changed(fp(), "selected passage"));
  s = reduce(s, { type: "touchEnd" });
  return reduce(s, settle(s.fingerprint, ready()));
}

describe("selection interaction machine — brief's transition list", () => {
  it("selection starts → hidden (selecting, no UI)", () => {
    const s = reduce(initial, changed(fp(), "one word"));
    expect(s.phase).toBe("selecting");
  });

  it("changes → still hidden; stable → shown (ready)", () => {
    let s = reduce(initial, changed(fp(), "one word"));
    s = reduce(s, changed(fp(), "one word adjusted"));
    expect(s.phase).toBe("selecting");
    s = reduce(s, { type: "touchEnd" });
    expect(s.phase).toBe("settling");
    s = reduce(s, settle(s.fingerprint, ready()));
    expect(s.phase).toBe("ready");
    expect(s.readySelection?.text).toBe("selected passage");
  });

  it("changes again from ready → hidden immediately; stabilizes again → shown", () => {
    let s = driveToReady();
    s = reduce(s, changed(fp(), "adjusted again"));
    expect(s.phase).toBe("selecting");
    expect(s.readySelection).toBeNull();
    s = reduce(s, { type: "touchEnd" });
    s = reduce(s, settle(s.fingerprint, ready({ text: "adjusted again" })));
    expect(s.phase).toBe("ready");
    expect(s.readySelection?.text).toBe("adjusted again");
  });

  it("action invoked → capture + loading (actionRunning with snapshot)", () => {
    const s = reduce(driveToReady(), { type: "actionInvoked", snapshot: snapshot() });
    expect(s.phase).toBe("actionRunning");
    expect(s.capturedAction?.operationId).toBe("op-1");
  });

  it("DOM selection disappears mid-run → action continues", () => {
    let s = driveToReady();
    s = reduce(s, { type: "actionInvoked", snapshot: snapshot() });
    for (const input of [
      changed(null, ""),
      { type: "contentScroll", deliberate: true },
      { type: "touchStart" },
      { type: "touchEnd" },
    ] as SelectionInput[]) {
      s = reduce(s, input);
      expect(s.phase).toBe("actionRunning");
    }
  });

  it("success → result visible; failure → error visible (resultVisible + outcome)", () => {
    let s = reduce(driveToReady(), { type: "actionInvoked", snapshot: snapshot() });
    s = reduce(s, { type: "actionSettled", operationId: "op-1", outcome: "success" });
    expect(s.phase).toBe("resultVisible");
    expect(s.actionOutcome).toBe("success");
    // Live-selection events still cannot demote a visible result.
    expect(reduce(s, changed(null, "")).phase).toBe("resultVisible");

    let f = reduce(driveToReady(), { type: "actionInvoked", snapshot: snapshot({ operationId: "op-2" }) });
    f = reduce(f, { type: "actionSettled", operationId: "op-2", outcome: "failure" });
    expect(f.phase).toBe("resultVisible");
    expect(f.actionOutcome).toBe("failure");
  });

  it("stale completions (wrong operationId) are ignored", () => {
    let s = reduce(driveToReady(), { type: "actionInvoked", snapshot: snapshot({ operationId: "op-a" }) });
    // A newer action supersedes before the old one completes.
    s = reduce(s, { type: "actionInvoked", snapshot: snapshot({ operationId: "op-b" }) });
    s = reduce(s, { type: "actionSettled", operationId: "op-a", outcome: "success" });
    expect(s.phase).toBe("actionRunning"); // late op-a response discarded
    expect(s.capturedAction?.operationId).toBe("op-b");
    s = reduce(s, { type: "actionSettled", operationId: "op-b", outcome: "success" });
    expect(s.phase).toBe("resultVisible");
  });

  it("re-adjustment from READY on a content touch hides the bar", () => {
    const s = driveToReady();
    expect(reduce(s, { type: "touchStart" }).phase).toBe("selecting");
  });

  it("empty selection demotes only selecting/settling/ready — never a running action", () => {
    expect(reduce(reduce(initial, changed(fp(), "x")), changed(null, "")).phase).toBe("idle");
    let s = driveToReady();
    expect(reduce(s, changed(null, "")).phase).toBe("idle");
    s = reduce(s, { type: "actionInvoked", snapshot: snapshot() });
    expect(reduce(s, changed(null, "")).phase).toBe("actionRunning");
  });

  it("dismiss returns to idle and optionally suppresses the selection's text", () => {
    let s = driveToReady();
    s = reduce(s, { type: "dismiss", suppressCurrentText: true });
    expect(s.phase).toBe("idle");
    expect(s.readySelection).toBeNull();
    expect(s.suppressedText).toBe("selected passage");
    // The same text re-settling stays suppressed (Android churn case).
    s = reduce(s, changed(fp(), "selected passage"));
    s = reduce(s, { type: "touchEnd" });
    s = reduce(s, settle(s.fingerprint, ready()));
    expect(s.phase).toBe("idle");
    // Genuinely different text re-arms.
    s = reduce(s, changed(fp(), "another passage"));
    s = reduce(s, { type: "touchEnd" });
    s = reduce(s, settle(s.fingerprint, ready({ text: "another passage" })));
    expect(s.phase).toBe("ready");
  });
});

describe("contextInvalidated — from every phase", () => {
  it.each(["idle", "selecting", "settling", "ready", "actionRunning", "resultVisible"] as const)(
    "invalidation from %s returns a clean idle state",
    (phase) => {
      let s: SelectionMachineState = initial;
      if (phase === "selecting") s = reduce(initial, changed(fp(), "text"));
      if (phase === "settling") s = reduce(reduce(initial, changed(fp(), "text")), { type: "touchEnd" });
      if (phase === "ready" || phase === "actionRunning" || phase === "resultVisible") {
        s = driveToReady();
        if (phase !== "ready") {
          s = reduce(s, { type: "actionInvoked", snapshot: snapshot() });
          if (phase === "resultVisible") {
            s = reduce(s, { type: "actionSettled", operationId: "op-1", outcome: "success" });
          }
        }
      }
      const out = reduce(s, { type: "contextInvalidated", reason: "epub-relocated" });
      expect(out).toEqual({ ...initial, lastInvalidationReason: "epub-relocated" });
      // A late completion for the aborted operation cannot land.
      expect(reduce(out, { type: "actionSettled", operationId: "op-1", outcome: "success" }).phase).toBe("idle");
    },
  );
});

describe("machine mechanics", () => {
  it("returns the same reference when an input changes nothing (per-event churn is render-free)", () => {
    // Repeated identical selectionchange during a handle hold: same range.
    const s = reduce(initial, changed("fp-a", "text"));
    expect(reduce(s, changed("fp-a", "text"))).toBe(s);
    // Inputs the machine ignores entirely in a protected phase.
    let running = reduce(driveToReady(), { type: "actionInvoked", snapshot: snapshot() });
    running = reduce(running, changed("fp-zz", "ignored text"));
    expect(running.phase).toBe("actionRunning");
  });

  it("no-op inputs in idle leave the state untouched", () => {
    expect(reduce(initial, { type: "touchEnd" })).toBe(initial);
    expect(reduce(initial, { type: "pointerUp" })).toBe(initial);
    expect(reduce(initial, { type: "contentScroll", deliberate: true })).toBe(initial);
    expect(reduce(initial, changed(null, ""))).toBe(initial);
  });

  it("deliberate scroll while settling resets to idle; while ready it suppresses the text", () => {
    let s = reduce(reduce(initial, changed(fp(), "text")), { type: "touchEnd" });
    expect(reduce(s, { type: "contentScroll", deliberate: true }).phase).toBe("idle");

    const readyState = driveToReady();
    const scrolled = reduce(readyState, { type: "contentScroll", deliberate: true });
    expect(scrolled.phase).toBe("idle");
    expect(scrolled.suppressedText).toBe("selected passage");
  });

  it("commitReady ports an externally validated selection straight to ready (PDF fixed)", () => {
    const s = reduce(initial, { type: "commitReady", selection: ready({ text: "pdf text" }) });
    expect(s.phase).toBe("ready");
    expect(s.readySelection?.text).toBe("pdf text");
    // The port never overrides a running action.
    let running = reduce(driveToReady(), { type: "actionInvoked", snapshot: snapshot() });
    running = reduce(running, { type: "commitReady", selection: ready({ text: "other" }) });
    expect(running.phase).toBe("actionRunning");
    expect(running.capturedAction?.text).toBe("selected passage");
  });

  it("settleConfirmed with a moved fingerprint keeps waiting (selecting)", () => {
    let s = reduce(initial, changed("fp-a", "text"));
    s = reduce(s, { type: "touchEnd" });
    s = reduce(s, settle("fp-b", ready())); // range changed underneath
    expect(s.phase).toBe("selecting");
  });

  it("suppressed selection cleared by a fresh different selection", () => {
    let s = reduce(driveToReady(), { type: "dismiss", suppressCurrentText: true });
    s = reduce(s, changed(fp(), "different text"));
    expect(s.suppressedText).toBeNull();
  });

  it("isActionPhase covers only the protected phases", () => {
    expect(isActionPhase("idle")).toBe(false);
    expect(isActionPhase("selecting")).toBe(false);
    expect(isActionPhase("settling")).toBe(false);
    expect(isActionPhase("ready")).toBe(false);
    expect(isActionPhase("actionRunning")).toBe(true);
    expect(isActionPhase("resultVisible")).toBe(true);
  });
});
