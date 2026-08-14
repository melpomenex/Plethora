import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  attachIframePointerActivityForwarder,
  IFRAME_POINTER_ACTIVITY_EVENT,
  type IframePointerActivityDetail,
} from "../iframePointerActivity";

/**
 * The bridge exists because pointer events inside a content iframe (epub.js,
 * HTML viewer) never reach the parent window — so Scroll Mode's overlay
 * controls, driven by parent-window mousemove, could not be summoned by
 * moving the cursor over the reading content (e.g. to the bottom of the
 * screen). These tests pin the forwarder's contract without mounting an
 * iframe: any Document + dispatch target works.
 */
describe("attachIframePointerActivityForwarder", () => {
  const makeDoc = () => document.implementation.createHTMLDocument("iframe-content");

  const dispatched = () => parentDispatch.mock.calls.map(([event]) => event as CustomEvent<IframePointerActivityDetail>);
  let parentDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    parentDispatch = vi.fn();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards iframe mousemove to the parent as pointer activity", () => {
    const doc = makeDoc();
    const parentWindow = { dispatchEvent: parentDispatch } as unknown as Window;
    attachIframePointerActivityForwarder(doc, parentWindow);

    doc.dispatchEvent(new MouseEvent("mousemove"));

    const events = dispatched();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe(IFRAME_POINTER_ACTIVITY_EVENT);
    expect(events[0].detail).toEqual({ kind: "pointer" });
  });

  it("forwards touchstart as touch activity, unthrottled", () => {
    const doc = makeDoc();
    const parentWindow = { dispatchEvent: parentDispatch } as unknown as Window;
    attachIframePointerActivityForwarder(doc, parentWindow);

    doc.dispatchEvent(new TouchEvent("touchstart"));
    doc.dispatchEvent(new TouchEvent("touchstart"));

    expect(dispatched().map((e) => e.detail.kind)).toEqual(["touch", "touch"]);
  });

  it("throttles pointer forwarding to display-frequency mousemoves", () => {
    const doc = makeDoc();
    const parentWindow = { dispatchEvent: parentDispatch } as unknown as Window;
    attachIframePointerActivityForwarder(doc, parentWindow);

    // A burst of pointer moves within the throttle window forwards once…
    for (let i = 0; i < 10; i++) doc.dispatchEvent(new MouseEvent("mousemove"));
    expect(dispatched()).toHaveLength(1);

    // …and a later move forwards again.
    vi.advanceTimersByTime(150);
    doc.dispatchEvent(new MouseEvent("mousemove"));
    expect(dispatched()).toHaveLength(2);
  });

  it("stops forwarding after detach", () => {
    const doc = makeDoc();
    const parentWindow = { dispatchEvent: parentDispatch } as unknown as Window;
    const detach = attachIframePointerActivityForwarder(doc, parentWindow);

    detach();
    doc.dispatchEvent(new MouseEvent("mousemove"));
    doc.dispatchEvent(new TouchEvent("touchstart"));

    expect(parentDispatch).not.toHaveBeenCalled();
  });

  it("keeps attachments independent (two iframes, two forwarders)", () => {
    const docA = makeDoc();
    const docB = makeDoc();
    const parentWindow = { dispatchEvent: parentDispatch } as unknown as Window;
    const detachA = attachIframePointerActivityForwarder(docA, parentWindow);
    attachIframePointerActivityForwarder(docB, parentWindow);

    detachA();
    docB.dispatchEvent(new MouseEvent("mousemove"));

    expect(dispatched()).toHaveLength(1);
  });
});
