import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emit = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/feedback/orchestrator", () => ({
  emitUserInteraction: emit,
  createFeedbackInteractionId: (() => { let id = 0; return () => `pull:${++id}`; })(),
}));
import { PullToRefresh } from "../PullToRefresh";
function touch(node: HTMLElement, kind: string, y = 0) {
  const event = new Event(kind, { bubbles: true });
  Object.defineProperty(event, "touches", { value: kind === "touchend" || kind === "touchcancel" ? [] : [{ clientY: y }] });
  fireEvent(node, event);
}
describe("refresh threshold ownership", () => {
  beforeEach(() => { emit.mockClear(); });
  it("arms once across retreat/re-cross, then re-arms a new gesture", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const view = render(<PullToRefresh onRefresh={refresh}><div>Content</div></PullToRefresh>);
    const node = view.container.firstElementChild as HTMLElement;
    touch(node, "touchstart");
    touch(node, "touchmove", 180);
    touch(node, "touchmove", 40);
    touch(node, "touchmove", 190);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]?.[0]).toBe("queue.refresh-armed");
    touch(node, "touchcancel");
    expect(refresh).not.toHaveBeenCalled();
    touch(node, "touchstart");
    touch(node, "touchmove", 180);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[0]?.[1]).not.toBe(emit.mock.calls[1]?.[1]);
  });
  it("cancel or disable does not refresh and leaves no armed continuation", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const view = render(<PullToRefresh onRefresh={refresh}><div /></PullToRefresh>);
    const node = view.container.firstElementChild as HTMLElement;
    touch(node, "touchstart");
    touch(node, "touchmove", 180);
    view.rerender(<PullToRefresh disabled onRefresh={refresh}><div /></PullToRefresh>);
    touch(node, "touchend");
    view.rerender(<PullToRefresh onRefresh={refresh}><div /></PullToRefresh>);
    touch(node, "touchmove", 180);
    expect(refresh).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("a committed refresh failure owns a distinct error and never a second success", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("offline"));
    const view = render(<PullToRefresh onRefresh={refresh}><div /></PullToRefresh>);
    const node = view.container.firstElementChild as HTMLElement;
    touch(node, "touchstart");
    touch(node, "touchmove", 180);
    await act(async () => { touch(node, "touchend"); });
    expect(refresh).toHaveBeenCalledOnce();
    expect(emit.mock.calls.map((call) => call[0])).toEqual(["queue.refresh-armed", "action.failed"]);
    expect(emit.mock.calls[0]?.[1]).not.toBe(emit.mock.calls[1]?.[1]);
  });
});
