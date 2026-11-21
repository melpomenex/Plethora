import { Export } from "@phosphor-icons/react";
import { useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { invokeCommand, isTauri } from "../../lib/tauri";
import { useI18n } from "../../lib/i18n";
import { Dialog } from "../md3/Dialog";
import { Button } from "../md3/Button";
import {
  downloadPdfArtifact,
  parsePdfPageOrder,
  pdfArtifactBase64,
  pdfArtifactExtension,
  printPdfPage,
  renderPdfArtifact,
  type PdfFileOutput,
} from "./pdfExportArtifacts";

export function PdfFileActions({ pdf, documentId, pageNumber, sourceIdentity }: {
  pdf: PDFDocumentProxy;
  documentId: string;
  pageNumber: number;
  sourceIdentity?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<PdfFileOutput>("text");
  const [pages, setPages] = useState("");
  const [crop, setCrop] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const canSave = !isTauri() || Boolean(sourceIdentity);
  const usesPages = format === "pages" || format === "text" || format === "html";

  const save = async () => {
    setPending(true);
    setError(undefined);
    try {
      if (format === "print") {
        await printPdfPage(pdf, pageNumber);
      } else if (format === "pages") {
        const saved = await invokeCommand<boolean>("save_pdf_page_copy", {
          documentId,
          expectedIdentity: sourceIdentity,
          plan: {
            kind: "pages",
            pages: parsePdfPageOrder(pages, pdf.numPages),
            cropPoints: crop.trim() ? Number(crop) : null,
          },
        });
        if (!saved) return;
      } else if (canSave) {
        const chosen = usesPages ? parsePdfPageOrder(pages, pdf.numPages) : [pageNumber];
        const blob = await renderPdfArtifact(pdf, format, chosen);
        if (sourceIdentity) {
          const saved = await invokeCommand<boolean>("save_pdf_viewer_artifact", {
            documentId,
            expectedIdentity: sourceIdentity,
            format,
            base64Data: await pdfArtifactBase64(blob),
          });
          if (!saved) return;
        } else {
          downloadPdfArtifact(blob, `document-export.${pdfArtifactExtension[format]}`);
        }
      }
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        aria-label={t("common.export")}
        title={t("common.export")}
        onClick={() => {
          setFormat(sourceIdentity ? "pages" : canSave ? "text" : "print");
          setPages(String(pageNumber));
          setCrop("");
          setError(undefined);
          setOpen(true);
        }}
      >
        <Export aria-hidden className="h-4 w-4" />
      </button>
      {open && (
        <Dialog
          open
          title={t("common.export")}
          onClose={() => { if (!pending) setOpen(false); }}
          footer={<Button variant="filled" onClick={() => void save()} disabled={pending}
            aria-busy={pending}>{t("common.export")}</Button>}
        >
          <div className="space-y-3">
            <label className="grid gap-1">
              <span>Format</span>
              <select className="w-full rounded-md border border-border bg-background p-2"
                value={format} disabled={pending}
                onChange={(event) => setFormat(event.target.value as PdfFileOutput)}>
                {sourceIdentity && <option value="pages">PDF page copy</option>}
                {canSave && <option value="filledPdf">PDF with form values</option>}
                {canSave && <option value="text">Plain text</option>}
                {canSave && <option value="html">HTML text</option>}
                {canSave && <option value="png">Current page as PNG</option>}
                <option value="print">Print current page</option>
              </select>
            </label>
            {usesPages && (
              <label className="grid gap-1">
                <span>Physical pages in output order</span>
                <input className="w-full rounded-md border border-border bg-background p-2"
                  value={pages} disabled={pending} placeholder="3, 1-2"
                  onChange={(event) => setPages(event.target.value)} />
              </label>
            )}
            {format === "pages" && (
              <label className="grid gap-1">
                <span>Crop points from each edge (optional)</span>
                <input className="w-full rounded-md border border-border bg-background p-2"
                  type="number" min="0" step="any" value={crop} disabled={pending}
                  onChange={(event) => setCrop(event.target.value)} />
              </label>
            )}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
