import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { ThemeBackdrop } from "../ThemeBackdrop";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

let mockTheme: { effects?: { backgroundAnimation?: string; ambientPaletteId?: string } };

vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: mockTheme }),
}));

vi.mock("../../../contexts/BatteryContext", () => ({
  useBattery: () => ({ onBattery: false, battery: null }),
}));

const interfaceState = {
  animationsEnabled: true,
  animationFrequency: 1,
  animationBrightness: 12,
};

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: { settings: { interface: typeof interfaceState } }) => unknown) =>
    selector({ settings: { interface: interfaceState } }),
}));

vi.mock("../../../lib/tauri", () => ({
  isNativeMobile: () => false,
}));

/* ------------------------------------------------------------------ */
/*  Canvas stubs                                                       */
/* ------------------------------------------------------------------ */

const gradient = { addColorStop: () => {} };
const makeCtx = () =>
  ({
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    drawImage: () => {},
    putImageData: () => {},
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4),
      width: w,
      height: h,
    }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    fillText: () => {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  }) as unknown as CanvasRenderingContext2D;

let rafScheduled: number;
let cancelled: number[];

beforeEach(() => {
  rafScheduled = 0;
  cancelled = [];
  mockTheme = {};
  interfaceState.animationsEnabled = true;
  interfaceState.animationFrequency = 1;
  interfaceState.animationBrightness = 12;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(makeCtx() as never);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((() => {
    rafScheduled++;
    return rafScheduled;
  }) as never);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(((id: number) => {
    cancelled.push(id);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("ThemeBackdrop", () => {
  it("renders a host with a canvas for an animated canvas2d effect", () => {
    mockTheme = { effects: { backgroundAnimation: "rain" } };
    const { container } = render(<ThemeBackdrop />);
    const host = container.querySelector(".theme-backdrop");
    expect(host).not.toBeNull();
    expect(host?.getAttribute("aria-hidden")).toBe("true");
    expect(host?.querySelector("canvas.theme-backdrop-canvas")).not.toBeNull();
  });

  it("renders nothing when the theme has no animation", () => {
    mockTheme = { effects: {} };
    const { container } = render(<ThemeBackdrop />);
    expect(container.querySelector(".theme-backdrop")).toBeNull();
  });

  it("renders nothing for CSS-only effects like liquid-glow", () => {
    mockTheme = { effects: { backgroundAnimation: "liquid-glow" } };
    const { container } = render(<ThemeBackdrop />);
    expect(container.querySelector(".theme-backdrop")).toBeNull();
  });

  it("renders nothing for static-incapable effects when animations are disabled", () => {
    mockTheme = { effects: { backgroundAnimation: "rain" } };
    interfaceState.animationsEnabled = false;
    const { container } = render(<ThemeBackdrop />);
    expect(container.querySelector(".theme-backdrop")).toBeNull();
  });

  it("mounts a static jellyfish frame without scheduling RAF when disabled", () => {
    mockTheme = { effects: { backgroundAnimation: "jellyfish", ambientPaletteId: "deep-ocean-glow" } };
    interfaceState.animationsEnabled = false;
    const { container } = render(<ThemeBackdrop />);
    expect(container.querySelector("canvas.theme-backdrop-canvas")).not.toBeNull();
    expect(rafScheduled).toBe(0);
  });

  it("cancels pending RAF on unmount", () => {
    mockTheme = { effects: { backgroundAnimation: "rain" } };
    const { unmount } = render(<ThemeBackdrop />);
    expect(rafScheduled).toBeGreaterThan(0);
    unmount();
    expect(cancelled.length).toBeGreaterThan(0);
  });

  it("re-creates the renderer on theme switch without leaking canvases", () => {
    mockTheme = { effects: { backgroundAnimation: "rain" } };
    const { rerender, container } = render(<ThemeBackdrop />);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    mockTheme = { effects: { backgroundAnimation: "snowfall" } };
    rerender(<ThemeBackdrop />);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
  });
});

describe("ThemeBackdrop visibility suspension", () => {
  it("keeps the frozen canvas mounted when the document is hidden (B2)", async () => {
    mockTheme = { effects: { backgroundAnimation: "rain" } };
    const { container } = render(<ThemeBackdrop />);
    const canvas = container.querySelector("canvas.theme-backdrop-canvas");
    expect(canvas).not.toBeNull();
    const scheduledDuringVisible = rafScheduled;

    await act(async () => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // The canvas must remain in the DOM with its frozen frame.
    expect(container.querySelector("canvas.theme-backdrop-canvas")).toBe(canvas);

    await act(async () => {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Resume re-invokes the effect → new rAF ids were scheduled.
    expect(rafScheduled).toBeGreaterThan(scheduledDuringVisible);
    expect(container.querySelector("canvas.theme-backdrop-canvas")).toBe(canvas);
  });
});
