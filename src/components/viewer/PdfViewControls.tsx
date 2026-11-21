import { ArrowClockwise } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { isPdfSpread, type PdfViewPreferences } from "./pdfReadingLayout";

const controlClass = "min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

export function PdfViewControls({ value, onChange }: {
  value: PdfViewPreferences;
  onChange: (options: PdfViewPreferences) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="min-h-0 space-y-4 overflow-y-auto p-3">
      <label className="block space-y-1.5 text-sm font-medium text-foreground">
        <span>{t("viewer.pdfLayout")}</span>
        <select
          className={controlClass}
          value={value.layout}
          onChange={(event) => onChange({ ...value, layout: event.target.value as PdfViewPreferences["layout"] })}
        >
          <option value="continuous">{t("viewer.pdfLayoutContinuous")}</option>
          <option value="single">{t("viewer.pdfLayoutSingle")}</option>
          <option value="spread">{t("viewer.pdfLayoutSpread")}</option>
          <option value="cover-spread">{t("viewer.pdfLayoutCoverSpread")}</option>
        </select>
      </label>
      {isPdfSpread(value.layout) && (
        <label className="block space-y-1.5 text-sm font-medium text-foreground">
          <span>{t("viewer.pdfReadingOrder")}</span>
          <select
            className={controlClass}
            value={value.direction}
            onChange={(event) => onChange({ ...value, direction: event.target.value === "rtl" ? "rtl" : "ltr" })}
          >
            <option value="ltr">{t("viewer.pdfOrderLtr")}</option>
            <option value="rtl">{t("viewer.pdfOrderRtl")}</option>
          </select>
        </label>
      )}
      <button
        type="button"
        className={`${controlClass} md-state flex items-center gap-2 text-start hover:bg-muted`}
        onClick={() => onChange({ ...value, rotation: ((value.rotation + 90) % 360) as PdfViewPreferences["rotation"] })}
      >
        <ArrowClockwise className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t("viewer.pdfRotateView")}</span>
        <span className="ms-auto tabular-nums" aria-label={t("viewer.pdfViewRotation", { angle: value.rotation })}>{value.rotation}°</span>
      </button>
    </div>
  );
}
