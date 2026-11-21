import { useState } from "react";
import type { Citation } from "../../lib/ai/assistant/conversations/types";
import { useI18n } from "../../lib/i18n";
import { useTabsStore } from "../../stores/tabsStore";
import { usablePdfPageText, type PdfPageSource } from "../../utils/pdfAssistantEvidence";

export function PdfAssistantCitations({ citations, getSource }: {
  citations: readonly Citation[];
  getSource?: () => PdfPageSource | undefined;
}) {
  const { t } = useI18n();
  const [missingPassage, setMissingPassage] = useState(false);
  const [opening, setOpening] = useState<string>();

  async function openCitation(citation: Citation, page: number) {
    const source = getSource?.();
    if (!source || !samePdf(source, citation) || !citation.quote) {
      setMissingPassage(true);
      return;
    }
    setMissingPassage(false);
    setOpening(citation.id);
    try {
      const text = usablePdfPageText(await source.loadPageText(page));
      if (!text.includes(citation.quote) || !samePdf(getSource?.(), citation)) {
        setMissingPassage(true);
        return;
      }
      const { openDocumentAtLocation } = await import("../../utils/openDocumentAtLocation");
      if (!samePdf(getSource?.(), citation) || !await openDocumentAtLocation(source.documentId, {
        ensureExists: true,
        initialJump: { kind: "pdf", pageNumber: page },
      }, useTabsStore.getState().addTab)) setMissingPassage(true);
    } catch {
      setMissingPassage(true);
    } finally {
      setOpening(undefined);
    }
  }

  return (
    <div className="mt-2 border-t border-border/70 pt-2">
      <p className="text-xs font-medium text-muted-foreground">{t("qaSources.heading")}</p>
      <ul className="flex flex-wrap gap-1">
        {citations.map((citation) => {
          const page = citation?.locator?.page;
          if (citation?.validation !== "verified" || citation.sourceType !== "pdf" || page === undefined || !Number.isSafeInteger(page) || page < 1) return null;
          const label = `[${citation.displayNumber}] ${t("qaSources.page", { page })}`;
          return (
            <li key={citation.id}>
              <button type="button" disabled={opening !== undefined}
                className="min-h-9 rounded-md border border-border px-2 text-xs text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-70"
                onClick={() => void openCitation(citation, page)}>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      {missingPassage && <p className="text-xs text-muted-foreground" role="status">{t("qaSources.passageNotLocated")}</p>}
    </div>
  );
}

function samePdf(source: PdfPageSource | undefined, citation: Citation): boolean {
  return Boolean(source?.version && source.documentId === citation.documentId &&
    source.version === citation.contentVersion && source.isCurrent());
}
