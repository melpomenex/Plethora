/**
 * Vitest setup file
 * Runs before each test file
 */

import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { vi } from "vitest";

// Node.js v25+ ships a native `localStorage`/`sessionStorage` global whose
// backing object lacks the Storage prototype — `.setItem`/`.getItem`/`.clear`
// are all `undefined`, so every test that touches storage fails. jsdom provides
// a working `Storage` constructor + prototype, but Node's broken instance
// shadows it and jsdom's `populateGlobal` cannot overwrite a non-configurable
// Node global. Replace `Storage.prototype`'s methods with spec-conformant
// implementations backed by an instance-local Map, then install fresh instances
// (inheriting from that prototype) over Node's broken globals. Keeping the
// methods on the prototype (not as own props) ensures `vi.spyOn(Storage.prototype,
// "setItem")` continues to intercept writes.
// See https://github.com/vitest-dev/vitest/issues/8757
const backing = Symbol("backing");
interface ShimStorage extends Storage {
  [backing]: Map<string, string>;
}
Object.defineProperties(Storage.prototype, {
  length: { configurable: true, get() { return (this as ShimStorage)[backing].size; } },
  clear: { configurable: true, value() { (this as ShimStorage)[backing].clear(); } },
  getItem: {
    configurable: true,
    value(key: string) {
      const m = (this as ShimStorage)[backing];
      return m.has(key) ? m.get(key)! : null;
    },
  },
  key: {
    configurable: true,
    value(index: number) {
      return Array.from((this as ShimStorage)[backing].keys())[index] ?? null;
    },
  },
  removeItem: { configurable: true, value(key: string) { (this as ShimStorage)[backing].delete(key); } },
  setItem: {
    configurable: true,
    value(key: string, value: string) {
      (this as ShimStorage)[backing].set(key, String(value));
    },
  },
});
function createStorage(): Storage {
  const store = Object.create(Storage.prototype) as ShimStorage;
  store[backing] = new Map<string, string>();
  return store;
}
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: createStorage(),
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: createStorage(),
});

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Tauri API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => path),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve({ unregister: vi.fn() })),
}));

// Mock PDF.js for test environment to avoid DOMMatrix dependency.
class MockPDFDataRangeTransport {
  private rangeListeners: Array<(begin: number, chunk: Uint8Array) => void> = [];
  constructor(
    public length: number,
    public initialData: Uint8Array | null,
    public progressiveDone = false,
  ) {}
  addRangeListener(listener: (begin: number, chunk: Uint8Array) => void) { this.rangeListeners.push(listener); }
  onDataRange(begin: number, chunk: Uint8Array) { this.rangeListeners.forEach((listener) => listener(begin, chunk)); }
  onDataProgress() {}
  transportReady() {}
  abort() {}
}

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  PDFDataRangeTransport: MockPDFDataRangeTransport,
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 0,
      getPage: vi.fn(),
    }),
  })),
}));

vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  EventBus: vi.fn(),
  PDFPageView: vi.fn(),
  AbortException: class AbortException extends Error {},
}));

// Mock window.__TAURI__ for Tauri 2.0
Object.defineProperty(window, "__TAURI__", {
  value: {
    core: {
      invoke: vi.fn(),
    },
    event: {
      emit: vi.fn(),
      listen: vi.fn(() => Promise.resolve({ unregister: vi.fn() })),
    },
  },
  writable: true,
});

// Mock matchMedia for components relying on PWA/media queries.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom does not implement Element.scrollIntoView. Provide a no-op so
// components that auto-scroll on mount/update (e.g. chat message lists) don't
// throw under test.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// jsdom performs no real layout: every element reports 0 for
// offsetWidth/offsetHeight, and there is no ResizeObserver.
// @tanstack/react-virtual (used by the Documents view's virtualized list/
// compact rows) treats a 0-height scroll container as "nothing is visible
// yet" and renders zero rows (see calculateRange's `outerSize > 0` guard) —
// so without this, any test that renders a virtualized list finds no rows at
// all, even though real browsers measure a real, non-zero container. Stub a
// fixed viewport-sized rect so virtualized components measure like they
// would on an actual screen.
if (typeof ResizeObserver === "undefined") {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = MockResizeObserver;
  global.ResizeObserver = MockResizeObserver;
}
if (typeof HTMLElement !== "undefined") {
  const STUB_HEIGHT = 800;
  const STUB_WIDTH = 1024;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() { return STUB_HEIGHT; },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() { return STUB_WIDTH; },
  });
}

// Suppress console errors in tests (optional, for cleaner output)
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("Warning: ReactDOM.render")
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
