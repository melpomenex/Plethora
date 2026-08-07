import { BookOpen, TextT } from "@phosphor-icons/react";
import { useTabsStore } from "../../stores";
import { usePaneId } from "../common/Tabs";
import { useI18n } from "../../lib/i18n";
import { ExtractsList } from "../extracts/ExtractsList";
import { DocumentViewer } from "./TabRegistry";

interface DocumentExtractsTabProps {
  documentId?: string;
  documentTitle?: string;
}

/**
 * Standalone extract list for one document, opened from the Documents view's
 * context menu ("View extracts"). Renders the same `ExtractsList` surface the
 * document viewer embeds, with a header offering to jump into the source
 * document.
 */
export function DocumentExtractsTab({ documentId, documentTitle }: DocumentExtractsTabProps) {
  const { t } = useI18n();
  const addTab = useTabsStore((state) => state.addTab);
  const paneId = usePaneId();

  if (!documentId) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{t("extracts.noDocument")}</p>
      </div>
    );
  }

  const title = documentTitle || t("extracts.title");

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {t("extracts.title")}
            </p>
            <h2 className="truncate text-lg font-semibold text-foreground">{title}</h2>
          </div>
          <button
            type="button"
            onClick={() =>
              addTab(
                {
                  title,
                  icon: <TextT className="w-4 h-4 text-muted-foreground" />,
                  type: "document-viewer",
                  content: DocumentViewer,
                  closable: true,
                  data: { documentId },
                },
                paneId,
              )
            }
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            <BookOpen className="w-4 h-4" />
            {t("documentsView.openDocument")}
          </button>
        </div>
        <ExtractsList documentId={documentId} />
      </div>
    </div>
  );
}
