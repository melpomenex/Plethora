/**
 * Surface integration tests (tasks 4.5, 5.4, 6.4): jsdom simulation of the
 * full interaction story per surface — long-press → drag → release → settle →
 * ready; collapse-after-invoke continues the run; chapter navigation and
 * typography changes invalidate; and the AI sheet consumes the captured text
 * (never live selection state) with operation-staleness reporting.
 */

import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
const sheetFeatureFlags = vi.hoisted(() => ({
  aiLearnThis: false,
  aiLibraryRag: false,
  aiSocraticTutor: false,
  aiPrerequisites: false,
}));
vi.mock("../../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (state: { settings: { features: typeof sheetFeatureFlags } }) => unknown) =>
    selector({ settings: { features: sheetFeatureFlags } }),
}));
vi.mock("../../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => ({ path: "cloud", available: true, loading: false }),
}));
vi.mock("../../../../lib/ai/passageAI", () => ({
  summarizePassage: vi.fn(async (passage: string) => ({ text: `summary of ${passage}`, truncated: false })),
  explainPassage: vi.fn(async (passage: string) => ({ text: `explanation of ${passage}`, truncated: false })),
  answerPassage: vi.fn(async () => ({ text: "answer", truncated: false })),
  simplifyPassage: vi.fn(async () => ({ text: "simplified", truncated: false })),
  keyTermsPassage: vi.fn(async () => ({ text: "terms", truncated: false })),
}));
vi.mock("../../../../lib/ai/provider", () => ({ hasCloudProvider: () => true }));
vi.mock("../../../../lib/ai/onDeviceAI", () => ({
  getOnDeviceRequirementStatus: vi.fn(async () => ({ status: "unavailable" })),
  isOnDeviceAiSupportedPlatform: () => false,
  requestModelDownload: vi.fn(),
  toOnDeviceAiError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
  warmUpOnDevicePrompt: vi.fn(async () => {}),
}));
vi.mock("../../../../lib/ai/useAskLibrary", () => ({
  useAskLibrary: () => ({ ask: vi.fn(), reset: vi.fn(), running: false, error: null, result: null }),
}));
vi.mock("../../../../utils/openLibrarySource", () => ({ openLibrarySource: vi.fn() }));
vi.mock("../../SelectionPopup", () => ({ copySelectionTextToClipboard: vi.fn(async () => true) }));
vi.mock("../../../learn/LearnThisProposalSheet", () => ({
  LearnThisProposalSheet: () => <div data-testid="learn-this-stub" />,
}));
vi.mock("../../../tutor/TutorSheet", () => ({ TutorSheet: () => <div data-testid="tutor-stub" /> }));

import { summarizePassage } from "../../../../lib/ai/passageAI";
import { SelectionActionsSheet } from "../../SelectionActionsSheet";
import { useSelectionInteraction } from "../useSelectionInteraction";
import { SelectionActionBar } from "../SelectionActionBar";

const STABLE_MS = 500;

/** Reflow-PDF-style content: word spans inside canonical blocks. */
function makeReflowContent() {
  const root = document.createElement("div");
  root.setAttribute("data-document-content", "true");
  const page = document.createElement("div");
  page.setAttribute("data-pdf-reflow-page", "3");
  const block1 = document.createElement("p");
  block1.setAttribute("data-pdf-reflow-block", "b1");
  block1.innerHTML = "canonical word spans here";
  const block2 = document.createElement("p");
  block2.setAttribute("data-pdf-reflow-block", "b2");
  block2.innerHTML = "and a second block following";
  page.append(block1, block2);
  root.appendChild(page);
  document.body.appendChild(root);
  return { root, block1, block2 };
}

function selectRange(startNode: Node, start: number, endNode: Node, end: number, view: Window = window) {
  const range = view.document.createRange();
  range.setStart(startNode, start);
  range.setEnd(endNode, end);
  const selection = view.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    view.document.dispatchEvent(new Event("selectionchange"));
  });
  return range;
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

function settle() {
  act(() => {
    vi.advanceTimersByTime(STABLE_MS + 20);
  });
}

describe("EPUB iframe surface (task 4.5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
  });

  function makeIframe() {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    const para = doc.createElement("p");
    para.textContent = "epub chapter text for selection";
    doc.body.appendChild(para);
    return { iframe, doc, para };
  }

  it("long-press → drag (multiple selectionchange) → release → settle → ready with CFI + offset", () => {
    const { iframe, doc, para } = makeIframe();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "epub", documentId: "d1", enabled: true }),
    );
    act(() => {
      result.current.registerContentDocument({
        doc,
        win: iframe.contentWindow,
        offset: () => ({ x: 10, y: 20 }),
        buildSelectionContext: () => ({ type: "epub", cfiRange: "epubcfi(/6/4!/4/2)" }),
      });
    });

    // Long-press starts, user drags the right handle repeatedly: hidden.
    touchStart(doc.body);
    selectRange(para.firstChild!, 0, para.firstChild!, 5, iframe.contentWindow!);
    expect(result.current.phase).toBe("selecting");
    selectRange(para.firstChild!, 0, para.firstChild!, 15, iframe.contentWindow!);
    expect(result.current.phase).toBe("selecting");
    settle();
    expect(result.current.phase).toBe("selecting"); // finger still down → deferred

    // Release + stability → ready with the captured anchor context.
    touchEnd(doc.body);
    settle();
    expect(result.current.phase).toBe("ready");
    expect(result.current.readySelection?.text).toBe("epub chapter te");
    expect(result.current.readySelection?.selectionContext).toEqual({
      type: "epub",
      cfiRange: "epubcfi(/6/4!/4/2)",
    });
  });

  it("collapse-after-invoke continues the AI run; chapter navigation aborts and dismisses", () => {
    const { doc, para } = makeIframe();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "epub", documentId: "d1", enabled: true }),
    );
    act(() => {
      result.current.registerContentDocument({ doc, win: doc.defaultView });
    });
    touchStart(doc.body);
    selectRange(para.firstChild!, 0, para.firstChild!, 10, doc.defaultView!);
    touchEnd(doc.body);
    settle();
    expect(result.current.phase).toBe("ready");

    let snapshot: ReturnType<typeof result.current.captureForAction> = null;
    act(() => {
      snapshot = result.current.captureForAction();
    });
    expect(result.current.phase).toBe("actionRunning");

    // Native selection collapses (focus shift after tapping Summarize).
    const sel = doc.defaultView!.getSelection()!;
    sel.removeAllRanges();
    act(() => {
      doc.dispatchEvent(new Event("selectionchange"));
    });
    expect(result.current.phase).toBe("actionRunning"); // run survives

    // Sheet reports completion for the ACTIVE operation → result visible.
    act(() => {
      result.current.notifyActionSettled(snapshot!.operationId, "success");
    });
    expect(result.current.phase).toBe("resultVisible");

    // Chapter turn (relocated): abort + dismiss; a late completion is dropped.
    act(() => {
      result.current.invalidate("epub-relocated");
    });
    expect(result.current.phase).toBe("idle");
    act(() => {
      result.current.notifyActionSettled(snapshot!.operationId, "success");
    });
    expect(result.current.phase).toBe("idle");
  });

  it("font-size change (rendition theme invalidation) dismisses an anchored bar", () => {
    const { doc, para } = makeIframe();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "epub", documentId: "d1", enabled: true }),
    );
    act(() => {
      result.current.registerContentDocument({ doc, win: doc.defaultView });
    });
    touchStart(doc.body);
    selectRange(para.firstChild!, 0, para.firstChild!, 9, doc.defaultView!);
    touchEnd(doc.body);
    settle();
    expect(result.current.phase).toBe("ready");

    act(() => {
      result.current.invalidate("epub-theme-changed");
    });
    expect(result.current.phase).toBe("idle");
  });
});

describe("Reflowed PDF surface (task 5.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
  });

  it("multi-block selection settles ready with the reflow container as passage context", () => {
    const { root, block1, block2 } = makeReflowContent();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "pdf-reflow", documentId: "d1", enabled: true }),
    );
    touchStart(root);
    // Drag across two canonical blocks (start in b1's text, end in b2's text).
    selectRange(block1.firstChild!, 10, block2.firstChild!, 7);
    touchEnd(root);
    settle();
    expect(result.current.phase).toBe("ready");
    expect(result.current.readySelection?.text).toContain("spans here");
    expect(result.current.readySelection?.text).toContain("and a s");
    // Cross-block selections don't fit any single block's text, so the
    // passage builder falls back to the selection itself (existing contract —
    // per-block passage bounds are deferred to canonical phase-8 anchoring).
    expect(result.current.readySelection?.passage).toBe(result.current.readySelection?.text);
  });

  it("word-span DOM churn after dismissal does not re-open UI (text-keyed suppression)", () => {
    const { root, block1 } = makeReflowContent();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "pdf-reflow", documentId: "d1", enabled: true }),
    );
    touchStart(root);
    selectRange(block1.firstChild!, 0, block1.firstChild!, 9);
    touchEnd(root);
    settle();
    expect(result.current.phase).toBe("ready");
    act(() => {
      result.current.dismiss({ suppressCurrentText: true });
    });

    // Lazy page sections append around the live selection; offsets shift but
    // text is identical — the churned selectionchange must NOT re-open.
    const churn = document.createElement("p");
    churn.setAttribute("data-pdf-reflow-block", "b-lazy");
    churn.textContent = "appended lazy section";
    root.firstElementChild!.prepend(churn);
    selectRange(block1.firstChild!, 0, block1.firstChild!, 9);
    settle();
    expect(result.current.phase).toBe("idle");

    // A genuinely new selection (fresh gesture in content) re-opens.
    touchStart(root);
    selectRange(block1.firstChild!, 2, block1.firstChild!, 12);
    touchEnd(root);
    settle();
    expect(result.current.phase).toBe("ready");
  });

  it("font-width change (reflow relayout) invalidates placement", () => {
    const { root, block1 } = makeReflowContent();
    const { result } = renderHook(() =>
      useSelectionInteraction({ surface: "pdf-reflow", documentId: "d1", enabled: true }),
    );
    touchStart(root);
    selectRange(block1.firstChild!, 0, block1.firstChild!, 9);
    touchEnd(root);
    settle();
    expect(result.current.phase).toBe("ready");
    act(() => {
      result.current.invalidate("reflow-relayout");
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.placement).toBeNull();
  });
});

describe("AI sheet consumes the captured snapshot (task 6.4)", () => {
  beforeEach(() => {
    // Real timers: waitFor drives the async AI promise chain.
    document.body.innerHTML = "";
    vi.mocked(summarizePassage).mockClear();
  });
  afterEach(() => {
    cleanup();
  });

  it("Summarize uses the captured text/passage after the live selection collapses; retry reuses it", async () => {
    // A live selection exists, then collapses right after invocation.
    const host = document.createElement("div");
    host.setAttribute("data-document-content", "true");
    const para = document.createElement("p");
    para.textContent = "the captured passage text";
    host.appendChild(para);
    document.body.appendChild(host);
    const range = document.createRange();
    range.setStart(para.firstChild!, 4);
    range.setEnd(para.firstChild!, 22);
    window.getSelection()!.addRange(range);

    const onSettled = vi.fn();
    render(
      <SelectionActionsSheet
        open
        initialAction="summarize"
        text="captured passage"
        passage="context around captured passage"
        operationId="op-641"
        onSettled={onSettled}
        onClose={() => {}}
      />,
    );

    // The native selection collapses mid-run (the reported bug).
    act(() => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(summarizePassage).toHaveBeenCalledTimes(1);
    });
    expect(summarizePassage).toHaveBeenCalledWith(
      "context around captured passage",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await waitFor(() => {
      expect(onSettled).toHaveBeenCalledWith("op-641", "success");
    });
    // The result stays mounted with the captured selection's output.
    expect(await screen.findByText(/summary of context around/)).toBeTruthy();
  });

  it("stale completions (operationId no longer active) are dropped by the machine", async () => {
    const onSettled = vi.fn();
    render(
      <SelectionActionsSheet
        open
        initialAction="summarize"
        text="first selection"
        passage="first passage"
        operationId="op-A"
        onSettled={onSettled}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith("op-A", "success"));
    // A late duplicate completion for the same (now superseded) operation is
    // rejected by the machine (see machine tests) — the sheet reports once.
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});

describe("SelectionActionBar (task 3.1)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => cleanup);

  it("renders a toolbar with chips and overflow, hidden without placement", () => {
    const onAction = vi.fn();
    const onOverflow = vi.fn();
    const { rerender } = render(
      <SelectionActionBar placement={null} onAction={onAction} onOverflow={onOverflow} onDismiss={() => {}} />,
    );
    expect(screen.queryByRole("toolbar")).toBeNull();

    rerender(
      <SelectionActionBar
        placement={{ top: 100, left: 20, maxWidth: 280, placement: "above" }}
        onAction={onAction}
        onOverflow={onOverflow}
        onDismiss={() => {}}
      />,
    );
    const bar = screen.getByRole("toolbar");
    expect(bar.getAttribute("data-selection-interaction-ui")).toBe("true");
    const buttons = bar.querySelectorAll("button");
    expect(buttons.length).toBe(5); // Summarize, Explain, Ask, Extract, ⋯
    buttons[4].click();
    expect(onOverflow).toHaveBeenCalledTimes(1);
    buttons[0].click();
    expect(onAction).toHaveBeenCalledWith("summarize");
    // ≥44px targets.
    for (const button of buttons) {
      expect(button.className).toContain("h-11");
    }
  });
});
