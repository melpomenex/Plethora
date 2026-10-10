import { describe, expect, it, vi } from "vitest";
import { ReaderNavigationOwner, observeReaderInput } from "../../../lib/readerNavigation";

describe("reader navigation authority", () => {
  it("initial restoration is one-time; settling cannot re-enable it", () => {
    const owner = new ReaderNavigationOwner();
    expect(owner.state).toBe("initial-restoration");
    expect(owner.canRestore).toBe(true);
    expect(owner.settle(owner.ticket)).toBe(true);
    expect(owner.state).toBe("idle");
    expect(owner.canRestore).toBe(false);
  });
  it("latest TOC wins and manual input permanently interrupts corrections", () => {
    const owner = new ReaderNavigationOwner();
    const old = owner.beginToc();
    const latest = owner.beginToc();
    expect(owner.owns(old)).toBe(false);
    expect(owner.settle(old)).toBe(false);
    expect(owner.owns(latest)).toBe(true);
    owner.userScroll();
    expect(owner.owns(latest)).toBe(false);
    expect(owner.state).toBe("user-scroll");
    expect(owner.canRestore).toBe(false);
    const fresh = owner.beginToc();
    expect(owner.settle(fresh)).toBe(true);
  });
  it("recognizes input inside an iframe document and removes listeners", () => {
    const frameDoc = document.implementation.createHTMLDocument();
    const interrupt = vi.fn();
    const stop = observeReaderInput(frameDoc, interrupt);
    frameDoc.dispatchEvent(new Event("touchstart"));
    frameDoc.dispatchEvent(new Event("touchmove"));
    frameDoc.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp" }));
    expect(interrupt).toHaveBeenCalledTimes(3);
    stop();
    frameDoc.dispatchEvent(new Event("touchstart"));
    expect(interrupt).toHaveBeenCalledTimes(3);
  });
});
