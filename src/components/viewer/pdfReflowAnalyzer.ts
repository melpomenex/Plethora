import { OPS, type PDFPageProxy } from "pdfjs-dist";
import type { PdfAnalysisClassification } from "./pdfDiagnostics";
import type {
  PdfReflowBlock,
  PdfReflowDirection,
  PdfReflowPage,
  PdfSourceRect,
  PdfSourceToken,
} from "./pdfReflowTypes";

export interface PdfTextToken extends PdfSourceToken {
  fontSize: number;
  direction: PdfReflowDirection;
  hasEol: boolean;
}

interface PdfJsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  dir: string;
  hasEOL: boolean;
}

interface TextLine {
  tokens: PdfTextToken[];
  text: string;
  rect: PdfSourceRect;
  fontSize: number;
  direction: PdfReflowDirection;
  segments: string[];
  column: number;
}

export interface PdfPageAnalysisInput {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfJsTextItem[];
  links?: Array<{ url?: string; rect?: number[] }>;
  imageCount?: number;
}

function unionRects(rects: PdfSourceRect[]): PdfSourceRect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const bottom = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const top = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: bottom, width: right - left, height: top - bottom };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function tokenFromItem(item: PdfPageAnalysisInput["items"][number], pageNumber: number, index: number): PdfTextToken | null {
  const text = item.str.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const fontSize = Math.max(1, Math.hypot(item.transform[2], item.transform[3]) || item.height || 1);
  return {
    id: `p${pageNumber}-t${index}`,
    text,
    rect: {
      x: item.transform[4],
      y: item.transform[5],
      width: Math.max(0, item.width),
      height: Math.max(1, item.height || fontSize),
    },
    fontSize,
    direction: item.dir === "rtl" ? "rtl" : "ltr",
    hasEol: item.hasEOL,
  };
}

function groupLines(tokens: PdfTextToken[], pageWidth: number): TextLine[] {
  let bands: PdfTextToken[][] = [];
  for (const token of [...tokens].sort((a, b) => b.rect.y - a.rect.y || a.rect.x - b.rect.x)) {
    const band = bands.find((candidate) => {
      const reference = candidate[0];
      return Math.abs(reference.rect.y - token.rect.y) <= Math.max(reference.fontSize, token.fontSize) * 0.45;
    });
    if (band) band.push(token); else bands.push([token]);
  }

  // Two-column documents commonly have a left and right line on the exact
  // same baseline. Treating each baseline as one row turns the entire page
  // into a table. Split at the page gutter only when the pattern repeats;
  // isolated aligned rows remain eligible for table detection.
  const pairedBands = bands.filter((band) =>
    band.some((token) => token.rect.x + token.rect.width / 2 < pageWidth * 0.45)
    && band.some((token) => token.rect.x + token.rect.width / 2 > pageWidth * 0.55));
  if (pairedBands.length >= 3) {
    bands = bands.flatMap((band) => {
      const left = band.filter((token) => token.rect.x + token.rect.width / 2 < pageWidth / 2);
      const right = band.filter((token) => token.rect.x + token.rect.width / 2 >= pageWidth / 2);
      return left.length && right.length ? [left, right] : [band];
    });
  }

  const lines = bands.map((band): TextLine => {
    const rtl = band.filter((token) => token.direction === "rtl").length > band.length / 2;
    band.sort((a, b) => rtl ? b.rect.x - a.rect.x : a.rect.x - b.rect.x);
    const segments: string[] = [];
    let segment = "";
    for (let index = 0; index < band.length; index += 1) {
      const token = band[index];
      const previous = band[index - 1];
      const gap = previous
        ? rtl
          ? previous.rect.x - (token.rect.x + token.rect.width)
          : token.rect.x - (previous.rect.x + previous.rect.width)
        : 0;
      if (previous && gap > Math.max(previous.fontSize, token.fontSize) * 2.5) {
        segments.push(segment.trim());
        segment = "";
      }
      segment += `${segment ? " " : ""}${token.text}`;
    }
    if (segment.trim()) segments.push(segment.trim());
    const rect = unionRects(band.map((token) => token.rect));
    return {
      tokens: band,
      text: band.map((token) => token.text).join(" ").replace(/\s+/g, " ").trim(),
      rect,
      fontSize: median(band.map((token) => token.fontSize)),
      direction: rtl ? "rtl" : "ltr",
      segments,
      column: rect.x + rect.width / 2 < pageWidth / 2 ? 0 : 1,
    };
  });

  const left = lines.filter((line) => line.column === 0 && line.rect.x + line.rect.width < pageWidth * 0.58);
  const right = lines.filter((line) => line.column === 1 && line.rect.x > pageWidth * 0.42);
  const twoColumns = left.length >= 3 && right.length >= 3;
  if (!twoColumns) return lines.sort((a, b) => b.rect.y - a.rect.y || a.rect.x - b.rect.x);

  const fullWidth = lines.filter((line) => line.rect.x < pageWidth * 0.42 && line.rect.x + line.rect.width > pageWidth * 0.58);
  const headerBottom = Math.max(...fullWidth.map((line) => line.rect.y), -Infinity);
  const headers = fullWidth.filter((line) => line.rect.y >= headerBottom).sort((a, b) => b.rect.y - a.rect.y);
  const bodyLeft = left.filter((line) => !headers.includes(line)).sort((a, b) => b.rect.y - a.rect.y);
  const bodyRight = right.filter((line) => !headers.includes(line)).sort((a, b) => b.rect.y - a.rect.y);
  const remaining = lines.filter((line) => !headers.includes(line) && !bodyLeft.includes(line) && !bodyRight.includes(line));
  return [...headers, ...bodyLeft, ...bodyRight, ...remaining.sort((a, b) => b.rect.y - a.rect.y)];
}

function blockKind(line: TextLine, bodyFont: number): PdfReflowBlock["kind"] {
  if (/^(?:[-•▪◦]|\d+[.)])\s/.test(line.text)) return "list";
  if (line.segments.length >= 2) return "table";
  if (line.fontSize >= bodyFont * 1.28 || (line.text.length < 90 && line.text === line.text.toUpperCase() && /[A-Z]/.test(line.text))) return "heading";
  if (line.fontSize <= bodyFont * 0.78) return "footnote";
  if (/^(?:figure|fig\.|table)\s+\d+/i.test(line.text)) return "caption";
  if (/[{};]/.test(line.text) && /(?:const|let|fn|def|class|return|=>)/.test(line.text)) return "code";
  if (/[=∑∫√±≤≥]/.test(line.text) && line.text.length < 180) return "equation";
  return "paragraph";
}

function sourceFor(lines: TextLine[], pageNumber: number, confidence: number) {
  return {
    pageNumber,
    rects: lines.map((line) => line.rect),
    tokenIds: lines.flatMap((line) => line.tokens.map((token) => token.id)),
    confidence,
  };
}

function buildBlocks(lines: TextLine[], pageNumber: number, links: PdfPageAnalysisInput["links"] = [], imageCount = 0, pageWidth = 0, pageHeight = 0): PdfReflowBlock[] {
  const bodyFont = median(lines.map((line) => line.fontSize).filter(Boolean)) || 12;
  const blocks: PdfReflowBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const kind = blockKind(line, bodyFont);
    const previous = blocks.at(-1);
    const canMergeParagraph = previous?.kind === "paragraph"
      && kind === "paragraph"
      && previous.direction === line.direction
      && previous.source.rects.at(-1)
      && Math.abs(previous.source.rects.at(-1)!.y - line.rect.y) < bodyFont * 2.2;
    if (canMergeParagraph) {
      previous.text = `${previous.text}${previous.text.endsWith("-") ? "" : " "}${line.text}`.replace(/-\s(?=[a-z])/g, "");
      previous.source.rects.push(line.rect);
      previous.source.tokenIds.push(...line.tokens.map((token) => token.id));
      continue;
    }
    const confidence = kind === "table" ? 0.72 : 0.9;
    const href = links.find((link) => {
      const rect = link.rect;
      return rect && rect.length >= 4 && line.rect.x <= rect[2] && line.rect.x + line.rect.width >= rect[0]
        && line.rect.y <= rect[3] && line.rect.y + line.rect.height >= rect[1];
    })?.url;
    blocks.push({
      id: `p${pageNumber}-b${blocks.length}`,
      kind,
      text: line.text,
      source: sourceFor([line], pageNumber, confidence),
      extractionMethod: "pdf-text",
      confidence,
      direction: line.direction,
      items: kind === "list" ? [line.text.replace(/^(?:[-•▪◦]|\d+[.)])\s*/, "")] : undefined,
      table: kind === "table" ? [line.segments] : undefined,
      href,
    });
  }
  for (let imageIndex = 0; imageIndex < imageCount; imageIndex += 1) {
    blocks.push({
      id: `p${pageNumber}-figure-${imageIndex}`,
      kind: "figure",
      text: `Figure on source page ${pageNumber}`,
      source: { pageNumber, rects: [{ x: 0, y: 0, width: pageWidth, height: pageHeight }], tokenIds: [], confidence: 0.35 },
      extractionMethod: "pdf-text",
      confidence: 0.35,
      direction: "auto",
    });
  }
  blocks.push({
    id: `p${pageNumber}-break`,
    kind: "page-break",
    text: "",
    source: { pageNumber, rects: [], tokenIds: [], confidence: 1 },
    extractionMethod: "pdf-text",
    confidence: 1,
    direction: "auto",
  });
  return blocks;
}

function classify(tokens: PdfTextToken[], blocks: PdfReflowBlock[], width: number, height: number): {
  classification: PdfAnalysisClassification;
  confidence: number;
  textCoverage: number;
  warnings: string[];
} {
  const characterCount = tokens.reduce((sum, token) => sum + token.text.length, 0);
  const textArea = tokens.reduce((sum, token) => sum + token.rect.width * token.rect.height, 0);
  const textCoverage = Math.min(1, textArea / Math.max(1, width * height));
  const tableRatio = blocks.filter((block) => block.kind === "table").length / Math.max(1, blocks.length - 1);
  const warnings: string[] = [];
  if (characterCount < 20) return { classification: "ocr-required", confidence: 0.1, textCoverage, warnings: ["insufficient-text"] };
  if (tableRatio > 0.45) return { classification: "fixed-layout-recommended", confidence: 0.45, textCoverage, warnings: ["dense-tabular-layout"] };
  if (tableRatio > 0.15) warnings.push("table-order-may-vary");
  const confidence = warnings.length ? 0.72 : 0.9;
  return { classification: warnings.length ? "semantic-with-warnings" : "semantic", confidence, textCoverage, warnings };
}

export function analyzePdfTextItems(input: PdfPageAnalysisInput): PdfReflowPage {
  const tokens = input.items.map((item, index) => tokenFromItem(item, input.pageNumber, index)).filter((token): token is PdfTextToken => Boolean(token));
  const lines = groupLines(tokens, input.width);
  const blocks = buildBlocks(lines, input.pageNumber, input.links, input.imageCount, input.width, input.height);
  const quality = classify(tokens, blocks, input.width, input.height);
  return {
    pageNumber: input.pageNumber,
    width: input.width,
    height: input.height,
    state: quality.classification === "ocr-required" ? "ocr-required" : "ready",
    ...quality,
    blocks,
  };
}

export async function extractPdfReflowPage(page: PDFPageProxy, pageNumber: number): Promise<PdfReflowPage> {
  const [text, annotations, operators] = await Promise.all([
    page.getTextContent(),
    page.getAnnotations({ intent: "display" }),
    page.getOperatorList(),
  ]);
  const viewport = page.getViewport({ scale: 1 });
  const items: PdfJsTextItem[] = text.items.flatMap((item) => "str" in item ? [{
    str: item.str,
    transform: item.transform,
    width: item.width,
    height: item.height,
    dir: item.dir,
    hasEOL: item.hasEOL,
  }] : []);
  return analyzePdfTextItems({
    pageNumber,
    width: viewport.width,
    height: viewport.height,
    items,
    links: annotations.map((annotation) => ({ url: annotation.url, rect: annotation.rect })),
    imageCount: operators.fnArray.filter((operator) => operator === OPS.paintImageXObject || operator === OPS.paintInlineImageXObject || operator === OPS.paintImageMaskXObject).length,
  });
}

export function removeRepeatedPageMargins(pages: PdfReflowPage[]): PdfReflowPage[] {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const block of page.blocks) {
      const rect = block.source.rects[0];
      if (!rect || (rect.y > page.height * 0.12 && rect.y < page.height * 0.88)) continue;
      const key = block.text.trim().toLowerCase().replace(/\d+/g, "#");
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return pages.map((page) => ({
    ...page,
    blocks: page.blocks.filter((block) => {
      const rect = block.source.rects[0];
      if (!rect || (rect.y > page.height * 0.12 && rect.y < page.height * 0.88)) return true;
      const key = block.text.trim().toLowerCase().replace(/\d+/g, "#");
      return !key || (counts.get(key) ?? 0) < threshold;
    }),
  }));
}
