/**
 * Assistant-resize → EPUB reflow (#17).
 *
 * The reader reflows when its container width changes (ResizeObserver →
 * requestAnimationFrame → debounce → `rendition.resize(undefined, undefined,
 * liveCfi)`). This suite verifies that path end-to-end with a controllable
 * ResizeObserver: continuous resize events coalesce into a single reflow,
 * the live reading location is preserved (no chapter jump), and reflow is
 * suppressed while the user is actively interacting, then re-armed once the
 * gesture settles.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EPUBViewer } from "../EPUBViewer";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mobileState = vi.hoisted(() => ({ isMobile: false }));
const contentState = vi.hoisted(() => ({ docs: [] as any[] }));
const themeState = vi.hoisted(() => ({
  theme: {
    id: "test",
    variant: "dark",
    colors: { primary: "#000", background: "#fff", text: "#000" },
  } as { id: string; variant: string; colors: Record<string, string> },
}));

const mockRendition = {
  display: vi.fn().mockResolvedValue(undefined),
  resize: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  currentLocation: vi.fn().mockReturnValue({ start: { cfi: "epubcfi(/6/4[chapter-2]!/4/2)" } }),
  themes: { register: vi.fn(), default: vi.fn(), select: vi.fn() },
  getContents: vi.fn(() => contentState.docs),
  hooks: { render: { register: vi.fn() }, content: { register: vi.fn() } },
  annotations: { highlight: vi.fn(), remove: vi.fn() },
};

const mockBook = {
  ready: Promise.resolve(),
  loaded: { navigation: Promise.resolve({ toc: [] }) },
  renderTo: vi.fn(() => mockRendition),
  spine: { length: 0, get: vi.fn() },
  locations: {
    generate: vi.fn().mockResolvedValue([]),
    percentageFromCfi: vi.fn().mockReturnValue(0),
  },
  destroy: vi.fn(),
};

vi.mock("epubjs", () => ({ default: vi.fn(() => mockBook) }));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: Object.assign(
    () => ({
      settings: {
        general: { language: "en" },
        documents: {
          epubSettings: { fontFamily: "serif", fontSize: 100, lineHeight: 1.5 },
        },
        interface: { volumeRockerScroll: "none" },
      },
    }),
    {
      getState: () => ({
        settings: {
          general: { language: "en" },
          documents: {
            epubSettings: { fontFamily: "serif", fontSize: 100, lineHeight: 1.5 },
          },
          interface: { volumeRockerScroll: "none" },
        },
      }),
      subscribe: vi.fn(),
    }
  ),
}));

vi.mock("../../../stores/vimModeStore", () => ({
  useVimModeStore: () => ({ mode: "normal" }),
}));

vi.mock("../../../stores/documentOutlineStore", () => ({
  useDocumentOutlineStore: () => ({ setOutline: vi.fn() }),
}));

vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: themeState.theme }),
}));

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => mobileState.isMobile,
}));

vi.mock("../../../api/documents", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../api/documents")>();
  return {
    ...original,
    getDocumentAuto: vi.fn().mockResolvedValue({}),
    updateDocumentProgressAuto: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("../../../api/position", () => ({
  saveDocumentPosition: vi.fn().mockResolvedValue({}),
  cfiPosition: vi.fn().mockResolvedValue({}),
}));

// Controllable ResizeObserver: captures each instance's callback so the test
// can fire a resize at an exact moment (the production mock in test/setup.ts
// is a no-op and the one in the sibling EPUBViewer suite auto-fires on
// observe, neither of which can drive the debounced reflow deterministically).
class ControllableResizeObserver {
  static instances: ControllableResizeObserver[] = [];
  callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
  constructor(callback: ControllableResizeObserver["callback"]) {
    this.callback = callback;
    ControllableResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function fireObserver(index: number) {
  const instance = ControllableResizeObserver.instances[index];
  if (!instance) throw new Error(`no ResizeObserver instance at index ${index}`);
  instance.callback([{ contentRect: { width: 400, height: 800 } }]);
}

async function renderLoadedReader() {
  ControllableResizeObserver.instances.length = 0;
  const utils = render(
    <EPUBViewer
      documentId="doc-epub"
      doc={{ id: "doc-epub", title: "Test EPUB" } as any}
      fileName="test.epub"
      fileUrl="mock-epub-path.epub"
    />
  );

  // Instance 0 is the container-visibility observer: firing it marks the
  // viewer as having size, which triggers the load effect.
  await act(async () => {
    fireObserver(0);
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    // Wait out the 500ms "initial display complete" arm so resize is allowed.
    await vi.advanceTimersByTimeAsync(1000);
  });

  // Instance 1 is the reflow ResizeObserver (created once `rendition` state
  // lands after load).
  expect(ControllableResizeObserver.instances.length).toBeGreaterThanOrEqual(2);
  expect(mockRendition.display).toHaveBeenCalled();
  return utils;
}

describe("EPUB reflow on container resize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mobileState.isMobile = false;
    contentState.docs = [];
    ControllableResizeObserver.instances.length = 0;
    globalThis.ResizeObserver = ControllableResizeObserver as unknown as typeof ResizeObserver;
    window.ResizeObserver = ControllableResizeObserver as unknown as typeof ResizeObserver;
    // The load path retries when the container reports no dimensions.
    HTMLDivElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 400,
      height: 800,
      top: 0,
      left: 0,
      bottom: 800,
      right: 400,
    });
  });

  it("reflows the rendition with the live location when the container resizes", async () => {
    await renderLoadedReader();
    mockRendition.resize.mockClear();

    await act(async () => {
      fireObserver(1);
      await vi.advanceTimersByTimeAsync(16); // rAF
      await vi.advanceTimersByTimeAsync(160); // 150ms debounce
    });

    const liveCfi = mockRendition.currentLocation().start.cfi;
    expect(mockRendition.resize).toHaveBeenCalledTimes(1);
    expect(mockRendition.resize).toHaveBeenCalledWith(undefined, undefined, liveCfi);
  });

  it("coalesces a rapid burst of resize events into a single reflow", async () => {
    await renderLoadedReader();
    mockRendition.resize.mockClear();

    await act(async () => {
      // A drag produces many intermediate widths — all must collapse into one.
      fireObserver(1);
      await vi.advanceTimersByTimeAsync(4);
      fireObserver(1);
      await vi.advanceTimersByTimeAsync(4);
      fireObserver(1);
      await vi.advanceTimersByTimeAsync(16);
      await vi.advanceTimersByTimeAsync(160);
    });

    expect(mockRendition.resize).toHaveBeenCalledTimes(1);
  });

  it("preserves the same logical location across repeated resizes (no chapter jump)", async () => {
    await renderLoadedReader();
    mockRendition.resize.mockClear();

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireObserver(1);
        await vi.advanceTimersByTimeAsync(16);
        await vi.advanceTimersByTimeAsync(160);
      });
    }

    const calls = mockRendition.resize.mock.calls.map((c) => c[2]);
    expect(calls).toHaveLength(3);
    // Every reflow anchors to the same live CFI — never a stale section start.
    expect(new Set(calls).size).toBe(1);
    expect(calls[0]).toBe(mockRendition.currentLocation().start.cfi);
  });

  it("suppresses reflow while the user is interacting, then re-arms once", async () => {
    const { container } = await renderLoadedReader();
    mockRendition.resize.mockClear();

    const viewer = container.querySelector('[data-epub-viewer="true"]') as HTMLElement;
    expect(viewer).not.toBeNull();

    // User is scrolling the reader: interaction suppresses a resize.
    await act(async () => {
      viewer.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true }));
      fireObserver(1);
      await vi.advanceTimersByTimeAsync(16);
      await vi.advanceTimersByTimeAsync(160);
    });
    expect(mockRendition.resize).not.toHaveBeenCalled();

    // Once the gesture settles (600ms quiet), a layout correction re-arms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(mockRendition.resize).toHaveBeenCalledTimes(1);
    expect(mockRendition.resize).toHaveBeenCalledWith(
      undefined,
      undefined,
      mockRendition.currentLocation().start.cfi,
    );
  });
});
