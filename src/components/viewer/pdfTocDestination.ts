import type { PdfCanonicalBlock } from "../../types/pdfCanonical";
import type { PdfReflowBlock } from "./pdfReflowTypes";

export interface DestinationViewport {
  viewBox: number[];
  convertToViewportPoint(x: number, y: number): number[];
}

export function pdfDestinationPoint(dest: any[] | null, viewport: DestinationViewport): { x: number | null; y: number | null } {
  if (!dest) return { x: null, y: 0 };
  const kind = typeof dest[1] === "string" ? dest[1] : dest[1]?.name;
  const [x0, , , y1] = viewport.viewBox;
  const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  if (kind === "Fit" || kind === "FitB") return { x: 0, y: 0 };
  if (kind === "FitR" && dest.slice(2, 6).every(number)) {
    const a = viewport.convertToViewportPoint(dest[2], dest[3]);
    const b = viewport.convertToViewportPoint(dest[4], dest[5]);
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]) };
  }
  const left = kind === "XYZ" ? dest[2] : (kind === "FitV" || kind === "FitBV") ? dest[2] : x0;
  const top = kind === "XYZ" ? dest[3] : (kind === "FitH" || kind === "FitBH") ? dest[2] : y1;
  const [x, y] = viewport.convertToViewportPoint(number(left) ? left : x0, number(top) ? top : y1);
  // XYZ null coordinates retain that viewport axis (PDF destination semantics).
  return { x: kind === "XYZ" && !number(left) ? null : x, y: kind === "XYZ" && !number(top) ? null : y };
}

/** Destination zoom uses the page's rotated viewport geometry at scale 1. */
export function pdfDestinationScale(dest: any[] | null, viewport: DestinationViewport, width: number, height: number): number | null {
  if (!dest) return null;
  const kind = typeof dest[1] === "string" ? dest[1] : dest[1]?.name;
  if (kind === "XYZ") return typeof dest[4] === "number" && dest[4] > 0 ? dest[4] : null;
  const box = kind === "FitR" ? dest.slice(2, 6) : viewport.viewBox;
  if (box.length !== 4 || !box.every((value: unknown) => typeof value === "number" && Number.isFinite(value))) return null;
  const a = viewport.convertToViewportPoint(box[0], box[1]);
  const b = viewport.convertToViewportPoint(box[2], box[3]);
  const w = Math.abs(b[0] - a[0]);
  const h = Math.abs(b[1] - a[1]);
  if (!w || !h || width <= 32 || height <= 32) return null;
  const fitWidth = (width - 32) / w;
  const fitHeight = (height - 32) / h;
  if (["FitH", "FitBH"].includes(kind)) return fitWidth;
  if (["FitV", "FitBV"].includes(kind)) return fitHeight;
  if (["Fit", "FitB", "FitR"].includes(kind)) return Math.min(fitWidth, fitHeight);
  return null;
}

/** Resolve in source geometry, not reflow text layout (which has different height). */
export function pdfReflowDestinationBlock(
  dest: any[], viewport: DestinationViewport,
  canonical: PdfCanonicalBlock[] = [], prototype: PdfReflowBlock[] = [],
): string | null {
  const point = pdfDestinationPoint(dest, viewport);
  if (point.y === null) return null;
  const candidates = canonical.filter((block) => block.role === "body").flatMap((block) =>
    block.sourceRegions.map(({ bbox }) => {
      const a = viewport.convertToViewportPoint(bbox.x0, bbox.y0);
      const b = viewport.convertToViewportPoint(bbox.x1, bbox.y1);
      return { id: block.id, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) };
    }),
  );
  if (!candidates.length) candidates.push(...prototype.flatMap((block) => block.source.rects.map((rect) => {
    const a = viewport.convertToViewportPoint(rect.x, rect.y);
    const b = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height);
    return { id: block.id, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), right: Math.max(a[0], b[0]), bottom: Math.max(a[1], b[1]) };
  })));
  let best: string | null = null;
  let distance = Infinity;
  for (const candidate of candidates) {
    const dy = Math.max(candidate.y - point.y, 0, point.y - candidate.bottom);
    const dx = point.x === null ? 0 : Math.max(candidate.x - point.x, 0, point.x - candidate.right);
    const score = Math.hypot(dx, dy);
    if (score < distance) { best = candidate.id; distance = score; }
  }
  return best;
}
