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

// jsdom does not implement DOMMatrix, but the real pdf.js build constructs one
// at module scope (`const SCALE_MATRIX = new DOMMatrix()`). Provide a
// functional-enough stub so tests that load the real engine
// (pdfRangeSourceBehavior.test.ts) can run; the rest of the suite uses the
// pdfjs mock above and never touches this.
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrixStub {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;
    constructor(init?: string | number[]) {
      if (typeof init === "string") {
        const parts = init.split(/[ ,]+/).map(Number);
        if (parts.length === 6) this._set(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
      } else if (Array.isArray(init) && init.length === 6) {
        this._set(init[0], init[1], init[2], init[3], init[4], init[5]);
      }
    }
    _set(a: number, b: number, c: number, d: number, e: number, f: number) {
      this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
      this.m11 = a; this.m12 = b; this.m21 = c; this.m22 = d; this.m41 = e; this.m42 = f;
      this.isIdentity = a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0;
    }
    multiply(other: DOMMatrixStub) { return this._compose(other); }
    multiplySelf(other: DOMMatrixStub) { const r = this._compose(other); this._set(r.a, r.b, r.c, r.d, r.e, r.f); return this; }
    preMultiplySelf(other: DOMMatrixStub) { const r = other._compose(this); this._set(r.a, r.b, r.c, r.d, r.e, r.f); return this; }
    translate(tx = 0, ty = 0) { return this._compose(new DOMMatrixStub([1, 0, 0, 1, tx, ty])); }
    translateSelf(tx = 0, ty = 0) { this.e += tx; this.f += ty; this._set(this.a, this.b, this.c, this.d, this.e, this.f); return this; }
    scale(sx = 1, sy = 1) { return this._compose(new DOMMatrixStub([sx, 0, 0, sy, 0, 0])); }
    scaleSelf(sx = 1, sy = 1) { this.a *= sx; this.b *= sx; this.c *= sy; this.d *= sy; this._set(this.a, this.b, this.c, this.d, this.e, this.f); return this; }
    inverse() { const det = this.a * this.d - this.b * this.c; if (det === 0) return new DOMMatrixStub(); return new DOMMatrixStub([this.d / det, -this.b / det, -this.c / det, this.a / det, (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det]); }
    _compose(other: DOMMatrixStub) {
      return new DOMMatrixStub([
        this.a * other.a + this.c * other.b,
        this.b * other.a + this.d * other.b,
        this.a * other.c + this.c * other.d,
        this.b * other.c + this.d * other.d,
        this.a * other.e + this.c * other.f + this.e,
        this.b * other.e + this.d * other.f + this.f,
      ]);
    }
  }
  Object.defineProperty(globalThis, "DOMMatrix", {
    value: DOMMatrixStub,
    configurable: true,
    writable: true,
  });
}

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

// ──────────────────────────────────────────────────────────────────────────
// Media Session / Web Audio mocks (openspec add-audio-editions-and-hands-
// free-study-mode, task 11.3). jsdom ships neither; the player-integration
// and feedback tests rely on them existing.
// ──────────────────────────────────────────────────────────────────────────
if (typeof navigator !== "undefined" && !("mediaSession" in navigator)) {
  const mediaSessionHandlers = new Map<string, ((details?: unknown) => void) | null>();
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: {
      metadata: null,
      playbackState: "none",
      setActionHandler(action: string, handler: ((details?: unknown) => void) | null) {
        if (handler === null) mediaSessionHandlers.delete(action);
        else mediaSessionHandlers.set(action, handler);
      },
      setPositionState(_state: unknown) {
        /* no-op */
      },
      __handlers: mediaSessionHandlers,
    },
  });
}

if (typeof window !== "undefined" && typeof window.MediaMetadata === "undefined") {
  Object.defineProperty(window, "MediaMetadata", {
    configurable: true,
    value: class MediaMetadata {
      title: string;
      artist: string;
      album: string;
      artwork: Array<{ src: string; sizes: string; type: string }>;
      constructor(init?: { title?: string; artist?: string; album?: string; artwork?: Array<{ src: string; sizes: string; type: string }> }) {
        this.title = init?.title ?? "";
        this.artist = init?.artist ?? "";
        this.album = init?.album ?? "";
        this.artwork = init?.artwork ?? [];
      }
    },
  });
}

if (typeof window !== "undefined" && typeof window.AudioContext === "undefined") {
  // Minimal AudioContext stub: gain/oscillator graph nodes with recorder-style
  // setters so chime code paths run without a real audio backend.
  const makeParam = () => ({
    value: 0,
    setValueAtTime: () => {},
    linearRampToValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  });
  class FakeGainNode {
    gain = makeParam();
    connect() {}
    disconnect() {}
  }
  class FakeOscillatorNode {
    frequency = makeParam();
    type = "sine";
    connect() {}
    start() {}
    stop() {}
  }
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    writable: true,
    value: class AudioContext {
      state = "running";
      currentTime = 0;
      destination = {};
      createGain() { return new FakeGainNode(); }
      createOscillator() { return new FakeOscillatorNode(); }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    },
  });
}
