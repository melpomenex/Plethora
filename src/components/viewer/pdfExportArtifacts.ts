import { PermissionFlag, type PDFDocumentProxy } from "pdfjs-dist";

export type PdfArtifactFormat = "filledPdf" | "text" | "html" | "png";
export type PdfFileOutput = PdfArtifactFormat | "pages" | "print";

export const pdfArtifactExtension: Record<PdfArtifactFormat, string> = {
  filledPdf: "pdf",
  text: "txt",
  html: "html",
  png: "png",
};

export function parsePdfPageOrder(input: string, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const item of input.split(",")) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(item.trim());
    if (!match) throw new Error("Enter physical pages or ranges separated by commas.");
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isInteger(start) || start < 1 || end < start || end > pageCount) {
      throw new Error(`Choose pages from 1 to ${pageCount}.`);
    }
    for (let page = start; page <= end; page += 1) {
      if (pages.has(page)) throw new Error(`Page ${page} is listed twice.`);
      pages.add(page);
    }
  }
  return [...pages];
}

async function ensureExportPermission(pdf: PDFDocumentProxy, permission: number) {
  const permissions = await pdf.getPermissions();
  if (permissions && !permissions.includes(permission)) {
    throw new Error("This PDF does not permit the selected action.");
  }
}

async function renderPdfPageImage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  intent: "display" | "print",
): Promise<Blob> {
  const page = await pdf.getPage(pageNumber);
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 2400 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  try {
    await page.render({
      canvas,
      viewport,
      intent,
      printAnnotationStorage: intent === "print" ? pdf.annotationStorage.print : undefined,
    }).promise;
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("Could not render this PDF page.");
    return png;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function renderPdfArtifact(
  pdf: PDFDocumentProxy,
  format: PdfArtifactFormat,
  pages: number[],
): Promise<Blob> {
  if (format === "filledPdf") {
    await ensureExportPermission(pdf, PermissionFlag.FILL_INTERACTIVE_FORMS);
    return new Blob([Uint8Array.from(await pdf.saveDocument())], { type: "application/pdf" });
  }
  await ensureExportPermission(pdf, PermissionFlag.COPY);
  if (format === "png") return renderPdfPageImage(pdf, pages[0], "display");

  const fragments: Array<{ page: number; text: string }> = [];
  for (const number of pages) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const text = content.items.map((item) =>
      "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
    ).join("").trim();
    fragments.push({ page: number, text });
  }

  if (format === "text") {
    return new Blob([fragments.map(({ page, text }) => `Page ${page}\n${text}`).join("\n\n")],
      { type: "text/plain;charset=utf-8" });
  }

  const output = document.implementation.createHTMLDocument("PDF text export");
  const charset = output.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  output.head.prepend(charset);
  for (const { page, text } of fragments) {
    const section = output.createElement("section");
    const heading = output.createElement("h2");
    const body = output.createElement("pre");
    section.dataset.pageNumber = String(page);
    heading.textContent = `Page ${page}`;
    body.textContent = text;
    section.append(heading, body);
    output.body.append(section);
  }
  return new Blob(["<!doctype html>\n", output.documentElement.outerHTML],
    { type: "text/html;charset=utf-8" });
}

export async function printPdfPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<void> {
  // Open in the click event so browser popup rules are respected.
  const preview = window.open("", "_blank");
  if (!preview) throw new Error("Allow pop-ups to print this PDF page.");
  try {
    preview.opener = null;
    await ensureExportPermission(pdf, PermissionFlag.PRINT);
    const url = URL.createObjectURL(await renderPdfPageImage(pdf, pageNumber, "print"));
    const image = preview.document.createElement("img");
    image.src = url;
    image.alt = `Page ${pageNumber}`;
    image.style.maxWidth = "100%";
    image.style.maxHeight = "95vh";
    preview.document.title = `PDF page ${pageNumber}`;
    preview.document.body.replaceChildren(image);
    try {
      await image.decode();
      preview.print();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    preview.close();
    throw error;
  }
}

export function downloadPdfArtifact(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function pdfArtifactBase64(blob: Blob): Promise<string> {
  if (blob.size > 32 * 1024 * 1024) throw new Error("This export is too large to transfer from the reader.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(blob);
  });
}
