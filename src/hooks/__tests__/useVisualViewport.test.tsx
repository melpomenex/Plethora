import { act, render } from "../../test/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisualViewport } from "../useVisualViewport";

function Harness() {
  useVisualViewport();
  return null;
}

describe("useVisualViewport", () => {
  const listeners = new Map<string, EventListener>();

  beforeEach(() => {
    listeners.clear();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 844,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: 844,
        offsetTop: 0,
        addEventListener: vi.fn((name: string, listener: EventListener) =>
          listeners.set(name, listener),
        ),
        removeEventListener: vi.fn(),
      },
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes keyboard-aware viewport variables and cleans them up", () => {
    const { unmount } = render(<Harness />);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--app-viewport-height")).toBe("844px");
    expect(root.style.getPropertyValue("--app-keyboard-height")).toBe("0px");

    Object.assign(window.visualViewport!, { height: 520, offsetTop: 12 });
    act(() => listeners.get("resize")?.(new Event("resize")));

    expect(root.style.getPropertyValue("--app-viewport-height")).toBe("520px");
    expect(root.style.getPropertyValue("--app-viewport-offset-top")).toBe("12px");
    expect(root.style.getPropertyValue("--app-keyboard-height")).toBe("312px");

    unmount();
    expect(root.style.getPropertyValue("--app-viewport-height")).toBe("");
  });
});
