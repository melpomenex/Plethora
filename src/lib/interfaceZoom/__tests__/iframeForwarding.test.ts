import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shortcuts", () => ({
  handleInterfaceZoomKeyDown: vi.fn(),
}));

import {
  attachInterfaceZoomToIframe,
  attachInterfaceZoomToWindow,
} from "../iframeForwarding";

function mockWindow() {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Window & {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("attachInterfaceZoomToWindow", () => {
  it("attaches exactly one capture listener when called repeatedly", () => {
    const win = mockWindow();

    const detachFirst = attachInterfaceZoomToWindow(win);
    const detachSecond = attachInterfaceZoomToWindow(win);
    // Simulates an EPUB `rendered` event firing twice for the same window.
    attachInterfaceZoomToWindow(win);

    expect(win.addEventListener).toHaveBeenCalledTimes(1);
    expect(win.addEventListener).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
      true,
    );

    detachSecond();
    detachFirst();
    expect(win.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh attachment after detaching", () => {
    const win = mockWindow();
    const detach = attachInterfaceZoomToWindow(win);
    detach();

    attachInterfaceZoomToWindow(win);
    expect(win.addEventListener).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for a missing window", () => {
    expect(() => attachInterfaceZoomToWindow(null)()).not.toThrow();
  });
});

describe("attachInterfaceZoomToIframe", () => {
  it("attaches to the iframe contentWindow once", () => {
    const win = mockWindow();
    const frame = { contentWindow: win } as unknown as HTMLIFrameElement;

    attachInterfaceZoomToIframe(frame);
    attachInterfaceZoomToIframe(frame);

    expect(win.addEventListener).toHaveBeenCalledTimes(1);
  });

  it("treats a cross-origin frame as a no-op", () => {
    const frame = {
      get contentWindow(): Window {
        throw new Error("cross-origin");
      },
    } as unknown as HTMLIFrameElement;

    expect(() => attachInterfaceZoomToIframe(frame)()).not.toThrow();
  });

  it("treats a missing iframe as a no-op", () => {
    expect(() => attachInterfaceZoomToIframe(null)()).not.toThrow();
  });
});
