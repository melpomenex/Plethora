import type { PdfCanonicalPage, PdfCanonicalWord } from "../../types/pdfCanonical";

export type PdfTextUsability = "word-level" | "chunk-level" | "unusable";

export interface PdfTextUsabilityResult {
  usability: PdfTextUsability;
  nativeWordCount: number;
  ocrWordCount: number;
  graphicalWordCount: number;
  reason?: string;
}

/**
 * Assess whether a canonical PDF page supports word-level TTS highlighting.
 * Scanned/image pages without native text degrade safely.
 */
export function assessPdfPageTextUsability(page: PdfCanonicalPage | undefined): PdfTextUsabilityResult {
  if (!page || page.state !== "ready") {
    return {
      usability: "unusable",
      nativeWordCount: 0,
      ocrWordCount: 0,
      graphicalWordCount: 0,
      reason: "page-not-ready",
    };
  }

  const words = collectBodyWords(page);
  if (words.length === 0) {
    return {
      usability: "unusable",
      nativeWordCount: 0,
      ocrWordCount: 0,
      graphicalWordCount: 0,
      reason: "no-body-text",
    };
  }

  const counts = countBySource(words);
  const nativeRatio = counts.native / words.length;
  const graphicalRatio = counts.graphical / words.length;

  if (nativeRatio >= 0.5) {
    return { usability: "word-level", ...counts };
  }
  if (counts.ocr > 0 || nativeRatio > 0) {
    return {
      usability: "chunk-level",
      ...counts,
      reason: counts.ocr > 0 ? "ocr-only" : "sparse-native-text",
    };
  }
  if (graphicalRatio >= 0.8) {
    return {
      usability: "unusable",
      ...counts,
      reason: "scanned-or-graphical",
    };
  }
  return { usability: "chunk-level", ...counts, reason: "ambiguous-text-layer" };
}

function collectBodyWords(page: PdfCanonicalPage): PdfCanonicalWord[] {
  const words: PdfCanonicalWord[] = [];
  for (const block of page.blocks) {
    if (block.role !== "body") continue;
    for (const wordId of block.wordIds) {
      const word = page.words.find((w) => w.id === wordId);
      if (word) words.push(word);
    }
  }
  return words;
}

function countBySource(words: PdfCanonicalWord[]): {
  nativeWordCount: number;
  ocrWordCount: number;
  graphicalWordCount: number;
  native: number;
  ocr: number;
  graphical: number;
} {
  let native = 0;
  let ocr = 0;
  let graphical = 0;
  for (const w of words) {
    if (w.source === "native-pdf-text") native++;
    else if (w.source === "ocr") ocr++;
    else graphical++;
  }
  return {
    nativeWordCount: native,
    ocrWordCount: ocr,
    graphicalWordCount: graphical,
    native,
    ocr,
    graphical,
  };
}

/** Aggregate usability across multiple pages (e.g. current PDF window). */
export function assessPdfPagesTextUsability(
  pages: Iterable<PdfCanonicalPage>,
): PdfTextUsabilityResult {
  let best: PdfTextUsability = "unusable";
  let nativeWordCount = 0;
  let ocrWordCount = 0;
  let graphicalWordCount = 0;
  const reasons: string[] = [];

  for (const page of pages) {
    const result = assessPdfPageTextUsability(page);
    nativeWordCount += result.nativeWordCount;
    ocrWordCount += result.ocrWordCount;
    graphicalWordCount += result.graphicalWordCount;
    if (result.reason) reasons.push(result.reason);
    if (result.usability === "word-level") best = "word-level";
    else if (result.usability === "chunk-level" && best === "unusable") best = "chunk-level";
  }

  return {
    usability: best,
    nativeWordCount,
    ocrWordCount,
    graphicalWordCount,
    reason: reasons[0],
  };
}
