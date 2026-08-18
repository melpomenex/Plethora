import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EPUBViewer } from "../EPUBViewer";
import ePub from "epubjs";

// Mock epubjs
const mockRendition = {
  display: vi.fn().mockResolvedValue(undefined),
  resize: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  currentLocation: vi.fn().mockReturnValue({ start: { cfi: "epubcfi(/0)" } }),
  themes: {
    register: vi.fn(),
    default: vi.fn(),
    select: vi.fn(),
    getContents: vi.fn().mockReturnValue([]),
  },
  hooks: {
    render: { register: vi.fn() },
    content: { register: vi.fn() },
  },
  annotations: {
    highlight: vi.fn(),
    remove: vi.fn(),
  },
};

const mockBook = {
  ready: Promise.resolve(),
  loaded: {
    navigation: Promise.resolve({ toc: [] }),
  },
  renderTo: vi.fn(() => mockRendition),
  spine: {
    length: 0,
    get: vi.fn(),
  },
  locations: {
    generate: vi.fn().mockResolvedValue([]),
    percentageFromCfi: vi.fn().mockReturnValue(0),
  },
  destroy: vi.fn(),
};

vi.mock("epubjs", () => ({
  default: vi.fn(() => mockBook),
}));

// Mock stores
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
  useVimModeStore: () => ({
    mode: "normal",
  }),
}));

vi.mock("../../../stores/documentOutlineStore", () => ({
  useDocumentOutlineStore: () => ({
    setOutline: vi.fn(),
  }),
}));

// Mutable theme so theme-change tests can rerender with a new palette.
// Hoisted because the vi.mock factory runs before module scope.
const themeState = vi.hoisted(() => ({
  theme: {
    id: "test-dark",
    variant: "dark",
    colors: {
      primary: "#000",
      background: "#fff",
      text: "#000",
    },
  } as { id: string; variant: string; colors: Record<string, string> },
}));

// Mock contexts
vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: themeState.theme,
  }),
}));

// Mock hooks
vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => ({
    isMobile: false,
  }),
}));

// Mock APIs
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

global.ResizeObserver = class ResizeObserver {
  callback: any;
  constructor(callback: any) {
    this.callback = callback;
  }
  observe = vi.fn((element) => {
    setTimeout(() => {
      this.callback([
        {
          contentRect: { width: 100, height: 100 },
          target: element,
        },
      ]);
    }, 0);
  });
  unobserve = vi.fn();
  disconnect = vi.fn();
};

describe("EPUBViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBook.ready = Promise.resolve();
    HTMLDivElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 100,
      height: 100,
      top: 0,
      left: 0,
      bottom: 100,
      right: 100,
    });
  });

  it("keeps one set of top chrome controls when embedded", () => {
    render(
      <EPUBViewer
        embedded
        documentId="doc-epub"
        doc={{ id: "doc-epub", title: "Test EPUB" } as any}
        fileName="test.epub"
        fileUrl="mock-epub-path.epub"
      />
    );

    expect(screen.getAllByText("TOC")).toHaveLength(1);
    expect(screen.getAllByText("Aa")).toHaveLength(1);
  });

  it("forces streamed URLs to open as archived EPUBs", async () => {
    render(
      <EPUBViewer
        embedded
        documentId="doc-epub"
        doc={{ id: "doc-epub", title: "Test EPUB" } as any}
        fileName="test.epub"
        fileUrl="http://127.0.0.1:1234/epub/book.epub?path=%2Ftmp%2Fbook"
      />
    );

    await waitFor(() =>
      expect(ePub).toHaveBeenCalledWith(
        "http://127.0.0.1:1234/epub/book.epub?path=%2Ftmp%2Fbook",
        { openAs: "epub" },
      ),
    );
  });

  it("does not render the old mobile bottom toolbar when standalone", () => {
    render(
      <EPUBViewer
        documentId="doc-epub"
        doc={{ id: "doc-epub", title: "Test EPUB" } as any}
        fileName="test.epub"
        fileUrl="mock-epub-path.epub"
      />
    );

    expect(screen.getAllByText("TOC")).toHaveLength(1);
    expect(screen.getAllByText("Aa")).toHaveLength(1);
  });

  it("defers book destruction when unmounted before epub.js finishes loading", async () => {
    let resolveReady!: () => void;
    mockBook.ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    const { unmount } = render(
      <EPUBViewer
        embedded
        documentId="doc-epub"
        doc={{ id: "doc-epub", title: "Test EPUB" } as any}
        fileName="test.epub"
        fileUrl="mock-epub-path.epub"
      />
    );

    await waitFor(() => expect(ePub).toHaveBeenCalled());
    unmount();

    expect(mockBook.destroy).not.toHaveBeenCalled();

    resolveReady();
    await waitFor(() => expect(mockBook.destroy).toHaveBeenCalledTimes(1));
  });

  it("renders EPUB highlights using the shared translucent palette via epub.js annotations", async () => {
    const persistedHighlights = [
      {
        id: "hl-1",
        cfiRange: "epubcfi(/6/4[chap-2]!/4/2/10/1:0)",
        color: null, // Should resolve to default yellow translucent
        text: "yellow text",
      },
      {
        id: "hl-2",
        cfiRange: "epubcfi(/6/4[chap-2]!/4/2/10/2:0)",
        color: "green", // Should resolve to green translucent
        text: "green text",
      },
      {
        id: "hl-3",
        cfiRange: "epubcfi(/6/4[chap-2]!/4/2/10/3:0)",
        color: "#bfdbfe", // Should resolve to blue translucent hex alias
        text: "blue text",
      },
    ];

    const mockDoc = {
      id: "doc-epub",
      title: "Test EPUB",
      fileType: "epub",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Render EPUBViewer, letting it initialize the mock book and rendition
    render(
      <EPUBViewer
        documentId="doc-epub"
        doc={mockDoc as any}
        fileName="test.epub"
        fileUrl="mock-epub-path.epub"
        persistedHighlights={persistedHighlights}
      />
    );

    // Wait for the rendition and highlight calls to be executed
    await waitFor(() => {
      expect(mockRendition.annotations.highlight).toHaveBeenCalled();
    });

    // Check yellow highlight call
    expect(mockRendition.annotations.highlight).toHaveBeenCalledWith(
      "epubcfi(/6/4[chap-2]!/4/2/10/1:0)",
      {},
      undefined,
      "epub-persisted-highlight",
      {
        fill: "rgba(245, 158, 11, 0.20)",
        "fill-opacity": "1",
      }
    );

    // Check green highlight call
    expect(mockRendition.annotations.highlight).toHaveBeenCalledWith(
      "epubcfi(/6/4[chap-2]!/4/2/10/2:0)",
      {},
      undefined,
      "epub-persisted-highlight",
      {
        fill: "rgba(34, 197, 94, 0.20)",
        "fill-opacity": "1",
      }
    );

    // Check blue (hex alias #bfdbfe) highlight call
    expect(mockRendition.annotations.highlight).toHaveBeenCalledWith(
      "epubcfi(/6/4[chap-2]!/4/2/10/3:0)",
      {},
      undefined,
      "epub-persisted-highlight",
      {
        fill: "rgba(59, 130, 246, 0.20)",
        "fill-opacity": "1",
      }
    );
  });

  // Regression: the reader must resolve its palette from the active theme
  // object, not from live documentElement CSS variables. On a theme change
  // the viewer's re-apply effect runs BEFORE ThemeContext's parent effect
  // writes the new variables, so the computed values are one theme behind —
  // reading them baked the PREVIOUS theme into the iframe and the reader
  // stayed stuck on it (white reader under a dark app theme).
  it("themes the rendition from the theme object even when CSS variables still hold stale values", async () => {
    document.documentElement.style.setProperty("--color-background", "#ffffff");
    document.documentElement.style.setProperty("--color-foreground", "#000000");
    themeState.theme = {
      id: "test-dark",
      variant: "dark",
      colors: {
        primary: "#38bdf8",
        background: "#0d1926",
        onBackground: "#d4e8f8",
        text: "#d4e8f8",
      },
    };

    render(
      <EPUBViewer
        embedded
        documentId="doc-epub"
        doc={{ id: "doc-epub", title: "Test EPUB" } as any}
        fileName="test.epub"
        fileUrl="mock-epub-path.epub"
      />
    );

    await waitFor(() => expect(mockRendition.themes.default).toHaveBeenCalled());
    const call = mockRendition.themes.default.mock.calls.at(-1)[0];
    expect(call.html.background).toContain("#0d1926");
    expect(call.html.color).toContain("#d4e8f8");

    document.documentElement.style.removeProperty("--color-background");
    document.documentElement.style.removeProperty("--color-foreground");
  });

  it("re-applies the rendition theme when the app theme changes while a book is open", async () => {
    themeState.theme = {
      id: "test-dark",
      variant: "dark",
      colors: { primary: "#38bdf8", background: "#0d1926", text: "#d4e8f8" },
    };

    const view = render(
      <EPUBViewer
        embedded
        documentId="doc-epub"
        doc={{ id: "doc-epub", title: "Test EPUB" } as any}
        fileName="test.epub"
        fileUrl="mock-epub-path.epub"
      />
    );

    await waitFor(() => expect(mockRendition.themes.default).toHaveBeenCalled());
    mockRendition.themes.default.mockClear();

    themeState.theme = {
      id: "other-dark",
      variant: "dark",
      colors: { primary: "#38bdf8", background: "#020b14", text: "#e0f2fe" },
    };
    view.rerender(
      <EPUBViewer
        embedded
        documentId="doc-epub"
        doc={{ id: "doc-epub", title: "Test EPUB" } as any}
        fileName="test.epub"
        fileUrl="mock-epub-path.epub"
      />
    );

    await waitFor(() => expect(mockRendition.themes.default).toHaveBeenCalled());
    const call = mockRendition.themes.default.mock.calls.at(-1)[0];
    expect(call.html.background).toContain("#020b14");
    expect(call.html.color).toContain("#e0f2fe");
  });
});
