import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { EPUBViewer } from "../EPUBViewer";
import ePub from "epubjs";

// Mock epubjs
const mockRendition = {
  display: vi.fn().mockResolvedValue(undefined),
  resize: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
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

// Mock contexts
vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: {
      colors: {
        primary: "#000",
        background: "#fff",
        text: "#000",
      },
    },
  }),
}));

// Mock hooks
vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => ({
    isMobile: false,
  }),
}));

// Mock APIs
vi.mock("../../../api/documents", () => ({
  getDocumentAuto: vi.fn().mockResolvedValue({}),
  updateDocumentProgressAuto: vi.fn().mockResolvedValue({}),
}));

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
    HTMLDivElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 100,
      height: 100,
      top: 0,
      left: 0,
      bottom: 100,
      right: 100,
    });
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
});
