import { ArrowClockwise, ArrowRight, Tray, WarningCircle } from "@phosphor-icons/react";
import type { CaptureDocument, CaptureListingSource, CapturePage } from "../../api/capture-activity";
import { useI18n } from "../../lib/i18n";
import { CaptureDocumentTile } from "./CaptureDocumentTile";

export interface BrowserCaptureShelfProps {
  data: CapturePage | null;
  source?: CaptureListingSource;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (document: CaptureDocument) => void;
  onOpenOriginal: (document: CaptureDocument) => void;
  onViewAll: () => void;
}

export function BrowserCaptureShelf({ data, source = "browser-extension", isLoading, error, onRetry, onOpen, onOpenOriginal, onViewAll }: BrowserCaptureShelfProps) {
  const { t } = useI18n();
  const copy = source === "share-target" ? "dashboard.sharedCaptures" : "dashboard.browserSaves";
  const retry = <button onClick={onRetry} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-primary hover:bg-primary-container focus-visible:outline-2 focus-visible:outline-primary"><ArrowClockwise aria-hidden="true" />{t("dashboard.captureActivityRetry")}</button>;
  return (
    <section className="mb-5" aria-label={t(`${copy}.title`)} aria-busy={isLoading}>
      <div className="capture-shelf-header">
        <h3 className="text-sm font-semibold text-foreground">{t(`${copy}.title`)}</h3>
        <button onClick={onViewAll} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm text-primary hover:bg-primary-container focus-visible:outline-2 focus-visible:outline-primary">
          {t(`${copy}.viewAll`)}<ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </button>
      </div>
      {!data && isLoading ? (
        <ul className="capture-shelf" aria-label={t(`${copy}.loading`)}>
          {Array.from({ length: 6 }, (_, index) => <li key={index} className="capture-shelf-skeleton" aria-hidden="true" />)}
        </ul>
      ) : !data && error ? (
        <div className="flex flex-wrap items-center gap-2 py-6" role="alert"><WarningCircle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-foreground">{t(`${copy}.error`)}</p>{retry}</div>
      ) : (
        <>
          {error && <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status"><WarningCircle className="h-4 w-4 shrink-0" aria-hidden="true" />{t(`${copy}.stale`)}{retry}</div>}
          {data?.items.length ? (
            <ul className="capture-shelf">{data.items.slice(0, 6).map(document => <CaptureDocumentTile key={document.documentId} source={source} document={document} onOpen={onOpen} onOpenOriginal={onOpenOriginal} />)}</ul>
          ) : (
            <div className="flex items-start gap-3 py-7"><Tray className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" /><div><p className="text-sm font-medium text-foreground">{t(`${copy}.emptyTitle`)}</p><p className="mt-1 text-sm text-muted-foreground">{t(`${copy}.emptyBody`)}</p></div></div>
          )}
        </>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {isLoading ? t(`${copy}.loading`) : data ? t(`${copy}.loaded`, { count: data.items.length }) : ""}
      </span>
    </section>
  );
}
