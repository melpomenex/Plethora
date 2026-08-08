/**
 * DOM shims for render-cost benchmarks (`*.bench.tsx`).
 *
 * This is deliberately neither of the other two setup files:
 *
 * - `src/test/setup.ts` (the jsdom unit-test setup) installs jest-dom matchers,
 *   an `afterEach` cleanup, Tauri/PDF module mocks and layout stubs. Loading it
 *   from a benchmark would add per-file startup cost and per-iteration spy
 *   bookkeeping to something whose entire purpose is stable timing.
 * - `src/test/bench-setup.ts` is the *global* bench setup and runs for every
 *   benchmark file, including the Node ones. Nothing DOM-shaped may go there.
 *
 * So this module is imported explicitly, at the top of each `.bench.tsx` file,
 * after that file's `// @vitest-environment jsdom` docblock. It installs only
 * what a React render needs from a browser and that jsdom does not provide, as
 * plain no-op functions rather than `vi.fn()` spies — a spy records every call,
 * which is measurement noise in a benchmark loop.
 */

interface MinimalMediaQueryList {
  matches: boolean;
  media: string;
  onchange: null;
  addListener: () => void;
  removeListener: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  dispatchEvent: () => boolean;
}

function noop(): void {}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MinimalMediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
    }),
  });
}

class BenchResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class BenchIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = BenchResizeObserver;
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    BenchIntersectionObserver;
}

// jsdom does not implement scrollIntoView; a component that auto-scrolls would
// otherwise throw mid-measurement.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = noop;
}
