/**
 * Canonical reflow view tests (section 4): renderer structure, word-span
 * selection mapping (task 4.3), word-level anchors (4.5), and marginal-role
 * suppression.
 */
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PdfCanonicalReflowRenderer } from "../PdfCanonicalReflowRenderer";
import { canonicalReflowSelectionFromRange } from "../pdfCanonicalReflowSelection";
import { anchorFromCanonicalBlock, resolveCanonicalAnchor } from "../pdfAnchorResolver";
import type { PdfCanonicalBlock, PdfCanonicalPage } from "../../../types/pdfCanonical";
import type { PdfSourceAnchorState } from "../../../types/readerPosition";

function word(id: string, text: string, x0: number, x1: number, order: number) {
  return {
    id,
    pageNumber: 1,
    text,
    sourceBbox: { x0, y0: 700, x1, y1: 710 },
    sourceFragments: [],
    bboxExact: true,
    readingOrder: order,
    confidence: 1,
    source: "native-pdf-text" as const,
    dehyphenated: false,
    font: null,
  };
}

function page(): PdfCanonicalPage {
  return {
    pageNumber: 1,
    width: 612,
    height: 792,
    rotation: 0,
    state: "ready",
    classification: "semantic",
    confidence: 0.95,
    textCoverage: 1,
    words: [
      word("p1:w0", "The", 100, 120, 0),
      word("p1:w1", "quick", 122, 152, 1),
      word("p1:w2", "brown", 154, 186, 2),
    ],
    lines: [
      {
        id: "p1:l0",
        wordIds: ["p1:w0", "p1:w1", "p1:w2"],
        bbox: { x0: 100, y0: 700, x1: 186, y1: 710 },
        baselineY: 700,
        readingOrder: 0,
      },
    ],
    blocks: [
      {
        id: "p1:b0",
        kind: "paragraph",
        role: "body",
        pageNumber: 1,
        sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 700, x1: 186, y1: 710 } }],
        wordIds: ["p1:w0", "p1:w1", "p1:w2"],
        lineIds: ["p1:l0"],
        readingOrder: 0,
        confidence: 0.95,
        text: "The quick brown",
        direction: "ltr",
        language: null,
        items: null,
        table: null,
        assetId: null,
        altText: null,
        captionOf: null,
        href: null,
        extraction: "native-pdf-text",
      },
      {
        id: "p1:b1",
        kind: "paragraph",
        role: "header",
        pageNumber: 1,
        sourceRegions: [],
        wordIds: [],
        lineIds: [],
        readingOrder: 1,
        confidence: 0.9,
        text: "Running header",
        direction: "ltr",
        language: null,
        items: null,
        table: null,
        assetId: null,
        altText: null,
        captionOf: null,
        href: null,
        extraction: "native-pdf-text",
      },
    ],
    warnings: [],
    errorCategory: null,
    schemaVersion: 2,
    engineVersion: "rust-hybrid-v3",
  };
}

describe("PdfCanonicalReflowRenderer", () => {
  it("renders paragraphs as real selectable text with word spans", () => {
    render(<PdfCanonicalReflowRenderer pages={[page()]} />);
    const spans = screen.getAllByText(/The|quick|brown/);
    expect(spans.length).toBeGreaterThan(0);
    const paragraph = document.querySelector("p#p1\\:b0") ?? document.getElementById("p1:b0");
    expect(paragraph?.textContent).toBe("The quick brown");
    const wordSpans = document.querySelectorAll("[data-w]");
    expect(wordSpans.length).toBe(3);
    expect(wordSpans[0]).toHaveAttribute("data-w", "p1:w0");
  });

  it("suppresses marginal roles and shows pending placeholders", () => {
    render(<PdfCanonicalReflowRenderer pages={[page()]} pendingPageNumbers={[2, 3]} />);
    expect(screen.queryByText("Running header")).toBeNull();
    expect(screen.getByText("Preparing page 2…")).toBeTruthy();
    expect(screen.getByText("Preparing page 3…")).toBeTruthy();
  });

  it("renders visual assets (figure, equation, table crop, unknown-visual) and opens zoom modal on click", () => {
    const visualPage: PdfCanonicalPage = {
      ...page(),
      blocks: [
        {
          id: "p1:fig1",
          kind: "figure",
          role: "body",
          pageNumber: 1,
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 300, x1: 500, y1: 600 } }],
          wordIds: [],
          lineIds: [],
          readingOrder: 0,
          confidence: 0.9,
          text: "",
          direction: "auto",
          language: null,
          items: null,
          table: null,
          assetId: null,
          altText: "Figure 1 Architecture",
          captionOf: null,
          href: null,
          extraction: "graphical",
        },
        {
          id: "p1:eq1",
          kind: "equation",
          role: "body",
          pageNumber: 1,
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 200, y0: 250, x1: 400, y1: 280 } }],
          wordIds: [],
          lineIds: [],
          readingOrder: 1,
          confidence: 0.9,
          text: "",
          direction: "auto",
          language: null,
          items: null,
          table: null,
          assetId: null,
          altText: "E = mc^2",
          captionOf: null,
          href: null,
          extraction: "graphical",
        },
        {
          id: "p1:tbl1",
          kind: "table",
          role: "body",
          pageNumber: 1,
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 100, x1: 500, y1: 200 } }],
          wordIds: [],
          lineIds: [],
          readingOrder: 2,
          confidence: 0.5,
          text: "",
          direction: "auto",
          language: null,
          items: null,
          table: null, // unparsed fallback
          assetId: null,
          altText: "Table 1 Results",
          captionOf: null,
          href: null,
          extraction: "graphical",
        },
        {
          id: "p1:unk1",
          kind: "unknown-visual",
          role: "body",
          pageNumber: 1,
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 50, y0: 50, x1: 150, y1: 80 } }],
          wordIds: [],
          lineIds: [],
          readingOrder: 3,
          confidence: 0.5,
          text: "",
          direction: "auto",
          language: null,
          items: null,
          table: null,
          assetId: null,
          altText: "Diagram fragment",
          captionOf: null,
          href: null,
          extraction: "graphical",
        },
      ],
    };

    const assetUrls = new Map([
      ["p1:fig1", "blob:http://localhost/fig1"],
      ["p1:eq1", "blob:http://localhost/eq1"],
      ["p1:tbl1", "blob:http://localhost/tbl1"],
      ["p1:unk1", "blob:http://localhost/unk1"],
    ]);

    let originalViewTarget: any = null;
    render(
      <PdfCanonicalReflowRenderer
        pages={[visualPage]}
        assetUrls={assetUrls}
        onViewOriginal={(b) => {
          originalViewTarget = b;
        }}
      />,
    );

    // All four visual blocks render real <img> tags with their blob URLs
    const figImg = screen.getByAltText("Figure 1 Architecture") as HTMLImageElement;
    expect(figImg.src).toBe("blob:http://localhost/fig1");

    const eqImg = screen.getByAltText("E = mc^2") as HTMLImageElement;
    expect(eqImg.src).toBe("blob:http://localhost/eq1");

    const tblImg = screen.getByAltText("Table 1 Results") as HTMLImageElement;
    expect(tblImg.src).toBe("blob:http://localhost/tbl1");

    const unkImg = screen.getByAltText("Diagram fragment") as HTMLImageElement;
    expect(unkImg.src).toBe("blob:http://localhost/unk1");

    // Click figure image to open high-res zoom modal
    act(() => {
      fireEvent.click(figImg);
    });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getByText("Figure 1 Architecture")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();

    // Zoom in
    const zoomInBtn = screen.getByLabelText("Zoom in");
    act(() => {
      fireEvent.click(zoomInBtn);
    });
    expect(screen.getByText("125%")).toBeTruthy();

    // View in original
    const viewOrigBtn = screen.getByText("View in Original");
    act(() => {
      fireEvent.click(viewOrigBtn);
    });
    expect(originalViewTarget?.id).toBe("p1:fig1");

    // Dialog closed
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("visibly renders inline figure in reading order between selectable paragraphs and caption", () => {
    const documentPage: PdfCanonicalPage = {
      ...page(),
      words: [
        word("p1:w0", "Before", 100, 150, 0),
        word("p1:w1", "paragraph", 155, 220, 1),
        word("p1:w2", "After", 100, 150, 2),
        word("p1:w3", "paragraph", 155, 220, 3),
      ],
      blocks: [
        {
          id: "p1:p1",
          kind: "paragraph",
          role: "body",
          pageNumber: 1,
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 700, x1: 500, y1: 710 } }],
          wordIds: ["p1:w0", "p1:w1"],
          lineIds: ["p1:l0"],
          readingOrder: 0,
          confidence: 1.0,
          text: "Before paragraph",
          direction: "ltr",
          language: null,
          items: null,
          table: null,
          assetId: null,
          sourceWidth: null,
          sourceHeight: null,
          altText: null,
          captionOf: null,
          href: null,
          extraction: "native-pdf-text",
        },
        {
          id: "p1:fig1",
          kind: "figure",
          role: "body",
          pageNumber: 1,
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 450, x1: 500, y1: 650 } }],
          wordIds: [],
          lineIds: [],
          readingOrder: 1,
          confidence: 0.95,
          text: "",
          direction: "auto",
          language: null,
          items: null,
          table: null,
          assetId: "asset-1234",
          sourceWidth: 800,
          sourceHeight: 400,
          altText: "Architecture Diagram",
          captionOf: null,
          href: null,
          extraction: "graphical",
        },
        {
          id: "p1:cap1",
          kind: "caption",
          role: "body",
          pageNumber: 1,
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 420, x1: 500, y1: 440 } }],
          wordIds: [],
          lineIds: [],
          readingOrder: 2,
          confidence: 0.9,
          text: "Figure 1: High-level System Architecture",
          direction: "ltr",
          language: null,
          items: null,
          table: null,
          assetId: null,
          sourceWidth: null,
          sourceHeight: null,
          altText: null,
          captionOf: "p1:fig1",
          href: null,
          extraction: "native-pdf-text",
        },
        {
          id: "p1:p2",
          kind: "paragraph",
          role: "body",
          pageNumber: 1,
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 300, x1: 500, y1: 310 } }],
          wordIds: ["p1:w2", "p1:w3"],
          lineIds: ["p1:l1"],
          readingOrder: 3,
          confidence: 1.0,
          text: "After paragraph",
          direction: "ltr",
          language: null,
          items: null,
          table: null,
          assetId: null,
          sourceWidth: null,
          sourceHeight: null,
          altText: null,
          captionOf: null,
          href: null,
          extraction: "native-pdf-text",
        },
      ],
    };

    const assetUrls = new Map([["p1:fig1", "blob:http://localhost/fig1-rendered"]]);
    const assetDims = new Map([["p1:fig1", { width: 800, height: 400 }]]);

    render(
      <PdfCanonicalReflowRenderer
        pages={[documentPage]}
        assetUrls={assetUrls}
        assetDims={assetDims}
      />,
    );

    // 1. First paragraph is real selectable text with word spans
    const p1 = document.querySelector("#p1\\:p1");
    expect(p1?.textContent).toBe("Before paragraph");
    expect(p1?.querySelector('[data-w="p1:w0"]')?.textContent).toBe("Before");
    expect(p1?.querySelector('[data-w="p1:w1"]')?.textContent).toBe("paragraph");

    // 2. Figure is rendered as an actual inline <img> with the resolved object URL
    const figImg = screen.getByAltText("Architecture Diagram") as HTMLImageElement;
    expect(figImg).toBeTruthy();
    expect(figImg.src).toBe("blob:http://localhost/fig1-rendered");
    expect(figImg.getAttribute("width")).toBe("800");
    expect(figImg.getAttribute("height")).toBe("400");
    const visualBox = figImg.closest(".pdf-reflow-visual-box") as HTMLElement;
    expect(visualBox).toBeTruthy();
    expect(visualBox.style.aspectRatio).toBe("800 / 400");

    // 3. Caption is rendered as semantic <figcaption>
    const caption = document.querySelector("figcaption#p1\\:cap1");
    expect(caption?.textContent).toBe("Figure 1: High-level System Architecture");

    // 4. Second paragraph is real selectable text following the figure and caption
    const p2 = document.querySelector("#p1\\:p2");
    expect(p2?.textContent).toBe("After paragraph");
    expect(p2?.querySelector('[data-w="p1:w2"]')?.textContent).toBe("After");

    // 5. Ensure "Show original" placeholder is NOT displayed
    expect(screen.queryByText(/switch to Original view/i)).toBeNull();
  });
});

describe("PdfCanonicalReflowRenderer visual aspect boxes", () => {
  function figurePage(overrides: Partial<PdfCanonicalBlock> = {}): PdfCanonicalPage {
    return {
      ...page(),
      blocks: [
        {
          id: "p1:fig1",
          kind: "figure",
          role: "body",
          pageNumber: 1,
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 100, y0: 300, x1: 500, y1: 600 } }],
          wordIds: [],
          lineIds: [],
          readingOrder: 0,
          confidence: 0.9,
          text: "",
          direction: "auto",
          language: null,
          items: null,
          table: null,
          assetId: null,
          sourceWidth: null,
          sourceHeight: null,
          altText: "Figure 1 Architecture",
          captionOf: null,
          href: null,
          extraction: "graphical",
          ...overrides,
        } satisfies PdfCanonicalBlock,
      ],
    };
  }

  it("reserves the aspect box from measured crop dims", () => {
    render(
      <PdfCanonicalReflowRenderer
        pages={[figurePage()]}
        assetUrls={new Map([["p1:fig1", "blob:http://localhost/fig1"]])}
        assetDims={new Map([["p1:fig1", { width: 1200, height: 400 }]])}
      />,
    );
    const img = screen.getByAltText("Figure 1 Architecture") as HTMLImageElement;
    const box = img.closest(".pdf-reflow-visual-box") as HTMLElement;
    expect(box).not.toBeNull();
    // The box ratio and the img attribute dims are the structural guarantee
    // that space is held pre-load and the crop never stretches.
    expect(box.style.aspectRatio).toBe("1200 / 400");
    expect(img.getAttribute("width")).toBe("1200");
    expect(img.getAttribute("height")).toBe("400");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("falls back to model sourceWidth/sourceHeight, then bbox ratio", () => {
    const { rerender } = render(
      <PdfCanonicalReflowRenderer
        pages={[figurePage({ sourceWidth: 600, sourceHeight: 450 })]}
        assetUrls={new Map([["p1:fig1", "blob:http://localhost/fig1"]])}
      />,
    );
    let img = screen.getByAltText("Figure 1 Architecture") as HTMLImageElement;
    expect((img.closest(".pdf-reflow-visual-box") as HTMLElement).style.aspectRatio).toBe("600 / 450");
    expect(img.getAttribute("width")).toBe("600");

    // No model dims either: the PDF-space bbox ratio reserves the box
    // (points, but only the ratio matters).
    rerender(
      <PdfCanonicalReflowRenderer
        pages={[figurePage()]}
        assetUrls={new Map([["p1:fig1", "blob:http://localhost/fig1"]])}
      />,
    );
    img = screen.getByAltText("Figure 1 Architecture") as HTMLImageElement;
    expect((img.closest(".pdf-reflow-visual-box") as HTMLElement).style.aspectRatio).toBe("400 / 300");
    expect(img.getAttribute("width")).toBe("400");
  });

  it("prefers measured dims over model dims and bbox", () => {
    render(
      <PdfCanonicalReflowRenderer
        pages={[figurePage({ sourceWidth: 600, sourceHeight: 450 })]}
        assetUrls={new Map([["p1:fig1", "blob:http://localhost/fig1"]])}
        assetDims={new Map([["p1:fig1", { width: 818, height: 374 }]])}
      />,
    );
    const img = screen.getByAltText("Figure 1 Architecture") as HTMLImageElement;
    expect((img.closest(".pdf-reflow-visual-box") as HTMLElement).style.aspectRatio).toBe("818 / 374");
    expect(img.getAttribute("width")).toBe("818");
  });

  it("renders the original-view fallback when no asset URL exists", () => {
    render(<PdfCanonicalReflowRenderer pages={[figurePage()]} />);
    expect(screen.getByText("Figure — switch to Original view")).toBeTruthy();
    expect(document.querySelector(".pdf-reflow-visual-box")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders horizontal-rule blocks as an <hr>, never an asset lookup", () => {
    // Detection classifies wide-thin ink bands as horizontal-rule with no
    // asset: the renderer must draw a CSS rule, not a broken empty block or
    // an asset-URL lookup that can never resolve.
    const rulePage: PdfCanonicalPage = {
      ...page(),
      blocks: [
        {
          ...figurePage().blocks[0],
          id: "p1:rule1",
          kind: "horizontal-rule",
          sourceRegions: [{ pageNumber: 1, bbox: { x0: 72, y0: 500, x1: 540, y1: 502 } }],
          altText: null,
        } satisfies PdfCanonicalBlock,
      ],
    };
    render(
      <PdfCanonicalReflowRenderer
        pages={[rulePage]}
        assetUrls={new Map()}
        assetDims={new Map()}
      />,
    );
    const rule = document.querySelector(`hr#p1\\:rule1`);
    expect(rule).not.toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".pdf-reflow-visual-box")).toBeNull();
    expect(screen.queryByText(/switch to Original view/i)).toBeNull();
  });

  it("wraps unknown-visual and table crops, keeps equations inline with attribute dims", () => {
    const visualPage: PdfCanonicalPage = {
      ...page(),
      blocks: [
        {
          ...figurePage().blocks[0],
          id: "p1:unk1",
          kind: "unknown-visual",
          altText: "Diagram fragment",
        },
        {
          ...figurePage().blocks[0],
          id: "p1:tbl1",
          kind: "table",
          altText: "Table 1 Results",
        },
        {
          ...figurePage().blocks[0],
          id: "p1:eq1",
          kind: "equation",
          altText: "E = mc^2",
        },
      ],
    };
    render(
      <PdfCanonicalReflowRenderer
        pages={[visualPage]}
        assetUrls={new Map([
          ["p1:unk1", "blob:http://localhost/unk1"],
          ["p1:tbl1", "blob:http://localhost/tbl1"],
          ["p1:eq1", "blob:http://localhost/eq1"],
        ])}
        assetDims={new Map([["p1:unk1", { width: 100, height: 40 }]])}
      />,
    );
    // unknown-visual: aspect box from measured dims
    const unk = screen.getByAltText("Diagram fragment") as HTMLImageElement;
    expect((unk.closest(".pdf-reflow-visual-box") as HTMLElement).style.aspectRatio).toBe("100 / 40");
    // table crop: aspect box from the bbox fallback
    const tbl = screen.getByAltText("Table 1 Results") as HTMLImageElement;
    expect((tbl.closest(".pdf-reflow-visual-box") as HTMLElement).style.aspectRatio).toBe("400 / 300");
    // equation: inline-block flow is unchanged — no box, but the intrinsic
    // attribute dims still reserve the line box.
    const eq = screen.getByAltText("E = mc^2") as HTMLImageElement;
    expect(eq.closest(".pdf-reflow-visual-box")).toBeNull();
    expect(eq.getAttribute("width")).toBe("400");
    expect(eq.getAttribute("height")).toBe("300");
  });
});

describe("canonicalReflowSelectionFromRange", () => {
  it("maps a DOM range over data-w spans to a word-exact anchor", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <p data-pdf-reflow-block="p1:b0">
        <span data-w="p1:w0">The</span> <span data-w="p1:w1">quick</span> <span data-w="p1:w2">brown</span>
      </p>`;
    document.body.appendChild(host);
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.setStartBefore(host.querySelectorAll("[data-w]")[1]);
    range.setEndAfter(host.querySelectorAll("[data-w]")[1]);
    selection.removeAllRanges();
    selection.addRange(range);
    const result = canonicalReflowSelectionFromRange(
      selection,
      host,
      new Map([[1, page()]]),
      "doc-1",
      "fp",
    );
    expect(result?.text).toBe("quick");
    expect(result?.context.canonical?.startWordId).toBe("p1:w1");
    expect(result?.context.canonical?.endWordId).toBe("p1:w1");
    expect(result?.context.canonical?.pageRegions[0]?.bbox).toEqual({
      x0: 122, y0: 700, x1: 152, y1: 710,
    });
    expect(result?.context.pages[0]?.pdfRects[0]).toEqual({ x1: 122, y1: 700, x2: 152, y2: 710 });
    host.remove();
  });
});

describe("canonical anchors (D9)", () => {
  it("word-level anchors resolve and survive block-id loss", () => {
    const p = page();
    const anchor = anchorFromCanonicalBlock(p.blocks[0], "fp", "p1:w1");
    expect(anchor.wordId).toBe("p1:w1");
    const resolved = resolveCanonicalAnchor(new Map([[1, p]]), anchor);
    expect(resolved?.word?.id).toBe("p1:w1");
    expect(resolved?.block.id).toBe("p1:b0");
    // Stale block id: word resolution still lands the right block.
    const stale: PdfSourceAnchorState = { ...anchor, blockId: "p1:b999" };
    expect(resolveCanonicalAnchor(new Map([[1, p]]), stale)?.block.id).toBe("p1:b0");
    // Word id and block id both unknown: text quote fallback.
    const quoted: PdfSourceAnchorState = { pageNumber: 1, textQuote: "quick brown" };
    expect(resolveCanonicalAnchor(new Map([[1, p]]), quoted)?.block.id).toBe("p1:b0");
    expect(resolveCanonicalAnchor(new Map([[1, p]]), { pageNumber: 9 })).toBeNull();
  });
});
