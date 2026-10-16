import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAssistantSheetGesture } from "../useAssistantSheetGesture";
import { assistantSheetGeometry } from "../gesture";
const feedback = vi.hoisted(() => ({ emitUserInteraction: vi.fn(), createFeedbackInteractionId: vi.fn(() => "opaque") }));
vi.mock("../../../../lib/feedback/orchestrator", () => feedback);
const release = vi.fn(); const preview = vi.fn(); const cancel = vi.fn(); const tap = vi.fn();
class TestPointerEvent extends MouseEvent {
  pointerId: number; isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; }
}
function Fixture({ enabled = true, identity = "view", height = 800, kind = "invoke" as "invoke" | "handle" }) {
  const gesture = useAssistantSheetGesture({ enabled, identity, kind, geometry: assistantSheetGeometry(height), detent: kind === "invoke" ? "closed" : "partial", onStart: vi.fn(), onPreview: preview, onRelease: release, onCancel: cancel, onTap: tap });
  return <><button {...gesture.bindings}>Owner</button><div>Reader</div></>;
}
const down = (target: Element, init: PointerEventInit = {}) => fireEvent.pointerDown(target, { pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 400, ...init });
const move = (target: Element, up: number) => fireEvent.pointerMove(target, { pointerId: 1, clientX: 100, clientY: 400 - up });
const up = (target: Element, distance: number) => fireEvent.pointerUp(target, { pointerId: 1, clientX: 100, clientY: 400 - distance });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});
describe("local Assistant Pointer Events", () => {
  it("leaves a below-slop contact to the normal click", () => {
    render(<Fixture />); const owner = screen.getByText("Owner"); down(owner); move(owner, 7); up(owner, 7); fireEvent.click(owner, { detail: 1 });
    expect(tap).toHaveBeenCalledOnce(); expect(release).not.toHaveBeenCalled(); expect(feedback.emitUserInteraction).not.toHaveBeenCalled();
  });
  it("latches feedback once through dozens of frames retreat and recross", () => {
    render(<Fixture />); const owner = screen.getByText("Owner"); down(owner);
    for (let d = 8; d < 140; d++) move(owner, d);
    move(owner, 40); move(owner, 110); up(owner, 110); fireEvent.click(owner, { detail: 1 });
    expect(feedback.emitUserInteraction).toHaveBeenCalledExactlyOnceWith("assistant.invoke-armed", "opaque:armed");
    expect(release).toHaveBeenCalledExactlyOnceWith("partial", "opaque", "drag"); expect(tap).not.toHaveBeenCalled();
  });
  it("uses release displacement even with no final movement frame", () => {
    render(<Fixture />); const owner = screen.getByText("Owner"); down(owner); move(owner, 110); up(owner, 40);
    expect(release).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
  });
  it("rejects horizontal movement and outside-origin crossing", () => {
    render(<Fixture />); const owner = screen.getByText("Owner"); down(screen.getByText("Reader")); move(owner, 120); up(owner, 120);
    expect(preview).not.toHaveBeenCalled();
    down(owner); fireEvent.pointerMove(owner, { pointerId: 1, clientX: 130, clientY: 400 }); up(owner, 120); fireEvent.click(owner, { detail: 1 });
    expect(release).not.toHaveBeenCalled(); expect(tap).not.toHaveBeenCalled();
  });
  it.each(["pointercancel", "lostpointercapture", "blur", "pagehide", "second-contact", "leave-before-capture"])("%s is terminal before and after ownership", event => {
    for (const owned of [false, true]) {
      const view = render(<Fixture />); const owner = screen.getByText("Owner"); down(owner); if (owned && event !== "leave-before-capture") move(owner, 110);
      if (event === "blur" || event === "pagehide") fireEvent(window, new Event(event));
      else if (event === "second-contact") down(screen.getByText("Reader"), { pointerId: 2, isPrimary: false });
      else if (event === "leave-before-capture") fireEvent.pointerLeave(owner);
      else fireEvent(owner, new TestPointerEvent(event, { bubbles: true, pointerId: 1 }));
      up(owner, 120); fireEvent.click(owner, { detail: 1 });
      expect(release).not.toHaveBeenCalled(); expect(tap).not.toHaveBeenCalled(); view.unmount();
    }
  });
  it("owner, geometry and availability changes cancel late releases", () => {
    for (const props of [{ enabled: false }, { identity: "next" }, { height: 500 }]) {
      const view = render(<Fixture />); const owner = screen.getByText("Owner"); down(owner); move(owner, 110); view.rerender(<Fixture {...props} />); up(owner, 120); fireEvent.click(owner, { detail: 1 });
      expect(release).not.toHaveBeenCalled(); expect(tap).not.toHaveBeenCalled(); view.unmount();
    }
  });
  it("ignores secondary mouse buttons and secondary pointers", () => {
    render(<Fixture />); const owner = screen.getByText("Owner"); down(owner, { button: 2 }); move(owner, 110); up(owner, 110);
    down(owner, { isPrimary: false }); move(owner, 110); up(owner, 110); expect(release).not.toHaveBeenCalled();
  });
  it("keeps accessible synthesized activation available after cancellation and StrictMode remount", () => {
    const view = render(<StrictMode><Fixture /></StrictMode>); const owner = screen.getByText("Owner"); down(owner); move(owner, 110); fireEvent.pointerCancel(owner); fireEvent.click(owner, { detail: 0 }); expect(tap).toHaveBeenCalledOnce(); view.unmount();
    render(<StrictMode><Fixture /></StrictMode>); fireEvent.click(screen.getByText("Owner"), { detail: 0 }); expect(tap).toHaveBeenCalledTimes(2);
  });
  it("handle release changes one state and content movement does not resize", () => {
    render(<Fixture kind="handle" />); const owner = screen.getByText("Owner"); down(screen.getByText("Reader")); move(owner, 150); expect(preview).not.toHaveBeenCalled(); down(owner); move(owner, 150); up(owner, 150);
    expect(release).toHaveBeenCalledExactlyOnceWith("expanded", "opaque", "handle"); expect(feedback.emitUserInteraction).not.toHaveBeenCalled();
  });
  it("unmount invalidates pending input", () => {
    const view = render(<Fixture />); const owner = screen.getByText("Owner"); down(owner); move(owner, 110); act(() => view.unmount()); up(owner, 120); expect(release).not.toHaveBeenCalled();
  });
});
