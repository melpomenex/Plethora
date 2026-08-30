import React from "react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { EPUBViewer, patchContentsInsertRuleGuard, patchThemesInsertRuleGuard, serializeEpubRules } from "../EPUBViewer";
import ePub from "epubjs";

// Guarantee unmount between tests so leaked components cannot re-register
// content hooks or re-apply stale palettes in later tests.
afterEach(() => {
  cleanup();
});

// Mutable shell flag: the real useMobileShell() returns a boolean — the mock
// must too, so tests can run explicit mobile/desktop cases instead of a
// truthy-object pseudo-mobile branch.
const mobileState = vi.hoisted(() => ({ isMobile: false }));

// Mutable list backing rendition.getContents() (production exposes it on the
// rendition itself, not under themes).
const contentState = vi.hoisted(() => ({ docs: [] as any[] }));

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
  },
  // Same location as production epub.js: rendition.getContents().
  getContents: vi.fn(() => contentState.docs),
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
  load: vi.fn(),
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
  useMobileShell: () => mobileState.isMobile,
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
    mobileState.isMobile = false;
    contentState.docs = [];
    (mockBook.spine as any).spineItems = [];
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
    mobileState.isMobile = true;
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

  it("extracts all linear spine sections for whole-book alignment", async () => {
    const sections = [
      {
        index: 0,
        href: "chapter-1.xhtml",
        linear: true,
        document: { body: { textContent: "First chapter text." } },
        load: vi.fn().mockResolvedValue(undefined),
      },
      {
        index: 1,
        href: "chapter-2.xhtml",
        linear: true,
        document: { body: { textContent: "Second chapter text." } },
        load: vi.fn().mockResolvedValue(undefined),
      },
      {
        index: 2,
        href: "nav.xhtml",
        linear: false,
        document: { body: { textContent: "Navigation" } },
        load: vi.fn().mockResolvedValue(undefined),
      },
    ];
    (mockBook.spine as any).spineItems = sections;
    const onAllSpeechSectionsChange = vi.fn();

    render(
      <EPUBViewer
        embedded
        documentId="doc-epub"
        doc={{ id: "doc-epub", title: "Test EPUB" } as any}
        fileName="test.epub"
        fileUrl="mock-epub-path.epub"
        onAllSpeechSectionsChange={onAllSpeechSectionsChange}
      />,
    );

    await waitFor(() => expect(onAllSpeechSectionsChange).toHaveBeenCalledWith([
      { spineIndex: 0, href: "chapter-1.xhtml", text: "First chapter text." },
      { spineIndex: 1, href: "chapter-2.xhtml", text: "Second chapter text." },
    ]));
    expect(sections[0].load).toHaveBeenCalled();
    expect(sections[1].load).toHaveBeenCalled();
    expect(sections[2].load).not.toHaveBeenCalled();
  });

  it("does not render the old mobile bottom toolbar when standalone", () => {
    mobileState.isMobile = true;
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

// Regression: epub.js's Contents.addStylesheetRules() calls
// this._getStylesheetNode(key).sheet.insertRule(...). On Android WebView a
// <style> element just appended to an iframe document can have `sheet`
// undefined synchronously, crashing the reader with "Cannot read properties
// of undefined (reading 'insertRule')" whenever the rendition theme is
// applied/updated. The guard patches the method to serialize rules to CSS
// text when no stylesheet object is available and to survive partial
// insertRule failures.
describe("epub.js insertRule crash guard", () => {
  const epubDoc = () =>
    new DOMParser().parseFromString("<html><head></head><body></body></html>", "text/html");

  it("serializes epub.js theme rules to CSS text", () => {
    const css = serializeEpubRules({
      html: { background: "#0d1926 !important", color: "#d4e8f8 !important" },
      body: { "font-size": "16px !important", "line-height": "1.5 !important" },
    });
    expect(css).toContain("html{background:#0d1926 !important;color:#d4e8f8 !important}");
    expect(css).toContain("body{font-size:16px !important;line-height:1.5 !important}");
  });

  it("falls back to serialized CSS when style.sheet is unavailable", () => {
    // A Contents-like class whose addStylesheetRules reproduces the Android
    // crash: it reads el.sheet (undefined here) and calls insertRule on it.
    class FakeContents {
      document: Document;
      constructor(doc: Document) {
        this.document = doc;
      }
      addStylesheetRules(rules: unknown, key?: string) {
        const el = this.document.getElementById(`epubjs-inserted-css-${key || ""}`) as HTMLStyleElement;
        (el as any).sheet.insertRule("html{}", 0);
      }
    }
    const doc = epubDoc();
    const contents = new FakeContents(doc);
    const styleEl = doc.createElement("style");
    styleEl.id = "epubjs-inserted-css-default";
    // Simulate the WebView returning no stylesheet object.
    Object.defineProperty(styleEl, "sheet", { value: undefined });
    doc.head!.appendChild(styleEl);

    patchContentsInsertRuleGuard(contents);

    expect(() =>
      (contents as any).addStylesheetRules({ html: { background: "#0d1926 !important" } }, "default")
    ).not.toThrow();
    expect(styleEl.textContent).toContain("html{background:#0d1926 !important}");
  });

  it("falls back to serialized CSS when insertRule throws partway", () => {
    class ThrowingContents {
      document: Document;
      constructor(doc: Document) {
        this.document = doc;
      }
      addStylesheetRules() {
        throw new Error("insertRule boom");
      }
    }
    const doc = epubDoc();
    const contents = new ThrowingContents(doc);

    patchContentsInsertRuleGuard(contents);
    (contents as any).addStylesheetRules({ body: { color: "#fff !important" } }, "default");

    const styleEl = doc.getElementById("epubjs-inserted-css-default") as HTMLStyleElement;
    expect(styleEl).not.toBeNull();
    expect(styleEl.textContent).toContain("body{color:#fff !important}");
  });

  it("installs the contents guard before the theme layer injects rules", () => {
    class FakeContents {
      document: Document;
      constructor(doc: Document) {
        this.document = doc;
      }
      addStylesheetRules() {
        throw new Error("must not be reached on a missing sheet");
      }
    }
    const themesProto = {
      add: vi.fn(function (this: unknown, name: string, contents: unknown) {
        (contents as any).addStylesheetRules({ html: { color: "#fff !important" } }, "default");
      }),
    };
    const addSpy = themesProto.add;
    const rendition = { themes: { constructor: { prototype: themesProto } } };
    patchThemesInsertRuleGuard(rendition);

    const doc = epubDoc();
    const contents = new FakeContents(doc);
    const styleEl = doc.createElement("style");
    styleEl.id = "epubjs-inserted-css-default";
    Object.defineProperty(styleEl, "sheet", { value: undefined });
    doc.head!.appendChild(styleEl);

    (themesProto.add as any)("default", contents);

    expect(addSpy).toHaveBeenCalledWith("default", contents);
    expect(styleEl.textContent).toContain("html{color:#fff !important}");
  });

  it("patches each Contents prototype only once", () => {
    class FakeContents {
      document: Document;
      constructor(doc: Document) {
        this.document = doc;
      }
    }
    const contents = new FakeContents(epubDoc());
    patchContentsInsertRuleGuard(contents);
    const first = (contents as any).constructor.prototype.addStylesheetRules;
    patchContentsInsertRuleGuard(contents);
    expect((contents as any).constructor.prototype.addStylesheetRules).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// EPUB reader theme layers (fix-mobile-epub-theme-regression).
//
// The success criterion is the ACTUAL content document's computed styles, not
// rendition.themes.default() arguments. These tests invoke the registered
// content hook against realistic EPUB-like DOM documents and assert all three
// theme layers: epub.js's own theme node ([id^="epubjs-inserted-css-"]),
// Plethora's #epub-override-styles, and the inline critical styles — plus the
// computed background/text colors.
// ---------------------------------------------------------------------------
describe("EPUB reader theme layers", () => {
  // Same fixtures as the EPUBViewer describe's beforeEach — each describe has
  // its own scope, so the shared prototype mocks must be installed here too.
  beforeEach(() => {
    vi.clearAllMocks();
    mockBook.ready = Promise.resolve();
    mobileState.isMobile = false;
    contentState.docs = [];
    HTMLDivElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 100,
      height: 100,
      top: 0,
      left: 0,
      bottom: 100,
      right: 100,
    });
  });

  const darkTheme = {
    id: "test-dark",
    variant: "dark",
    colors: {
      primary: "#38bdf8",
      background: "#0d1926",
      onBackground: "#d4e8f8",
      text: "#d4e8f8",
    },
  };
  const otherDarkTheme = {
    id: "other-dark",
    variant: "dark",
    colors: {
      primary: "#38bdf8",
      background: "#020b14",
      text: "#e0f2fe",
    },
  };

  // An EPUB-like content document with publisher stylesheet link/style nodes
  // and representative body content.
  function makeEpubDocument(): Document {
    return new DOMParser().parseFromString(
      `<!DOCTYPE html><html><head>
        <link rel="stylesheet" href="publisher.css">
        <style class="pub">.pub { color: red; }</style>
      </head><body><h1>Chapter</h1><p>Hello <a href="#">link</a></p>
      <img src="x.png"><table><tr><td>cell</td></tr></table></body></html>`,
      "text/html"
    );
  }

  function makeFakeContents(doc: Document, index = 0) {
    return {
      document: doc,
      // The real epub.js Contents exposes the iframe window; the jsdom global
      // window is a realistic stand-in (getComputedStyle included).
      window,
      section: { index },
      cfiFromRange: vi.fn(() => `epubcfi(/6/${index})`),
    };
  }

  async function renderViewer(opts: { mobile?: boolean; embedded?: boolean; theme?: unknown } = {}) {
    themeState.theme = (opts.theme ?? darkTheme) as any;
    mobileState.isMobile = opts.mobile ?? false;
    const view = render(
      <EPUBViewer
        embedded={opts.embedded ?? false}
        documentId="doc-epub"
        doc={{ id: "doc-epub", title: "Test EPUB" } as any}
        fileName="test.epub"
        fileUrl="mock-epub-path.epub"
      />
    );
    await waitFor(() => expect(mockRendition.themes.default).toHaveBeenCalled());
    const hook = mockRendition.hooks.content.register.mock.calls.at(-1)?.[0];
    expect(hook).toBeTypeOf("function");
    return { view, hook };
  }

  it("mobile dark theme: all three theme layers survive and compute dark", async () => {
    const { hook } = await renderViewer({ mobile: true });
    const doc = makeEpubDocument();
    // epub.js's Themes layer, as epub.js injects it before our content hook:
    const epubjsStyle = doc.createElement("style");
    epubjsStyle.id = "epubjs-inserted-css-default";
    epubjsStyle.textContent = "html{background:#0d1926 !important}";
    doc.head!.appendChild(epubjsStyle);
    const contents = makeFakeContents(doc);
    contentState.docs = [contents];

    await act(async () => {
      hook(contents);
    });

    // Layer 1: epub.js's own theme node must survive the publisher cleanup.
    expect(doc.getElementById("epubjs-inserted-css-default")).not.toBeNull();
    // Layer 2: Plethora's override style, carrying the dark palette.
    const override = doc.getElementById("epub-override-styles");
    expect(override).not.toBeNull();
    expect(override!.textContent).toContain("#0d1926");
    expect(override!.textContent).toContain("#d4e8f8");
    // Layer 3: inline critical styles on documentElement/body.
    // (jsdom normalizes hex values to rgb in getPropertyValue.)
    expect(doc.documentElement.style.getPropertyValue("background-color")).toBe("rgb(13, 25, 38)");
    expect(doc.body.style.getPropertyValue("color")).toBe("rgb(212, 232, 248)");
    expect(doc.body.style.getPropertyValue("font-family")).toContain("serif");
    expect(doc.body.style.getPropertyValue("font-size")).toBe("100px");
    expect(doc.body.style.getPropertyValue("line-height")).toBe("1.5");
    // Publisher styles are removed, epub.js theme node is not.
    expect(doc.querySelector('style.pub')).toBeNull();
    expect(doc.querySelector('link[rel="stylesheet"]')).toBeNull();
    // The content document's COMPUTED colors agree with the dark palette.
    expect(getComputedStyle(doc.documentElement).backgroundColor).toBe("rgb(13, 25, 38)");
    expect(getComputedStyle(doc.body).backgroundColor).toBe("rgb(13, 25, 38)");
    expect(getComputedStyle(doc.body).color).toBe("rgb(212, 232, 248)");
    // The readiness gate opens once the initial content is verified themed.
    await waitFor(() => {
      const viewer = document.querySelector('[data-epub-viewer="true"]') as HTMLElement;
      expect(viewer.style.opacity).toBe("1");
    });
  });

  it("desktop parity: identical dark theming with useMobileShell() === false", async () => {
    const { hook } = await renderViewer({ mobile: false });
    const doc = makeEpubDocument();
    const contents = makeFakeContents(doc);
    contentState.docs = [contents];

    await act(async () => {
      hook(contents);
    });

    expect(doc.getElementById("epub-override-styles")).not.toBeNull();
    expect(doc.documentElement.style.getPropertyValue("background-color")).toBe("rgb(13, 25, 38)");
    expect(getComputedStyle(doc.body).backgroundColor).toBe("rgb(13, 25, 38)");
    expect(getComputedStyle(doc.body).color).toBe("rgb(212, 232, 248)");
  });

  it("stale light CSS variables cannot override the dark Theme object", async () => {
    document.documentElement.style.setProperty("--color-background", "#ffffff");
    document.documentElement.style.setProperty("--color-foreground", "#000000");
    try {
      const { hook } = await renderViewer({ mobile: true });
      const doc = makeEpubDocument();
      const contents = makeFakeContents(doc);

      await act(async () => {
        hook(contents);
      });

      // The Theme object is authoritative: the content must compute dark even
      // though the parent document's variables still hold stale light values.
      expect(getComputedStyle(doc.documentElement).backgroundColor).toBe("rgb(13, 25, 38)");
      expect(getComputedStyle(doc.body).color).toBe("rgb(212, 232, 248)");
    } finally {
      document.documentElement.style.removeProperty("--color-background");
      document.documentElement.style.removeProperty("--color-foreground");
    }
  });

  it("installs the rendition theme before the first display()", async () => {
    // Manual order log: vi.fn invocationCallOrder is cumulative across mocks
    // and is not reset by clearAllMocks, so absolute order numbers are not
    // comparable inside a single test.
    const order: string[] = [];
    mockRendition.themes.default.mockImplementation(() => {
      order.push("default");
    });
    mockRendition.themes.select.mockImplementation(() => {
      order.push("select");
    });
    mockRendition.display.mockImplementation(() => {
      order.push("display");
      return Promise.resolve();
    });

    await renderViewer({ mobile: true });

    const defaultIdx = order.indexOf("default");
    const selectIdx = order.indexOf("select");
    const displayIdx = order.indexOf("display");
    expect(defaultIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThanOrEqual(0);
    expect(displayIdx).toBeGreaterThanOrEqual(0);
    expect(defaultIdx).toBeLessThan(displayIdx);
    expect(selectIdx).toBeLessThan(displayIdx);
  });

  it("re-styles mounted contents when the theme changes while open", async () => {
    const { hook, view } = await renderViewer({ mobile: true });
    const doc = makeEpubDocument();
    const contents = makeFakeContents(doc);
    contentState.docs = [contents];

    await act(async () => {
      hook(contents);
    });
    expect(getComputedStyle(doc.body).backgroundColor).toBe("rgb(13, 25, 38)");

    mockRendition.themes.default.mockClear();
    themeState.theme = otherDarkTheme as any;
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
    // The mounted content document is restyled to the new palette without
    // recreating the book/rendition.
    await waitFor(() => expect(getComputedStyle(doc.body).backgroundColor).toBe("rgb(2, 11, 20)"));
    expect(getComputedStyle(doc.body).color).toBe("rgb(224, 242, 254)");
    expect(mockBook.renderTo).toHaveBeenCalledTimes(1);
  });

  it("themes a newly mounted spine section with the active theme", async () => {
    const { hook } = await renderViewer({ mobile: true });
    const doc1 = makeEpubDocument();
    const doc2 = makeEpubDocument();
    const contents1 = makeFakeContents(doc1, 0);
    const contents2 = makeFakeContents(doc2, 1);
    contentState.docs = [contents1, contents2];

    await act(async () => {
      hook(contents1);
      hook(contents2);
    });

    for (const doc of [doc1, doc2]) {
      expect(doc.getElementById("epub-override-styles")).not.toBeNull();
      expect(doc.documentElement.style.getPropertyValue("background-color")).toBe("rgb(13, 25, 38)");
      expect(getComputedStyle(doc.body).backgroundColor).toBe("rgb(13, 25, 38)");
    }
  });

  it("light theme applies light colors on mobile", async () => {
    const lightTheme = {
      id: "test-light",
      variant: "light",
      colors: {
        primary: "#2563eb",
        background: "#ffffff",
        onBackground: "#1f2937",
        text: "#1f2937",
      },
    };
    const { hook } = await renderViewer({ mobile: true, theme: lightTheme });
    const doc = makeEpubDocument();
    const contents = makeFakeContents(doc);

    await act(async () => {
      hook(contents);
    });

    expect(getComputedStyle(doc.body).backgroundColor).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(doc.body).color).toBe("rgb(31, 41, 55)");
  });
});
