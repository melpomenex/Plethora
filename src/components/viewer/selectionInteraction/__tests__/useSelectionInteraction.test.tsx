/**
 * Hook tests for useSelectionInteraction (task 2.5): settle after touchend +
 * stability, defer-while-touching, suppression re-arm on fresh gesture,
 * reposition-on-scroll once per frame, cleanup on unmount.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The hook defaults its passage builder to SelectionActionsSheet's; keep the
// heavy AI/i18n graph out of this unit test.
vi.mock("../../../lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock("../../SelectionActionsSheet", () => ({
  passageAroundSelection: (_selection: Selection | null, text: string) => `passage:${text}`,
}));

import { useSelectionInteraction } from "../useSelectionInteraction";

const STABLE_MS = 500;

function makeContent(text = "selected passage") {
  const root = document.createElement("div");
  root.setAttribute("data-document-content", "true");
  const para = document.createElement("p");
  para.textContent = `before ${text} after`;
  root.appendChild(para);
  document.body.appendChild(root);
  return { root, para, text };
}

function selectText(para: HTMLParagraphElement, start: number, end: number) {
  const textNode = para.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
  return range;
}

function clearSelection() {
  window.getSelection()!.removeAllRanges();
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

function touchStart(target: Element) {
  act(() => {
    target.dispatchEvent(new Event("touchstart", { bubbles: true, cancelable: true }));
  });
}

function touchEnd(target: Element = document.body) {
  act(() => {
    target.dispatchEvent(new Event("touchend", { bubbles: true, cancelable: true }));
  });
}

function advanceSettle() {
  act(() => {
    vi.advanceTimersByTime(STABLE_MS + 10);
  });
}

describe("useSelectionInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
  });

  it("settles after release + stability window and exposes the capture", () => {
    const { root, para } = makeContent("hello world");
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "markdown", documentId: "d1", enabled: true }),
    );

    // Long-press drag: selection changes while the finger is down.
    touchStart(root);
    selectText(para, 7, 18);
    expect(result.current.phase).toBe("selecting");

    advanceSettle();
    // Defer loop: finger still down → never surfaces.
    expect(result.current.phase).toBe("selecting");

    touchEnd(root);
    advanceSettle();
    expect(result.current.phase).toBe("ready");
    expect(result.current.readySelection?.text).toBe("hello world");
    expect(result.current.readySelection?.passage).toBe("passage:hello world");
  });

  it("re-hides on resumed adjustment and re-settles on the new range", () => {
    const { root, para } = makeContent("hello world");
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "markdown", documentId: "d1", enabled: true }),
    );

    touchStart(root);
    selectText(para, 7, 12);
    touchEnd(root);
    advanceSettle();
    expect(result.current.phase).toBe("ready");

    // Grab a handle again: changes → hidden.
    touchStart(root);
    selectText(para, 7, 18);
    expect(result.current.phase).toBe("selecting");
    touchEnd(root);
    advanceSettle();
    expect(result.current.phase).toBe("ready");
    expect(result.current.readySelection?.text).toBe("hello world");
  });

  it("defers while touching but never wedges (bounded defer, MAX_DEFER_MS)", () => {
    const { root, para } = makeContent();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "pdf-reflow", documentId: "d1", enabled: true }),
    );

    touchStart(root);
    selectText(para, 7, 25);
    // System-consumed gesture: touchend never arrives.
    vi.advanceTimersByTime(150);
    act(() => {
      vi.advanceTimersByTime(STABLE_MS + 3200);
    });
    // Bounded: gives up waiting (back to hidden idle), no infinite loop.
    expect(result.current.phase).toBe("idle");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("dismissed selection stays suppressed across churn but re-arms on a fresh gesture", () => {
    const { root, para } = makeContent("same words");
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "pdf-reflow", documentId: "d1", enabled: true }),
    );

    touchStart(root);
    selectText(para, 7, 16);
    touchEnd(root);
    advanceSettle();
    expect(result.current.phase).toBe("ready");

    act(() => result.current.dismiss({ suppressCurrentText: true }));
    expect(result.current.phase).toBe("idle");

    // Native selection survives (Android): churn fires selectionchange for the
    // same text → suppressed, no re-surface.
    selectText(para, 7, 16);
    advanceSettle();
    expect(result.current.phase).toBe("idle");

    // Fresh gesture in content clears the guard: same text re-opens.
    touchStart(root);
    selectText(para, 7, 16);
    touchEnd(root);
    advanceSettle();
    expect(result.current.phase).toBe("ready");
  });

  it("deliberate scroll dismisses the ready bar; sub-threshold scroll repositions once per frame", () => {
    const { root, para } = makeContent();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "markdown", documentId: "d1", enabled: true }),
    );

    touchStart(root);
    selectText(para, 7, 25);
    touchEnd(root);
    advanceSettle();
    expect(result.current.phase).toBe("ready");

    const scroller = document.createElement("div");
    scroller.setAttribute("data-document-content", "true");
    root.appendChild(scroller);
    // Micro-scroll (below the 8px gate): placement revalidation, no dismiss.
    act(() => {
      scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(result.current.phase).toBe("ready");

    // Deliberate scroll (≥8px travel): dismissed + suppressed.
    Object.defineProperty(scroller, "scrollTop", { value: 40, configurable: true });
    act(() => {
      scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(result.current.phase).toBe("idle");
  });

  it("captureForAction snapshots the ready selection and survives collapse", () => {
    const { root, para } = makeContent("capture me");
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "markdown", documentId: "d1", enabled: true }),
    );

    touchStart(root);
    selectText(para, 7, 17);
    touchEnd(root);
    advanceSettle();

    let snapshot: ReturnType<typeof result.current.captureForAction> = null;
    act(() => {
      snapshot = result.current.captureForAction();
    });
    expect(snapshot?.text).toBe("capture me");
    expect(snapshot?.documentId).toBe("d1");
    expect(snapshot?.surface).toBe("markdown");
    expect(result.current.phase).toBe("actionRunning");
    expect(result.current.capturedAction?.operationId).toBe(snapshot!.operationId);

    // Native selection collapses mid-run: the action keeps running.
    clearSelection();
    expect(result.current.phase).toBe("actionRunning");

    // Completion lands only for the active operation.
    act(() => result.current.notifyActionSettled("bogus-op", "success"));
    expect(result.current.phase).toBe("actionRunning");
    act(() => result.current.notifyActionSettled(snapshot!.operationId, "success"));
    expect(result.current.phase).toBe("resultVisible");

    // Deliberate dismissal.
    act(() => result.current.dismiss());
    expect(result.current.phase).toBe("idle");
  });

  it("context invalidation from resultVisible aborts and cannot be superseded by late events", () => {
    const { root, para } = makeContent();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "epub", documentId: "d1", enabled: true }),
    );
    const onInvalidate = vi.fn();
    // (hook re-render with the callback is not needed — options live in a ref)

    touchStart(root);
    selectText(para, 7, 25);
    touchEnd(root);
    advanceSettle();
    act(() => result.current.captureForAction());
    act(() => result.current.notifyActionSettled(result.current.capturedAction!.operationId, "success"));
    expect(result.current.phase).toBe("resultVisible");

    act(() => result.current.invalidate("epub-relocated"));
    expect(result.current.phase).toBe("idle");
    expect(result.current.capturedAction).toBeNull();
    // A late completion cannot resurrect the aborted operation.
    act(() => result.current.notifyActionSettled("late", "success"));
    expect(result.current.phase).toBe("idle");
  });

  it("desktop pointer release settles immediately (no artificial delay)", () => {
    const { para } = makeContent();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "epub", documentId: "d1", enabled: true }),
    );

    selectText(para, 7, 25);
    expect(result.current.phase).toBe("selecting");
    // Drain jsdom's own async selectionchange task (fired on addRange) so it
    // cannot land after the release and re-hide a settled bar.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    const pointerUp = new Event("pointerup", { bubbles: true });
    Object.defineProperty(pointerUp, "pointerType", { value: "mouse" });
    act(() => {
      document.dispatchEvent(pointerUp);
    });
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.phase).toBe("ready");
  });

  it("cleans up listeners and timers on unmount", () => {
    const { root, para } = makeContent();
    const { unmount } = renderHook(() =>
      useSelectionInteraction({ surface: "markdown", documentId: "d1", enabled: true }),
    );
    touchStart(root);
    selectText(para, 7, 25);
    const timersBefore = vi.getTimerCount();
    // The settle timer (+ possibly jsdom's own async selectionchange task).
    expect(timersBefore).toBeGreaterThan(0);

    unmount();
    // The controller's settle timer is cleared on unmount; at most jsdom's
    // internal pending selectionchange task remains (fires into detached
    // listeners — harmless).
    expect(vi.getTimerCount()).toBeLessThan(timersBefore);

    // Post-unmount events are inert (no throw, no state left behind).
    expect(() => {
      selectText(para, 7, 18);
      touchEnd(root);
      act(() => {
        vi.runAllTimers();
      });
    }).not.toThrow();
  });

  it("document switch invalidates (late results cannot cross documents)", () => {
    const { root, para } = makeContent();
    const { result, rerender } = renderHook(
      ({ docId }: { docId: string }) =>
        useSelectionInteraction({ surface: "epub", documentId: docId, enabled: true }),
      { initialProps: { docId: "d1" } },
    );

    touchStart(root);
    selectText(para, 7, 25);
    touchEnd(root);
    advanceSettle();
    act(() => result.current.captureForAction());
    expect(result.current.phase).toBe("actionRunning");

    rerender({ docId: "d2" });
    expect(result.current.phase).toBe("idle");
    expect(result.current.capturedAction).toBeNull();
  });

  it("registerContentDocument bridges iframe selection events (EPUB)", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const iframeDoc = iframe.contentDocument!;
    const iframeRoot = iframeDoc.createElement("div");
    const paraEl = iframeDoc.createElement("p");
    paraEl.textContent = "iframe text here";
    iframeRoot.appendChild(paraEl);
    iframeDoc.body.appendChild(iframeRoot);

    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "epub", documentId: "d1", enabled: true }),
    );
    let detach: (() => void) | null = null;
    act(() => {
      detach = result.current.registerContentDocument({
        doc: iframeDoc,
        win: iframe.contentWindow,
        offset: () => ({ x: 40, y: 120 }),
        buildSelectionContext: () => ({ type: "epub", cfiRange: "epubcfi(/6/4)" }),
      });
    });

    // Long-press inside the iframe: selectionchange in the IFRAME document.
    touchStart(iframeRoot);
    const range = iframeDoc.createRange();
    range.setStart(paraEl.firstChild!, 0);
    range.setEnd(paraEl.firstChild!, 11);
    const iframeSelection = iframe.contentWindow!.getSelection()!;
    iframeSelection.removeAllRanges();
    iframeSelection.addRange(range);
    act(() => {
      iframeDoc.dispatchEvent(new Event("selectionchange"));
    });
    expect(result.current.phase).toBe("selecting");

    act(() => {
      iframeDoc.dispatchEvent(new Event("touchend", { bubbles: true }));
    });
    advanceSettle();
    expect(result.current.phase).toBe("ready");
    expect(result.current.readySelection?.text).toBe("iframe text");
    expect(result.current.readySelection?.selectionContext).toEqual({
      type: "epub",
      cfiRange: "epubcfi(/6/4)",
    });
    // Geometry carries the iframe offset.
    expect(result.current.readySelection?.geometry?.rect.left).toBe(40);
    expect(result.current.readySelection?.geometry?.rect.top).toBe(120);

    act(() => detach?.());
  });

  it("enabled=false parks the controller at idle and ignores input", () => {
    const { para } = makeContent();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "markdown", documentId: "d1", enabled: false }),
    );
    selectText(para, 7, 25);
    advanceSettle();
    expect(result.current.phase).toBe("idle");
  });
});
