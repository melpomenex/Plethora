import type { PDFPageProxy } from "pdfjs-dist";
import { ocrImageBytes } from "../../api/ocrCommands";
import { performOCRWithProgress, type OCRResult } from "../../api/ocr";
import { isTauri } from "../../lib/tauri";
import { ensureOCRConfig } from "../../utils/documentAutoExtract";
import { useSettingsStore } from "../../stores/settingsStore";
import type { PdfReflowBlock, PdfReflowDirection, PdfReflowPage } from "./pdfReflowTypes";

export type PdfPageOcrState = "queued" | "processing" | "ready" | "low-confidence" | "cancelled" | "failed";

export interface PdfPageOcrUpdate {
  state: PdfPageOcrState;
  pageNumber: number;
  progress: number;
  message?: string;
}

const MAX_OCR_DIMENSION = 2400;

async function renderPageForOcr(page: PDFPageProxy): Promise<{ dataUrl: string; width: number; height: number }> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.max(1, Math.min(2, MAX_OCR_DIMENSION / Math.max(base.width, base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas is unavailable for PDF text recognition.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return { dataUrl: canvas.toDataURL("image/png"), width: base.width, height: base.height };
}

function dataUrlPayload(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function directionFor(language: string): PdfReflowDirection {
  return /^(ara|heb|fas|urd)/i.test(language) ? "rtl" : "ltr";
}

function blocksFromText(
  text: string,
  pageNumber: number,
  width: number,
  height: number,
  confidence: number,
  language: string,
): PdfReflowBlock[] {
  const direction = directionFor(language);
  const paragraphs = text.split(/\n\s*\n|\n(?=[A-Z\p{L}])/u).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
  return paragraphs.map((paragraph, index) => ({
    id: `p${pageNumber}-ocr-${index}`,
    kind: "paragraph",
    text: paragraph,
    source: {
      pageNumber,
      // Native OCR currently returns page-level text without word boxes. Keep
      // an explicitly low-confidence page rectangle rather than inventing
      // precise coordinates; browser OCR can gain line boxes in a later engine version.
      rects: [{ x: 0, y: 0, width, height }],
      tokenIds: [],
      confidence: Math.min(0.6, confidence / 100),
    },
    extractionMethod: "ocr",
    confidence: confidence / 100,
    direction,
    language,
  }));
}

export class PdfReflowOcrController {
  private generation = 0;
  private active = false;

  async recognize(
    page: PDFPageProxy,
    pageNumber: number,
    language: string,
    onUpdate: (update: PdfPageOcrUpdate) => void,
  ): Promise<PdfReflowPage | null> {
    const generation = ++this.generation;
    if (this.active) throw new Error("Another PDF page is already being recognized.");
    this.active = true;
    onUpdate({ state: "queued", pageNumber, progress: 0 });
    try {
      if (typeof document !== "undefined" && document.hidden) {
        onUpdate({ state: "cancelled", pageNumber, progress: 0, message: "Text recognition waits until Plethora is visible." });
        return null;
      }
      onUpdate({ state: "processing", pageNumber, progress: 5, message: "Preparing page" });
      const rendered = await renderPageForOcr(page);
      if (generation !== this.generation) return null;

      let text: string;
      let confidence: number;
      if (isTauri()) {
        await ensureOCRConfig(useSettingsStore.getState().settings.documents.ocr);
        const result = await ocrImageBytes({ image_data: dataUrlPayload(rendered.dataUrl), language });
        if (!result.success) throw new Error(result.error ?? "Text recognition failed.");
        text = result.text;
        confidence = result.confidence;
        onUpdate({ state: "processing", pageNumber, progress: 90, message: "Formatting text" });
      } else {
        const result: OCRResult = await performOCRWithProgress(
          rendered.dataUrl,
          (progress, status) => onUpdate({ state: "processing", pageNumber, progress, message: status }),
          { language },
        );
        text = result.text;
        confidence = result.confidence;
      }
      if (generation !== this.generation) return null;
      const blocks = blocksFromText(text, pageNumber, rendered.width, rendered.height, confidence, language);
      const lowConfidence = confidence < 55 || blocks.length === 0;
      onUpdate({
        state: lowConfidence ? "low-confidence" : "ready",
        pageNumber,
        progress: 100,
        message: lowConfidence ? "Check the recognized text against the original page." : undefined,
      });
      return {
        pageNumber,
        width: rendered.width,
        height: rendered.height,
        state: blocks.length ? "ready" : "failed",
        classification: lowConfidence ? "semantic-with-warnings" : "semantic",
        confidence: confidence / 100,
        textCoverage: blocks.length ? 1 : 0,
        blocks,
        warnings: lowConfidence ? ["low-confidence-ocr", "approximate-source-geometry"] : ["approximate-source-geometry"],
      };
    } catch (error) {
      if (generation === this.generation) onUpdate({ state: "failed", pageNumber, progress: 0, message: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      this.active = false;
    }
  }

  cancel(): void {
    this.generation += 1;
    this.active = false;
  }
}

