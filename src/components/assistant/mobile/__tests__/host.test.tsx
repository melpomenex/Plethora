import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MobileAssistantHost } from "../MobileAssistantHost";
import { MobileAssistantContextProvider } from "../MobileAssistantContext";
import { registerOverlayDismissal, requestOverlayBack, resetOverlayStackForTests } from "../../../../lib/overlayStack";
const mocks = vi.hoisted(() => ({ panel: vi.fn(), feedback: vi.fn() }));
const chrome = vi.hoisted(() => ({ toolbar: 48, composer: 96 }));
vi.mock("../../AssistantPanel", () => ({
  AssistantPanel: (props: {
    conversationKey?: string;
    mobilePresentation?: { sheet?: { detent?: string; hasPartial?: boolean; onToggleDetent?: () => void; onClose?: () => void; source?: { title: string; removed: boolean; onToggle: () => void } } };
  }) => {
    mocks.panel(props);
    const sheet = props.mobilePresentation?.sheet;
    const fixedHeight = (value: number) => (node: HTMLElement | null) => {
      if (node) Object.defineProperty(node, "offsetHeight", { configurable: true, get: () => value });
    };
    return <>
      <textarea aria-label="Conversation draft" />
      <div data-assistant-toolbar ref={fixedHeight(chrome.toolbar)} />
      <div data-assistant-composer ref={fixedHeight(chrome.composer)} />
      {sheet?.hasPartial && <button type="button" aria-label={sheet.detent === "partial" ? "Expand Assistant" : "Collapse Assistant"} onClick={sheet.onToggleDetent}>Detent</button>}
      {sheet?.source && <button type="button" onClick={sheet.source.onToggle}>{sheet.source.removed ? "Attach source" : "Remove source"}</button>}
      <button type="button" onClick={sheet?.onClose}>Close Assistant</button>
    </>;
  },
}));
vi.mock("../../../../lib/feedback/orchestrator", () => ({ createFeedbackInteractionId: () => "opaque", emitUserInteraction: mocks.feedback }));
class TestPointerEvent extends MouseEvent {
  pointerId: number; isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; }
}
let reduced = true;
let frames: Map<number, FrameRequestCallback>;
const navRef = { current: null };
function fixture(fullscreen = false) { return <MobileAssistantContextProvider><div className="adaptive-shell-root"><button>Reader control</button></div><MobileAssistantHost navRef={navRef} fullscreen={fullscreen} /></MobileAssistantContextProvider>; }
function drag(up: number) {
  const pill = screen.getByRole("button", { name: "Assistant" });
  fireEvent.pointerDown(pill, { pointerId: 1, isPrimary: true, button: 0, clientX: 150, clientY: 600 });
  fireEvent.pointerMove(pill, { pointerId: 1, clientX: 150, clientY: 600 - up });
  return pill;
}
function tick(now: number) { act(() => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb(now)); }); }
function lastPanelProps(): { mobilePresentation?: { sheet?: Record<string, unknown> } } {
  return mocks.panel.mock.calls.at(-1)![0];
}
beforeEach(() => {
  vi.clearAllMocks(); resetOverlayStackForTests(); reduced = true; frames = new Map(); let id = 0;
  chrome.toolbar = 48; chrome.composer = 96;
  // The shared test setup stubs every element at 800px; the sheet's chrome
  // budget needs real (zero) defaults plus the per-element heights above.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return 0; } });
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (n: number) => { frames.delete(n); });
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ matches: reduced, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.releasePointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  document.documentElement.style.setProperty("--app-viewport-height", "800px");
  document.body.style.overflow = "";
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.style.removeProperty("--app-viewport-height"); });
describe("single mobile Assistant host", () => {
  it("opens one lazy conversation on tap and preserves it through close and reopen", async () => {
    render(fixture()); expect(mocks.panel).not.toHaveBeenCalled(); expect(screen.getAllByRole("button", { name: "Assistant" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    const draft = await screen.findByRole("textbox", { name: "Conversation draft" });
    expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith("assistant.opened", "opaque:opened");
    expect(mocks.panel).toHaveBeenLastCalledWith(expect.objectContaining({ conversationKey: "mobile:global", fillContainer: true }));
    expect(lastPanelProps().mobilePresentation).toEqual(expect.objectContaining({
      visible: true,
      sheet: expect.objectContaining({ onClose: expect.any(Function), closeRef: expect.any(Object) }),
    }));
    fireEvent.change(draft, { target: { value: "preserved" } });
    fireEvent.click(screen.getByRole("button", { name: "Close Assistant" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(screen.getByRole("textbox")).toHaveValue("preserved");
    // Partial (the default detent) is a nonmodal named region; expanding is
    // the modal dialog (design D7, task 4.2).
    expect(screen.getAllByRole("region")).toHaveLength(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Expand Assistant" })[1]);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
  it("preview has no conversation or focus ownership; Back consumes it", () => {
    render(fixture()); const pill = drag(80); tick(16);
    expect(mocks.panel).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => { expect(requestOverlayBack()).toBe(true); });
    fireEvent.pointerUp(pill, { pointerId: 1, clientX: 150, clientY: 450 });
    expect(mocks.panel).not.toHaveBeenCalled(); expect(mocks.feedback).not.toHaveBeenCalled();
  });
  it("drag open has only threshold feedback and movement does not render Panel", async () => {
    render(fixture()); const pill = drag(110);
    fireEvent.pointerUp(pill, { pointerId: 1, clientX: 150, clientY: 490 });
    await screen.findByRole("textbox");
    expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith("assistant.invoke-armed", "opaque:armed");
    const renders = mocks.panel.mock.calls.length;
    const handle = screen.getAllByRole("button", { name: "Expand Assistant" })[0];
    fireEvent.pointerDown(handle, { pointerId: 1, isPrimary: true, button: 0, clientX: 150, clientY: 500 });
    for (let i = 8; i < 50; i++) fireEvent.pointerMove(handle, { pointerId: 1, clientX: 150, clientY: 500 - i });
    tick(16); expect(mocks.panel).toHaveBeenCalledTimes(renders);
    fireEvent.pointerCancel(handle);
  });
  it("changed open detent has one cue; close and no-change settlement are silent", async () => {
    render(fixture()); fireEvent.click(screen.getByRole("button", { name: "Assistant" })); await screen.findByRole("textbox"); mocks.feedback.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: "Expand Assistant" })[1]);
    expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith("assistant.detent-settled", "opaque:detent");
    fireEvent.click(screen.getByRole("button", { name: "Close Assistant" })); expect(mocks.feedback).toHaveBeenCalledTimes(1);
  });
  it("retains overlay claim through exit and stale settlement cannot reopen", async () => {
    reduced = false; render(fixture()); fireEvent.click(screen.getByRole("button", { name: "Assistant" })); await screen.findByRole("textbox");
    act(() => { expect(requestOverlayBack()).toBe(true); expect(requestOverlayBack()).toBe(true); });
    tick(0); tick(400);
    await waitFor(() => expect(screen.queryByRole("region")).not.toBeInTheDocument());
    expect(requestOverlayBack()).toBe(false); expect(screen.getByRole("button", { name: "Assistant" })).toBeVisible();
    expect(mocks.feedback).toHaveBeenCalledTimes(1);
  });
  it("lets higher overlays own Back and restores reader interaction after close", async () => {
    render(fixture()); fireEvent.click(screen.getByRole("button", { name: "Assistant" })); await screen.findByRole("textbox");
    // Partial is nonmodal: the reader stays operable and the shell is not inert.
    expect(document.querySelector<HTMLElement>(".adaptive-shell-root")?.inert ?? false).toBe(false);
    // Expanding owns modal focus and keeps the shell inert while open.
    fireEvent.click(screen.getAllByRole("button", { name: "Expand Assistant" })[1]);
    expect(document.querySelector<HTMLElement>(".adaptive-shell-root")?.inert).toBe(true);
    const dismiss = vi.fn(); let cleanup: () => void;
    act(() => { cleanup = registerOverlayDismissal(() => { dismiss(); cleanup(); }, { priority: 100 }); });
    act(() => { expect(requestOverlayBack()).toBe(true); }); expect(dismiss).toHaveBeenCalledOnce(); expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => { expect(requestOverlayBack()).toBe(true); }); expect(document.querySelector<HTMLElement>(".adaptive-shell-root")?.inert).toBe(false); expect(document.body.style.overflow).toBe("");
  });
  it("fullscreen suppresses invocation and closes an open presentation", async () => {
    const view = render(fixture()); fireEvent.click(screen.getByRole("button", { name: "Assistant" })); await screen.findByRole("textbox"); view.rerender(fixture(true));
    expect(screen.queryByRole("button", { name: "Assistant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it("keeps one chrome row: no mode tabs, no source bar, one handle", async () => {
    render(fixture()); fireEvent.click(screen.getByRole("button", { name: "Assistant" })); await screen.findByRole("textbox");
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(document.querySelector(".mobile-assistant-sheet-bar")).toBeNull();
    expect(document.querySelector(".mobile-assistant-source")).toBeNull();
    const header = document.querySelector(".mobile-assistant-sheet-header")!;
    expect(header.querySelectorAll("button")).toHaveLength(1);
    expect(header.querySelector("button")!.getAttribute("aria-label")).toMatch(/Assistant/);
  });
  it("reduced chrome budget keeps both open detents available", async () => {
    render(fixture()); fireEvent.click(screen.getByRole("button", { name: "Assistant" })); await screen.findByRole("textbox");
    expect(lastPanelProps().mobilePresentation?.sheet?.hasPartial).toBe(true);
    expect(screen.getAllByRole("button", { name: "Expand Assistant" }).length).toBeGreaterThanOrEqual(2);
  });
  it("older heavy chrome still collapses the sheet to a single stop", async () => {
    chrome.toolbar = 400; chrome.composer = 400;
    render(fixture()); fireEvent.click(screen.getByRole("button", { name: "Assistant" })); await screen.findByRole("textbox");
    await waitFor(() => expect(lastPanelProps().mobilePresentation?.sheet?.hasPartial).toBe(false));
  });
  it("does not release a higher sheet's independent body scroll lock", async () => {
    render(fixture()); fireEvent.click(screen.getByRole("button", { name: "Assistant" })); await screen.findByRole("textbox");
    document.body.style.overflow = "hidden";
    fireEvent.click(screen.getByRole("button", { name: "Close Assistant" })); expect(document.body.style.overflow).toBe("hidden");
    document.body.style.overflow = "";
  });
});
