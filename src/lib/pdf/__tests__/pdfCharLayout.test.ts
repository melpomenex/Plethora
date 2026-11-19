import { describe, it, expect } from "vitest";
import {
  buildPdfPageCharLayout,
  hitTestPdfChar,
  isPointNearPdfText,
  wordRangeAtPdfCaret,
  lineRangeAtPdfCaret,
  paragraphRangeAtPdfCaret,
  resolveGeometricSelection,
  isCjkOrFullwidth,
  type PdfPageCharLayout,
} from "../pdfCharLayout";

/**
 * Helper to create a horizontal PDF.js text item at (x, y).
 */
function item(
  str: string,
  x: number,
  y: number,
  width: number,
  height = 10,
  fontName = "g_d0_f1",
  hasEOL = false,
) {
  return {
    str,
    transform: [height, 0, 0, height, x, y],
    width,
    height,
    dir: "ltr",
    fontName,
    hasEOL,
  };
}

describe("pdfCharLayout", () => {
  it("recognizes CJK and fullwidth punctuation (including U+FF0C, U+FF1B)", () => {
    expect(isCjkOrFullwidth("人")).toBe(true);
    expect(isCjkOrFullwidth("，")).toBe(true);
    expect(isCjkOrFullwidth("；")).toBe(true);
    expect(isCjkOrFullwidth("。")).toBe(true);
    expect(isCjkOrFullwidth("A")).toBe(false);
    expect(isCjkOrFullwidth("1")).toBe(false);
  });

  it("reproduces and fixes Issue #7 OCR PDF selection (markedContent /Suspect, micro-spaces, CJK+digits, final punctuation)", () => {
    // Exact subset of items from The.Little.Prince-OCR.pdf page 1, including
    // /Suspect marked-content wrappers and 0.1–0.9pt synthetic OCR spaces.
    const textContent = {
      styles: {
        g_d0_f1: { fontFamily: "sans-serif", ascent: 0.859375, descent: -0.140625, vertical: false },
        g_d0_f3: { fontFamily: "serif", ascent: 0.891, descent: -0.216, vertical: false },
      },
      items: [
        item("人祀", 74.2, 309, 19.3, 9.6),
        item(" ", 93.5, 309, 0.3, 0),
        item("先贤祠", 93.8, 309, 30, 9.6),
        item(" ", 123.8, 309, 0.5, 0),
        item("是法国", 124.3, 308.9, 30.2, 9.9),
        item(" ", 154.5, 308.9, 0.9, 0),
        item("人至高", 155.4, 308.8, 29.5, 9.7),
        item(" ", 184.8, 308.8, 0.8, 0),
        item("无上的", 185.6, 309, 30.3, 9.6),
        item(" ", 215.9, 309, 0.5, 0),
        item("殊荣，", 216.4, 308.8, 30.9, 9.9),
        item("从", 247.1, 309.2, 9.5, 9.4),
        { type: "beginMarkedContentProps", id: null, tag: "Suspect" },
        item("1791", 257.2, 309.1, 20.7, 10.5, "g_d0_f3"),
        { type: "endMarkedContent" },
        item("年", 278.9, 309, 9.2, 9.5),
        item(" ", 288.1, 309, 0.8, 0),
        item("落成至", 288.9, 308.7, 29.8, 9.9),
        { type: "beginMarkedContentProps", id: null, tag: "Suspect" },
        item("", 54.9, 290.3, 0, 0, "g_d0_f1", true),
        item("今，", 54.9, 290.3, 19.4, 9.5),
        { type: "endMarkedContent" },
        item("两百多", 74.3, 290.3, 28.9, 9.6),
        item("年来只", 102.8, 290.1, 30.5, 9.7),
        item("有七十", 132.9, 290, 29, 9.8),
        item("二位伟", 161.8, 289.9, 29.5, 10),
        item(" ", 191.3, 289.9, 0.3, 0),
        item("人得以", 191.6, 290, 29.2, 9.6),
        item("安葬在", 220.6, 290.1, 29.5, 9.8),
        item(" ", 250, 290.1, 0.2, 0),
        item("这里。", 250.3, 289.7, 29.3, 9.8),
        item(" ", 279.6, 289.7, 0.5, 0),
        item("作", 280.1, 289.8, 9.4, 9.8),
        item(" ", 289.5, 289.8, 0.6, 0),
        item("为法兰", 290.1, 290, 29, 9.6, "g_d0_f1", true),
        item("西", 54.4, 271.4, 9.8, 9.4),
        item("的国家", 63.4, 271, 29.9, 9.6),
        item(" ", 93.3, 271, 0.5, 0),
        item("神庙，", 93.8, 271.1, 29.3, 9.7),
        item("先贤", 122.9, 271.1, 19.4, 9.6),
        item(" ", 142.2, 271.1, 0.5, 0),
        item("祠除了", 142.7, 271.1, 29, 9.5),
        item(" ", 171.8, 271.1, 0.2, 0),
        item("有许多", 172, 270.8, 28.9, 10.1),
        item(" ", 200.9, 270.8, 0.4, 0),
        item("供奉这", 201.3, 270.9, 28.9, 9.7),
        item(" ", 230.2, 270.9, 0.3, 0),
        item("些伟人", 230.5, 270.9, 29.3, 10),
        item(" ", 259.8, 270.9, 0.7, 0),
        item("灵柩的", 260.5, 271.1, 29.1, 9.6),
        item(" ", 289.6, 271.1, 0.1, 0),
        item("墓室之", 289.7, 270.7, 28.8, 9.9),
        { type: "beginMarkedContentProps", id: null, tag: "Suspect" },
        item("", 54.6, 252.1, 0, 0, "g_d0_f1", true),
        item("外，", 54.6, 252.1, 19.7, 9.7),
        { type: "endMarkedContent" },
        item("还有", 73.6, 252.1, 19.6, 9.8),
        item(" ", 93.2, 252.1, 0.4, 0),
        item("几块纪", 93.6, 252.1, 29, 9.5),
        item(" ", 122.5, 252.1, 0.3, 0),
        item("念碑，", 122.8, 252.1, 29.6, 9.5),
        item("上面", 152.3, 252.2, 19.1, 8.9),
        item(" ", 171.4, 252.2, 0.5, 0),
        item("镌刻着", 171.8, 251.9, 29, 9.5),
        item(" ", 200.8, 251.9, 0.7, 0),
        item("历代为", 201.5, 251.9, 28.8, 9.8),
        item("国捐躯", 229.9, 252.1, 29.8, 9.5),
        item("的烈士", 259.3, 251.9, 29.8, 9.5),
        item(" ", 289.1, 251.9, 0.5, 0),
        item("和两次", 289.7, 251.9, 28.6, 9.6, "g_d0_f1", true),
        item("世", 54.4, 232.9, 9.4, 9.6),
        item(" ", 63.8, 232.9, 0.7, 0),
        item("界大战", 64.5, 232.9, 28.8, 9.8),
        item(" ", 93.3, 232.9, 0.1, 0),
        item("期间为", 93.4, 232.9, 29.1, 9.8),
        item(" ", 122.5, 232.9, 0.3, 0),
        item("法兰西", 122.8, 232.7, 29.5, 9.9),
        item(" ", 152.3, 232.7, 0, 0),
        item("献身的作家的", 152.3, 232.9, 58.6, 9.7),
        item(" ", 210.9, 232.7, 0.4, 0),
        item("名字；", 211.3, 232.7, 29.6, 10),
        item("主殿", 240.4, 232.9, 19.3, 9.8),
      ],
    };

    const layout = buildPdfPageCharLayout(1, textContent);
    expect(layout.lines).toHaveLength(5);

    const layouts = new Map<number, PdfPageCharLayout>([[1, layout]]);

    // 1. Character-by-character selection along line 1:
    const startCaret = hitTestPdfChar(layout, 74.2, 312)!;
    expect(startCaret).toEqual({ pageNumber: 1, charIndex: 0 });
    for (let len = 1; len <= 5; len += 1) {
      const sel = resolveGeometricSelection(layouts, { pageNumber: 1, charIndex: 0 }, { pageNumber: 1, charIndex: len });
      expect(sel?.text).toBe("人祀先贤祠".slice(0, len));
      expect(sel?.pages[0].pdfRects).toHaveLength(1);
    }

    // 2. Full 5-line passage from 人 through final semicolon ；:
    const semiIdx = layout.chars.findIndex((c) => c.char === "；");
    expect(semiIdx).toBeGreaterThan(0);
    const semiChar = layout.chars[semiIdx];
    const endCaret = hitTestPdfChar(layout, semiChar.x1 - 0.5, semiChar.y0 + 4)!;
    expect(endCaret.charIndex).toBe(semiIdx + 1);

    const fullSel = resolveGeometricSelection(layouts, startCaret, endCaret)!;
    expect(fullSel).not.toBeNull();
    expect(fullSel.text).toBe(
      "人祀先贤祠是法国人至高无上的殊荣，从1791年落成至今，两百多年来只有七十二位伟人得以安葬在这里。作为法兰西的国家神庙，先贤祠除了有许多供奉这些伟人灵柩的墓室之外，还有几块纪念碑，上面镌刻着历代为国捐躯的烈士和两次世界大战期间为法兰西献身的作家的名字；",
    );
    // Exactly 5 clean per-line SumatraPDF rectangles (no overlap, no gaps).
    expect(fullSel.pages).toHaveLength(1);
    expect(fullSel.pages[0].pdfRects).toHaveLength(5);
    // Line 2 rect starts at 今 (x=54.9), Line 4 rect starts at 外 (x=54.6).
    expect(fullSel.pages[0].pdfRects[1].x1).toBeCloseTo(54.9, 1);
    expect(fullSel.pages[0].pdfRects[3].x1).toBeCloseTo(54.6, 1);

    // 3. Excluding final punctuation ； works cleanly by stopping on its left half:
    const beforeSemiCaret = hitTestPdfChar(layout, semiChar.x0 + 0.5, semiChar.y0 + 4)!;
    expect(beforeSemiCaret.charIndex).toBe(semiIdx);
    const withoutSemi = resolveGeometricSelection(layouts, startCaret, beforeSemiCaret)!;
    expect(withoutSemi.text.endsWith("名字")).toBe(true);
  });

  it("handles English multi-word spacing, de-hyphenation, and paragraph breaks", () => {
    const layout = buildPdfPageCharLayout(1, {
      items: [
        item("The quick brown", 72, 700, 90, 12),
        item("fox jumps over-", 72, 684, 85, 12),
        item("whelmed dogs.", 72, 668, 75, 12),
        // Paragraph gap (32pt vs 16pt normal step)
        item("Next paragraph.", 72, 636, 80, 12),
      ],
    });
    const layouts = new Map([[1, layout]]);
    const sel = resolveGeometricSelection(
      layouts,
      { pageNumber: 1, charIndex: 0 },
      { pageNumber: 1, charIndex: layout.chars.length },
    );
    expect(sel?.text).toBe("The quick brown fox jumps overwhelmed dogs.\nNext paragraph.");
    expect(sel?.pages[0].pdfRects).toHaveLength(4);
  });

  it("supports multi-page backward and forward selection", () => {
    const p1 = buildPdfPageCharLayout(1, { items: [item("Hello world", 50, 700, 66, 12)] });
    const p2 = buildPdfPageCharLayout(2, { items: [item("Second page", 50, 700, 66, 12)] });
    const layouts = new Map([
      [1, p1],
      [2, p2],
    ]);

    const fwd = resolveGeometricSelection(
      layouts,
      { pageNumber: 1, charIndex: 5 },
      { pageNumber: 2, charIndex: 6 },
    );
    expect(fwd?.text).toBe("world\nSecond");
    expect(fwd?.pages.map((p) => p.pageNumber)).toEqual([1, 2]);

    const bwd = resolveGeometricSelection(
      layouts,
      { pageNumber: 2, charIndex: 6 },
      { pageNumber: 1, charIndex: 5 },
    );
    expect(bwd?.text).toBe("world\nSecond");
  });

  it("orders two-column layouts left column before right column", () => {
    const layout = buildPdfPageCharLayout(1, {
      items: [
        item("Left one", 50, 700, 48, 10),
        item("Right one", 320, 700, 54, 10),
        item("Left two", 50, 686, 48, 10),
        item("Right two", 320, 686, 54, 10),
        item("Left three", 50, 672, 60, 10),
        item("Right three", 320, 672, 66, 10),
        item("Left four", 50, 658, 54, 10),
        item("Right four", 320, 658, 60, 10),
      ],
    });
    const layouts = new Map([[1, layout]]);
    const sel = resolveGeometricSelection(
      layouts,
      { pageNumber: 1, charIndex: 0 },
      { pageNumber: 1, charIndex: layout.chars.length },
    );
    expect(sel?.text).toBe("Left one Left two Left three Left four\nRight one Right two Right three Right four");
  });

  it("supports double-click word selection and triple-click line selection", () => {
    const layout = buildPdfPageCharLayout(1, {
      items: [
        item("Hello world test", 50, 700, 96, 12),
        item("Second line", 50, 684, 66, 12),
      ],
    });
    const layouts = new Map([[1, layout]]);

    // Click inside "world"
    const worldRange = wordRangeAtPdfCaret(layout, 6)!;
    const wordSel = resolveGeometricSelection(
      layouts,
      { pageNumber: 1, charIndex: worldRange.start },
      { pageNumber: 1, charIndex: worldRange.end },
    );
    expect(wordSel?.text).toBe("world");

    // Triple-click on first line
    const lineRange = lineRangeAtPdfCaret(layout, 6)!;
    const lineSel = resolveGeometricSelection(
      layouts,
      { pageNumber: 1, charIndex: lineRange.start },
      { pageNumber: 1, charIndex: lineRange.end },
    );
    expect(lineSel?.text).toBe("Hello world test");
  });

  it("detects point proximity to text lines", () => {
    const layout = buildPdfPageCharLayout(1, {
      items: [item("Sample", 100, 500, 40, 10)],
    });
    expect(isPointNearPdfText(layout, 115, 504)).toBe(true);
    expect(isPointNearPdfText(layout, 400, 100)).toBe(false);
  });

  it("stops lineRangeAtPdfCaret at wide column/diagram gaps and selects whole paragraphs", () => {
    const layout = buildPdfPageCharLayout(1, {
      items: [
        // Paragraph 1 (indented first line)
        item("Consider, for instance,", 62, 700, 120, 10),
        item("Feedback", 280, 700, 50, 10),
        item("cell living in the erratic", 50, 686, 132, 10),
        item("environment of a colon.", 50, 672, 132, 10),
        // Paragraph 2 (vertical gap)
        item("Next paragraph starts.", 50, 640, 120, 10),
      ],
    });
    const layouts = new Map([[1, layout]]);

    // Line range on left side does not cross the 100pt gap into "Feedback"
    const lineRange = lineRangeAtPdfCaret(layout, 2)!;
    const lineSel = resolveGeometricSelection(
      layouts,
      { pageNumber: 1, charIndex: lineRange.start },
      { pageNumber: 1, charIndex: lineRange.end },
    );
    expect(lineSel?.text).toBe("Consider, for instance,");

    // Paragraph range on line 2 selects paragraph 1 without bleeding into paragraph 2
    const paraCaret = layout.chars.findIndex((c) => c.char === "l");
    const paraRange = paragraphRangeAtPdfCaret(layout, paraCaret)!;
    const paraSel = resolveGeometricSelection(
      layouts,
      { pageNumber: 1, charIndex: paraRange.start },
      { pageNumber: 1, charIndex: paraRange.end },
    );
    expect(paraSel?.text).toContain("cell living in the erratic");
    expect(paraSel?.text).toContain("environment of a colon.");
    expect(paraSel?.text).not.toContain("Next paragraph");
  });
});
