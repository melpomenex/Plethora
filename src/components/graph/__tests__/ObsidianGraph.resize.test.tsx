import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "../../../test/utils";

vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      colors: {
        background: "#ffffff",
        border: "#dddddd",
        onBackground: "#111111",
        textSecondary: "#666666",
      },
      typography: { fontFamily: "sans-serif" },
    },
  }),
}));

import { ObsidianGraph } from "../ObsidianGraph";

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observed: Element[] = [];
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  MockResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ObsidianGraph container resize", () => {
  it("resizes the canvas backing store when the container changes without re-fitting the view", async () => {
    const { container } = render(<ObsidianGraph data={{ nodes: [], edges: [] }} />);
    const root = container.firstElementChild as HTMLElement;
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    const observers = MockResizeObserver.instances.filter((observer) => observer.observed.includes(root));
    expect(observers.length).toBeGreaterThanOrEqual(1);
    expect(observers[observers.length - 1].observed).toContain(root);

    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      width: 420,
      height: 320,
      top: 0,
      left: 0,
      right: 420,
      bottom: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    observers[observers.length - 1].trigger();

    await waitFor(() => {
      expect(canvas.width).toBe(420);
      expect(canvas.height).toBe(320);
    });

    // The resize path must not call fitToView: expanding the canvas should
    // reveal more of the current pan/zoom rather than reset it. This is a
    // source-level guard because the transform lives inside the draw closure.
    const source = readFileSync(
      path.resolve(__dirname, "../ObsidianGraph.tsx"),
      "utf8",
    );
    const resizeEffect = source.slice(
      source.indexOf("const resize = () => {"),
      source.indexOf("}, [draw]);", source.indexOf("const resize = () => {")),
    );
    expect(resizeEffect).not.toContain("fitToView(");
    expect(resizeEffect).toContain("canvasSizeRef.current");
  });
});
