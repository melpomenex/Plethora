import { ArrowClockwise } from "@phosphor-icons/react";
import { useState } from "react";
import { invokeCommand } from "../../lib/tauri";
import { useI18n } from "../../lib/i18n";
import { useToast } from "../common/Toast";

export function PdfSaveRotatedCopyButton({ documentId, pageNumber, sourceIdentity }: {
  documentId: string;
  pageNumber: number;
  sourceIdentity: string;
}) {
  const [pending, setPending] = useState(false);
  const { t } = useI18n();
  const toast = useToast();
  const label = t("viewer.pdfSaveRotatedCopy");

  const saveCopy = async () => {
    setPending(true);
    try {
      const saved = await invokeCommand<boolean>("save_rotated_pdf_copy", {
        documentId,
        pageNumber,
        expectedIdentity: sourceIdentity,
      });
      if (saved) toast.success(t("viewer.pdfRotatedCopySaved"));
    } catch (error) {
      toast.error(t("viewer.pdfRotatedCopyError"), error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50"
      disabled={pending}
      aria-busy={pending}
      aria-label={label}
      title={label}
      onClick={() => void saveCopy()}
    >
      <ArrowClockwise aria-hidden className="h-4 w-4" />
    </button>
  );
}
